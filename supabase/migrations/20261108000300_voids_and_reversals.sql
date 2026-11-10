-- M4.3: corrections without editing (SPEC 5.4.9; FR-20; recipe R8; T-25). A payment is voided, or
-- a journal reversed, only through an approved request: the reversing journal is dated today, linked
-- to the original with reversal_of, and the original stays untouched. B-12 default (answer
-- pending): journals that are not payments can be reversed with request_journal_reversal.

-- Lines of a journal with debit and credit swapped, ready for post_journal.
create or replace function public.swapped_lines(p_journal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'account', a.code,
           'debit_cents', nullif(l.credit_cents, 0), 'credit_cents', nullif(l.debit_cents, 0),
           'loan_id', l.loan_id, 'customer_id', l.customer_id, 'payee_id', l.payee_id, 'staff_id', l.staff_id,
           'component', l.component)) order by l.line_no), '[]'::jsonb)
    from journal_lines l join accounts a on a.id = l.account_id
   where l.journal_id = p_journal_id
$$;

revoke execute on function public.swapped_lines(uuid) from public, anon, authenticated, service_role;

-- request_void_payment (SPEC 8): cashier, manager or accountant; a reason is required. A manager
-- (not the requester) or the CEO decides.
create or replace function public.request_void_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload jsonb;
  v_id uuid;
begin
  perform require_role('cashier', 'manager', 'accountant');
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    raise exception 'INVALID_STATE: the payment does not exist' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'posted' then
    raise exception 'INVALID_STATE: the payment is already voided' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'INVALID_STATE: give the reason for the void (up to 300 characters)' using errcode = '22023';
  end if;
  if exists (select 1 from approval_requests where type = 'payment_void' and entity_id = p_payment_id and status = 'pending') then
    raise exception 'INVALID_STATE: a void of this payment is already waiting for approval' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'payment_id', v_payment.id, 'receipt_no', v_payment.receipt_no, 'amount_cents', v_payment.amount_cents,
    'method', v_payment.method, 'received_on', v_payment.received_on, 'loan_id', v_payment.loan_id,
    'loan_no', (select loan_no from loans where id = v_payment.loan_id),
    'customer_name', (select customer_display_name(c) from customers c where c.id = v_payment.customer_id));
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('payment_void', 'payment', v_payment.id, v_payload, 'manager', v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'payment_void', 'required_role', 'manager', 'payload', v_payload, 'reason', v_reason));
  return v_id;
end
$$;

revoke execute on function public.request_void_payment(uuid, text) from public, anon, service_role;
grant execute on function public.request_void_payment(uuid, text) to authenticated;

-- Applies an approved void: reversing journal today (R8); field cash already handed over is taken
-- back from the branch cash account it went into; the payment and its receipt are marked void; a
-- closed loan opens again.
create or replace function public.apply_payment_void(p_request public.approval_requests)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_loan loans;
  v_lines jsonb;
  v_cash text;
  v_journal uuid;
  v_owed bigint;
begin
  select * into v_payment from payments where id = p_request.entity_id for update;
  if not found or v_payment.status <> 'posted' then
    raise exception 'INVALID_STATE: the payment is already voided' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = v_payment.loan_id for update;
  v_lines := swapped_lines(v_payment.journal_id);
  if v_payment.remittance_status = 'confirmed' then
    select code into v_cash from accounts where is_cash and branch_id = v_payment.branch_id;
    v_lines := (select jsonb_agg(case when line ->> 'account' = '1015'
                                      then (line - 'staff_id') || jsonb_build_object('account', v_cash) else line end)
                  from jsonb_array_elements(v_lines) line);
  end if;
  v_journal := post_journal(business_today(), 'Void of receipt ' || v_payment.receipt_no, 'payment_void', v_payment.id,
                            v_payment.branch_id, v_lines, v_payment.journal_id);
  update payments set status = 'voided', voided_at = app_now(), void_journal_id = v_journal,
                      remittance_status = case when remittance_status = 'pending' then 'n/a' else remittance_status end
   where id = v_payment.id;
  update issued_documents set is_void = true where kind = 'receipt' and entity_id = v_payment.id;

  select penalty_cents + interest_cents + principal_cents into v_owed from loan_owed(v_loan.id);
  if v_loan.status = 'closed' and v_owed > 0 then
    update loans set status = case when due_date < business_today() then 'overdue' else 'active' end,
                     closed_on = null, updated_at = app_now()
     where id = v_loan.id;
    perform write_audit('loan.reopened', 'loan', v_loan.id::text, jsonb_build_object('status', 'closed'),
                        jsonb_build_object('payment_id', v_payment.id, 'owed_cents', v_owed));
  end if;
  perform write_audit('payment.voided', 'payment', v_payment.id::text, jsonb_build_object('status', 'posted'),
    jsonb_build_object('status', 'voided', 'void_journal_id', v_journal, 'approval_request_id', p_request.id,
                       'reason', p_request.reason));
  return jsonb_build_object('payment_id', v_payment.id, 'receipt_no', v_payment.receipt_no, 'journal_id', v_journal,
                            'journal_no', (select journal_no from journals where id = v_journal));
end
$$;

revoke execute on function public.apply_payment_void(public.approval_requests) from public, anon, authenticated, service_role;

-- request_journal_reversal (B-12 default): accountant or manager, for a journal entered directly
-- (manual journal, capital in). Payments are voided instead; payouts and journals already reversed,
-- or reversals themselves, are refused.
create or replace function public.request_journal_reversal(p_journal_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal journals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload jsonb;
  v_id uuid;
begin
  perform require_role('accountant', 'manager');
  select * into v_journal from journals where id = p_journal_id;
  if not found then
    raise exception 'INVALID_STATE: the journal does not exist' using errcode = 'P0002';
  end if;
  if v_journal.source_type not in ('manual_journal', 'capital_in') then
    raise exception 'INVALID_STATE: only manual and capital journals are reversed this way; void a payment instead'
      using errcode = '22023';
  end if;
  if exists (select 1 from journals where reversal_of = v_journal.id) then
    raise exception 'INVALID_STATE: this journal is already reversed' using errcode = '22023';
  end if;
  if exists (select 1 from approval_requests where type = 'journal_reversal' and entity_id = v_journal.id and status = 'pending') then
    raise exception 'INVALID_STATE: a reversal of this journal is already waiting for approval' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'INVALID_STATE: give the reason for the reversal (up to 300 characters)' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('journal_id', v_journal.id, 'journal_no', v_journal.journal_no,
                                  'entry_date', v_journal.entry_date, 'memo', v_journal.memo,
                                  'branch_id', v_journal.branch_id, 'lines', swapped_lines(v_journal.id));
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('journal_reversal', 'journal', v_journal.id, v_payload, 'manager', v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'journal_reversal', 'required_role', 'manager', 'payload', v_payload, 'reason', v_reason));
  return v_id;
end
$$;

revoke execute on function public.request_journal_reversal(uuid, text) from public, anon, service_role;
grant execute on function public.request_journal_reversal(uuid, text) to authenticated;

create or replace function public.apply_journal_reversal(p_request public.approval_requests)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original journals;
  v_journal uuid;
begin
  select * into v_original from journals where id = p_request.entity_id;
  if exists (select 1 from journals where reversal_of = v_original.id) then
    raise exception 'INVALID_STATE: this journal is already reversed' using errcode = '22023';
  end if;
  v_journal := post_journal(business_today(), 'Reversal of ' || v_original.journal_no || ': ' || p_request.reason,
                            'journal_reversal', p_request.id, v_original.branch_id, swapped_lines(v_original.id),
                            v_original.id);
  return jsonb_build_object('journal_id', v_journal, 'journal_no', (select journal_no from journals where id = v_journal),
                            'reversal_of', v_original.journal_no);
end
$$;

revoke execute on function public.apply_journal_reversal(public.approval_requests) from public, anon, authenticated, service_role;

-- decide_approval, now also for payment voids and journal reversals (M4.3).
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
