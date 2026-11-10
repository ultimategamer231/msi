-- M5.4: loan extension (SPEC 5.6; FR-18; A-09; T-13). A loan officer (loans of their branch) or a
-- manager asks for extra months with a reason; another manager or the CEO approves. On approval:
-- R5 posts pct(principal outstanding, rate) x extra months as interest, the due date moves by the
-- extra months (clamped to month end), due_date_version + 1 so penalties restart at period 1,
-- penalties already charged stay, and the loan is active again. Refused while extension.enabled
-- is off and for loans in recovery.

create table public.loan_extensions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id),
  extra_months int not null check (extra_months >= 1),
  old_due_date date not null,
  new_due_date date not null,
  extra_interest_cents bigint not null check (extra_interest_cents >= 0),
  approval_id uuid not null references public.approval_requests (id),
  journal_id uuid references public.journals (id),
  created_at timestamptz not null default public.app_now(),
  check (new_due_date > old_due_date)
);

comment on table public.loan_extensions is 'Approved extensions (SPEC 7.3); append-only.';

create index loan_extensions_loan_idx on public.loan_extensions (loan_id);
create index loan_extensions_approval_idx on public.loan_extensions (approval_id);
create index loan_extensions_journal_idx on public.loan_extensions (journal_id) where journal_id is not null;

create trigger loan_extensions_immutable
  before update or delete on public.loan_extensions
  for each row execute function public.trg_immutable();

alter table public.loan_extensions enable row level security;
create policy loan_extensions_read on public.loan_extensions
  for select to authenticated using ((select public.is_staff()));
revoke all on public.loan_extensions from anon;
revoke insert, update, delete, truncate, references, trigger on public.loan_extensions from authenticated, service_role;

-- What an extension would do now: extra interest on the principal outstanding, the new due date
-- and what would be owed (shown on the request and on the approval card).
create or replace function public.extension_terms(p_loan loans, p_extra_months int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'extra_months', p_extra_months,
    'old_due_date', p_loan.due_date,
    'new_due_date', add_months_clamped(p_loan.due_date, p_extra_months),
    'principal_out_cents', o.principal_cents,
    'extra_interest_cents', pct(o.principal_cents, p_loan.interest_rate_bps) * p_extra_months,
    'owed_after_cents', o.penalty_cents + o.interest_cents + o.principal_cents
                        + pct(o.principal_cents, p_loan.interest_rate_bps) * p_extra_months)
    from loan_owed(p_loan.id) o
$$;

create or replace function public.request_extension(p_loan_id uuid, p_extra_months int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager');
  v_loan loans;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_max int;
  v_payload jsonb;
  v_id uuid;
begin
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'extension.enabled'), true) then
    raise exception 'INVALID_STATE: loan extensions are switched off' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_role = 'loan_officer' and v_loan.branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a loan officer asks for extensions of loans of their own branch' using errcode = '42501';
  end if;
  if v_loan.status = 'recovery' then
    raise exception 'INVALID_STATE: a loan in recovery cannot be extended' using errcode = '22023';
  end if;
  if v_loan.status not in ('active', 'overdue') then
    raise exception 'INVALID_STATE: only a paid-out, open loan can be extended' using errcode = '22023';
  end if;
  select max_term_months into v_max from loan_products where id = v_loan.product_id;
  if p_extra_months is null or p_extra_months < 1 or p_extra_months > v_max then
    raise exception 'INVALID_STATE: extend by 1 to % months', v_max using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'INVALID_STATE: give the reason for the extension (up to 300 characters)' using errcode = '22023';
  end if;
  if exists (select 1 from approval_requests where type = 'loan_extension' and entity_id = v_loan.id and status = 'pending') then
    raise exception 'INVALID_STATE: an extension of this loan is already waiting for approval' using errcode = '22023';
  end if;
  v_payload := extension_terms(v_loan, p_extra_months) || jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'due_date_version', v_loan.due_date_version,
    'customer_name', (select customer_display_name(c) from customers c where c.id = v_loan.customer_id),
    'next_penalty_on', (select next_penalty_on from loan_balance_rows() where loan_id = v_loan.id));
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('loan_extension', 'loan', v_loan.id, v_payload, 'manager', v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'loan_extension', 'required_role', 'manager', 'payload', v_payload, 'reason', v_reason));
  return v_id;
end
$$;

-- Applied by decide_approval on approval (the caller has checked roles and SELF_APPROVAL).
create or replace function public.apply_loan_extension(p_request approval_requests)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_terms jsonb;
  v_months int := (p_request.payload ->> 'extra_months')::int;
  v_interest bigint;
  v_new_due date;
  v_journal uuid;
begin
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'extension.enabled'), true) then
    raise exception 'INVALID_STATE: loan extensions are switched off' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_request.entity_id for update;
  if v_loan.status not in ('active', 'overdue') then
    raise exception 'INVALID_STATE: the loan can no longer be extended (status %)', v_loan.status using errcode = '22023';
  end if;
  if v_loan.due_date_version <> (p_request.payload ->> 'due_date_version')::int then
    raise exception 'INVALID_STATE: the due date changed after the request; ask again' using errcode = '22023';
  end if;
  -- Recomputed now: a payment since the request lowers the principal outstanding.
  v_terms := extension_terms(v_loan, v_months);
  v_interest := (v_terms ->> 'extra_interest_cents')::bigint;
  v_new_due := (v_terms ->> 'new_due_date')::date;
  if v_interest > 0 then
    v_journal := post_journal(business_today(),
      format('Extension of %s by %s month(s) to %s', v_loan.loan_no, v_months, to_char(v_new_due, 'DD Mon YYYY')),
      'extension', p_request.id, v_loan.branch_id,
      jsonb_build_array(
        jsonb_build_object('account', '1110', 'debit_cents', v_interest, 'loan_id', v_loan.id,
                           'customer_id', v_loan.customer_id, 'component', 'interest'),
        jsonb_build_object('account', '4000', 'credit_cents', v_interest)));        -- R5
  end if;
  update loans
     set due_date = v_new_due, due_date_version = due_date_version + 1, status = 'active',
         recovery_eligible = false, updated_at = app_now()
   where id = v_loan.id;
  insert into loan_extensions (loan_id, extra_months, old_due_date, new_due_date, extra_interest_cents,
                               approval_id, journal_id)
  values (v_loan.id, v_months, v_loan.due_date, v_new_due, v_interest, p_request.id, v_journal);
  perform write_audit('loan.extended', 'loan', v_loan.id::text,
    jsonb_build_object('status', v_loan.status, 'due_date', v_loan.due_date, 'due_date_version', v_loan.due_date_version),
    jsonb_build_object('status', 'active', 'due_date', v_new_due, 'due_date_version', v_loan.due_date_version + 1,
                       'extra_months', v_months, 'extra_interest_cents', v_interest, 'journal_id', v_journal));
  return v_terms || jsonb_build_object('journal_id', v_journal);
end
$$;

revoke execute on function public.extension_terms(loans, int), public.apply_loan_extension(approval_requests)
  from public, anon, authenticated, service_role;
revoke execute on function public.request_extension(uuid, int, text) from public, anon, service_role;
grant execute on function public.request_extension(uuid, int, text) to authenticated;

create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('manager', 'ceo');
  v_request approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb := '{}'::jsonb;
  v_journal uuid;
begin
  select * into v_request from approval_requests where id = p_id for update;
  if not found then
    raise exception 'INVALID_STATE: the request does not exist' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'INVALID_STATE: this request was already decided' using errcode = '22023';
  end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'SELF_APPROVAL: you cannot decide a request you made' using errcode = '42501';
  end if;
  if v_request.required_role = 'ceo' and v_role <> 'ceo' then
    raise exception 'FORBIDDEN: only the CEO can decide this request' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_STATE: the decision must be approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'INVALID_STATE: give a reason for the rejection' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long (500 characters at most)' using errcode = '22023';
  end if;

  if v_request.type = 'loan_approval' then
    v_result := apply_loan_decision(v_request, p_decision, v_note);
  elsif p_decision = 'approve' then
    case v_request.type
      when 'customer_edit', 'customer_blacklist' then
        v_result := apply_customer_edit(v_request);
      when 'payment_void' then
        v_result := apply_payment_void(v_request);
      when 'journal_reversal' then
        v_result := apply_journal_reversal(v_request);
      when 'loan_extension' then
        v_result := apply_loan_extension(v_request);
      when 'manual_journal', 'capital_in' then
        perform require_posting_date((v_request.payload ->> 'entry_date')::date);
        v_journal := post_journal((v_request.payload ->> 'entry_date')::date, v_request.payload ->> 'memo',
                                  v_request.type, v_request.id, nullif(v_request.payload ->> 'branch_id', '')::uuid,
                                  v_request.payload -> 'lines');
        v_result := jsonb_build_object('journal_id', v_journal,
                                       'journal_no', (select journal_no from journals where id = v_journal));
      else
        raise exception 'INVALID_STATE: requests of this type cannot be decided yet' using errcode = '22023';
    end case;
  end if;

  update approval_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = app_now(), decision_note = v_note
   where id = v_request.id;

  perform write_audit(case when p_decision = 'approve' then 'approval.approved' else 'approval.rejected' end,
    'approval_request', v_request.id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
                       'type', v_request.type, 'note', v_note, 'result', v_result));
  return v_result;
end
$$;

revoke execute on function public.decide_approval(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;
