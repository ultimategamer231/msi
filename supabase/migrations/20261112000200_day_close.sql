-- M8.3: day close per branch per day (SPEC 5.10, 7.5; FR-23; T-34).
-- The cashier counts the drawer against what the ledger expects; a manager or the CEO approves,
-- which locks the day for that branch (post_journal refuses it); reopen_day_close removes the lock.

create table public.day_closes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  close_date date not null,
  cashier_id uuid not null references public.profiles (id),
  opening_cash_cents bigint not null,
  expected_cash_cents bigint not null,
  counted_cash_cents bigint not null check (counted_cash_cents >= 0),
  variance_cents bigint not null,
  note text check (length(note) <= 500),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  reopened_by uuid references public.profiles (id),
  reopened_at timestamptz,
  reopen_reason text,
  submitted_at timestamptz not null default public.app_now(),
  constraint day_close_variance check (variance_cents = counted_cash_cents - expected_cash_cents)
);
create unique index day_closes_open_key on public.day_closes (branch_id, close_date)
  where status in ('submitted', 'approved');
create index day_closes_branch_idx on public.day_closes (branch_id, close_date desc);

alter table public.day_closes enable row level security;
create policy day_closes_read on public.day_closes for select to authenticated
  using ((select public.auth_role()) in ('cashier', 'manager', 'ceo', 'accountant', 'admin'));
revoke all on public.day_closes from anon;
revoke insert, update, delete, truncate, references, trigger on public.day_closes from authenticated, service_role;

-- What the drawer should hold: the branch cash account's balance before the day, every cash
-- movement of the day, and field cash collected but not yet handed over (not in the drawer).
create or replace function public.day_close_summary(p_branch_id uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('cashier', 'manager', 'ceo', 'accountant', 'admin');
  v_account accounts;
  v_opening bigint;
  v_lines jsonb;
  v_in bigint;
  v_out bigint;
  v_close jsonb;
  v_field jsonb;
  v_lock date;
begin
  if v_role = 'cashier' and p_branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a cashier closes their own branch' using errcode = '42501';
  end if;
  select * into v_account from accounts where is_cash and branch_id = p_branch_id and active;
  if not found or p_date is null then
    raise exception 'INVALID_STATE: no cash account for this branch' using errcode = 'P0002';
  end if;
  select coalesce(sum(l.debit_cents - l.credit_cents), 0) into v_opening
    from journal_lines l join journals j on j.id = l.journal_id
   where l.account_id = v_account.id and j.entry_date < p_date;
  select coalesce(jsonb_agg(row_data order by posted_at, journal_no), '[]'::jsonb),
         coalesce(sum(in_cents), 0), coalesce(sum(out_cents), 0)
    into v_lines, v_in, v_out
    from (
      select j.posted_at, j.journal_no, l.debit_cents as in_cents, l.credit_cents as out_cents,
             jsonb_build_object(
               'at', j.posted_at, 'journal_no', j.journal_no, 'source_type', j.source_type,
               'category', case
                 when j.source_type in ('payment', 'field_remittance', 'remittance') or p.id is not null then 'collection'
                 when j.source_type = 'disbursement' then 'disbursement'
                 when e.id is not null then 'expense'
                 else 'other' end,
               'reference', coalesce(p.receipt_no, rp.receipt_no, e.expense_no, dl.loan_no, j.journal_no),
               'loan_no', coalesce(pl.loan_no, dl.loan_no),
               'customer', coalesce(case when pc.id is not null then customer_display_name(pc) end,
                                   case when dc.id is not null then customer_display_name(dc) end),
               'description', coalesce(e.description, j.memo),
               'in_cents', l.debit_cents, 'out_cents', l.credit_cents) as row_data
        from journal_lines l
        join journals j on j.id = l.journal_id
        left join payments p on p.journal_id = j.id or p.void_journal_id = j.id
        left join lateral (select receipt_no from payments where remittance_journal_id = j.id limit 1) rp on true
        left join loans pl on pl.id = p.loan_id
        left join customers pc on pc.id = pl.customer_id
        left join loans dl on j.source_type = 'disbursement' and dl.id = j.source_id
        left join customers dc on dc.id = dl.customer_id
        left join expenses e on e.journal_id = j.id or e.settled_journal_id = j.id
       where l.account_id = v_account.id and j.entry_date = p_date
    ) movements;
  select coalesce(jsonb_agg(jsonb_build_object('receipt_no', p.receipt_no, 'amount_cents', p.amount_cents,
                                               'officer', pr.full_name, 'loan_no', ln.loan_no,
                                               'customer', customer_display_name(c), 'received_on', p.received_on)
                            order by p.received_at), '[]'::jsonb)
    into v_field
    from payments p join profiles pr on pr.id = p.received_by join loans ln on ln.id = p.loan_id
    join customers c on c.id = ln.customer_id
   where p.branch_id = p_branch_id and p.collected_in_field and p.remittance_status = 'pending'
     and p.status = 'posted' and p.received_on <= p_date;
  select to_jsonb(d) || jsonb_build_object('cashier', pr.full_name, 'approver', ap.full_name,
                                           'request_id', (select id from approval_requests
                                                            where type = 'day_close' and entity_id = d.id
                                                            order by requested_at desc limit 1))
    into v_close
    from day_closes d join profiles pr on pr.id = d.cashier_id left join profiles ap on ap.id = d.approved_by
   where d.branch_id = p_branch_id and d.close_date = p_date
   order by (d.status <> 'rejected') desc, d.submitted_at desc limit 1;
  select locked_through into v_lock from period_locks where branch_id = p_branch_id;
  return jsonb_build_object('branch_id', p_branch_id, 'date', p_date, 'account', v_account.code,
                            'opening_cents', v_opening, 'in_cents', v_in, 'out_cents', v_out,
                            'expected_cents', v_opening + v_in - v_out, 'lines', v_lines,
                            'field_cash', v_field, 'close', v_close, 'locked_through', v_lock);
end
$$;
revoke execute on function public.day_close_summary(uuid, date) from public, anon, service_role;
grant execute on function public.day_close_summary(uuid, date) to authenticated;

-- submit_day_close (SPEC 8): the cashier of the branch counts the drawer. A variance needs a note.
create or replace function public.submit_day_close(p_branch_id uuid, p_date date, p_counted_cents bigint, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_expected bigint;
  v_id uuid;
  v_request uuid;
  v_branch branches;
begin
  perform require_role('cashier');
  if p_branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a cashier closes their own branch' using errcode = '42501';
  end if;
  if p_date is null or p_date > business_today() then
    raise exception 'DATE_NOT_ALLOWED: a day is closed on or after that day' using errcode = '42501';
  end if;
  if exists (select 1 from period_locks where branch_id = p_branch_id and locked_through >= p_date) then
    raise exception 'PERIOD_LOCKED: % is already closed for this branch', p_date using errcode = '42501';
  end if;
  if exists (select 1 from day_closes where branch_id = p_branch_id and close_date = p_date
                                       and status in ('submitted', 'approved')) then
    raise exception 'INVALID_STATE: this day was already submitted' using errcode = '22023';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'INVALID_STATE: enter the cash counted' using errcode = '22023';
  end if;
  v_summary := day_close_summary(p_branch_id, p_date);
  v_expected := (v_summary ->> 'expected_cents')::bigint;
  if p_counted_cents <> v_expected and v_note is null then
    raise exception 'INVALID_STATE: give a reason for the variance' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long (500 characters at most)' using errcode = '22023';
  end if;
  insert into day_closes (branch_id, close_date, cashier_id, opening_cash_cents, expected_cash_cents,
                          counted_cash_cents, variance_cents, note)
  values (p_branch_id, p_date, auth.uid(), (v_summary ->> 'opening_cents')::bigint, v_expected, p_counted_cents,
          p_counted_cents - v_expected, v_note)
  returning id into v_id;
  select * into v_branch from branches where id = p_branch_id;
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('day_close', 'day_close', v_id,
          jsonb_build_object('branch_id', p_branch_id, 'branch', v_branch.name, 'close_date', p_date,
                             'expected_cents', v_expected, 'counted_cents', p_counted_cents,
                             'variance_cents', p_counted_cents - v_expected, 'note', v_note),
          'manager', v_note, auth.uid())
  returning id into v_request;
  perform write_audit('day_close.submitted', 'day_close', v_id::text, null,
    jsonb_build_object('branch_id', p_branch_id, 'close_date', p_date, 'expected_cents', v_expected,
                       'counted_cents', p_counted_cents, 'request_id', v_request));
  return v_id;
end
$$;
revoke execute on function public.submit_day_close(uuid, date, bigint, text) from public, anon, service_role;
grant execute on function public.submit_day_close(uuid, date, bigint, text) to authenticated;

-- The branch lock follows the latest approved close.
create or replace function public.refresh_period_lock(p_branch_id uuid, p_floor date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_through date := (select max(close_date) from day_closes where branch_id = p_branch_id and status = 'approved');
begin
  if p_floor is not null then
    v_through := least(coalesce(v_through, p_floor), p_floor);
  end if;
  if v_through is null then
    delete from period_locks where branch_id = p_branch_id;
  else
    insert into period_locks (branch_id, locked_through, locked_by, locked_at)
    values (p_branch_id, v_through, auth.uid(), app_now())
    on conflict (branch_id) do update set locked_through = excluded.locked_through,
                                          locked_by = excluded.locked_by, locked_at = excluded.locked_at;
  end if;
end
$$;
revoke execute on function public.refresh_period_lock(uuid, date) from public, anon, authenticated, service_role;

create or replace function public.apply_day_close(p_request approval_requests, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_close day_closes;
begin
  select * into v_close from day_closes where id = p_request.entity_id for update;
  if not found or v_close.status <> 'submitted' then
    raise exception 'INVALID_STATE: this day close is no longer waiting' using errcode = '22023';
  end if;
  if p_decision = 'approve' then
    update day_closes set status = 'approved', approved_by = auth.uid(), approved_at = app_now() where id = v_close.id;
    perform refresh_period_lock(v_close.branch_id, null);
  else
    update day_closes set status = 'rejected' where id = v_close.id;
  end if;
  return jsonb_build_object('day_close_id', v_close.id, 'status',
                            case when p_decision = 'approve' then 'approved' else 'rejected' end,
                            'locked_through', (select locked_through from period_locks where branch_id = v_close.branch_id));
end
$$;
revoke execute on function public.apply_day_close(approval_requests, text) from public, anon, authenticated, service_role;

-- reopen_day_close (SPEC 5.10): a manager or the CEO reopens an approved day with a reason; the lock
-- moves back to the day before, the close is marked rejected and the cashier submits again.
create or replace function public.reopen_day_close(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_close day_closes;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_role('manager', 'ceo');
  select * into v_close from day_closes where id = p_id for update;
  if not found or v_close.status <> 'approved' then
    raise exception 'INVALID_STATE: only a closed day can be reopened' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'INVALID_STATE: give a reason (up to 500 characters)' using errcode = '22023';
  end if;
  update day_closes set status = 'rejected', reopened_by = auth.uid(), reopened_at = app_now(), reopen_reason = v_reason
   where id = p_id;
  perform refresh_period_lock(v_close.branch_id, v_close.close_date - 1);
  perform write_audit('day_close.reopened', 'day_close', p_id::text,
    jsonb_build_object('status', 'approved', 'close_date', v_close.close_date),
    jsonb_build_object('status', 'rejected', 'reason', v_reason,
                       'locked_through', (select locked_through from period_locks where branch_id = v_close.branch_id)));
end
$$;
revoke execute on function public.reopen_day_close(uuid, text) from public, anon, service_role;
grant execute on function public.reopen_day_close(uuid, text) to authenticated;

-- decide_approval again: day closes (approve locks the day, reject sends it back).
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
  elsif v_request.type = 'day_close' then
    v_result := apply_day_close(v_request, p_decision);
  elsif v_request.type = 'expense' and p_decision = 'reject' then
    update expenses set status = 'rejected' where id = v_request.entity_id and status = 'pending_approval';
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
      when 'expense' then
        if not exists (select 1 from expenses where id = v_request.entity_id and status = 'pending_approval') then
          raise exception 'INVALID_STATE: the expense is no longer waiting' using errcode = '22023';
        end if;
        v_result := post_expense(v_request.entity_id);
      when 'write_off' then
        v_result := apply_write_off(v_request, v_note);
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
