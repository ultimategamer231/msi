-- M6.4: write-off (SPEC 5.8; FR-19; A-13; T-16). A manager or the accountant asks to write off what a
-- loan still owes; it needs a recovery case at disposal or closed, or a manager's override reason
-- of at least 20 characters. Only the CEO approves, and the approval note is the board reference
-- (required). R6 posts Dr 5050 for the whole outstanding, Cr each receivable component; the loan
-- becomes written_off (its open case closes). Money received later is a recovery: Dr cash, Cr 4100,
-- payment source post_write_off_recovery, never more than was written off.

create or replace function public.request_write_off(p_loan_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('manager', 'accountant');
  v_loan loans;
  v_case recovery_cases;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_owed record;
  v_override boolean;
  v_payload jsonb;
  v_id uuid;
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: only an open, paid-out loan can be written off' using errcode = '22023';
  end if;
  select * into v_owed from loan_owed(v_loan.id);
  if v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents <= 0 then
    raise exception 'INVALID_STATE: the loan owes nothing' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'INVALID_STATE: give the reason for the write-off' using errcode = '22023';
  end if;
  select * into v_case from recovery_cases where loan_id = v_loan.id order by opened_on desc, created_at desc limit 1;
  v_override := v_case.id is null or v_case.stage not in ('disposal', 'closed');
  if v_override and (v_role <> 'manager' or length(v_reason) < 20) then
    raise exception 'INVALID_STATE: without a recovery case at disposal, a manager writes off with a reason of at least 20 characters'
      using errcode = '22023';
  end if;
  if exists (select 1 from approval_requests where type = 'write_off' and entity_id = v_loan.id and status = 'pending') then
    raise exception 'INVALID_STATE: a write-off of this loan is already waiting for approval' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no,
    'customer_name', (select customer_display_name(c) from customers c where c.id = v_loan.customer_id),
    'penalty_cents', v_owed.penalty_cents, 'interest_cents', v_owed.interest_cents, 'principal_cents', v_owed.principal_cents,
    'total_cents', v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents,
    'case_no', v_case.case_no, 'case_stage', v_case.stage, 'override', v_override);
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('write_off', 'loan', v_loan.id, v_payload, 'ceo', v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'write_off', 'required_role', 'ceo', 'payload', v_payload, 'reason', v_reason));
  return v_id;
end
$$;

-- Applied by decide_approval when the CEO approves; the note is the board reference.
create or replace function public.apply_write_off(p_request approval_requests, p_board_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_owed record;
  v_total bigint;
  v_lines jsonb;
  v_component text;
  v_amount bigint;
  v_journal uuid;
begin
  if p_board_reference is null then
    raise exception 'INVALID_STATE: enter the board reference as the approval note' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_request.entity_id for update;
  if v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: the loan can no longer be written off (status %)', v_loan.status using errcode = '22023';
  end if;
  select * into v_owed from loan_owed(v_loan.id);
  v_total := v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents;
  if v_total <= 0 then
    raise exception 'INVALID_STATE: the loan owes nothing' using errcode = '22023';
  end if;
  v_lines := jsonb_build_array(jsonb_build_object('account', '5050', 'debit_cents', v_total, 'loan_id', v_loan.id,
                                                  'customer_id', v_loan.customer_id));
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    v_amount := case v_component when 'penalty' then v_owed.penalty_cents when 'interest' then v_owed.interest_cents
                                 else v_owed.principal_cents end;
    if v_amount > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', case v_component when 'penalty' then '1120' when 'interest' then '1110' else '1100' end,
        'credit_cents', v_amount, 'loan_id', v_loan.id, 'customer_id', v_loan.customer_id, 'component', v_component));
    end if;
  end loop;
  v_journal := post_journal(business_today(), format('Write-off of %s (board ref. %s)', v_loan.loan_no, p_board_reference),
                            'write_off', p_request.id, v_loan.branch_id, v_lines);                  -- R6
  update loans set status = 'written_off', updated_at = app_now() where id = v_loan.id;          -- closes the case
  perform write_audit('loan.written_off', 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
    jsonb_build_object('status', 'written_off', 'total_cents', v_total, 'board_reference', p_board_reference,
                       'journal_id', v_journal));
  return jsonb_build_object('journal_id', v_journal, 'total_cents', v_total);
end
$$;

-- A later recovery on a written-off loan (SPEC 5.8): office only, today (or the pre-go-live paper
-- allowance), same receipt and request-key rules as any payment, capped at what was written off.
create or replace function public.take_recovery_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing payments;
  v_loan loans;
  v_on date;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_written bigint;
  v_recovered bigint;
  v_account accounts;
  v_branch uuid;
  v_receipt text;
  v_payment uuid := gen_random_uuid();
  v_journal uuid;
begin
  if length(v_key) < 8 or length(v_key) > 100 then
    raise exception 'INVALID_STATE: a payment needs a request key' using errcode = '22023';
  end if;
  select * into v_existing from payments where received_by = auth.uid() and idempotency_key = v_key;
  if found then
    return receipt_facts(v_existing.id) || jsonb_build_object('replayed', true);
  end if;
  select * into v_loan from loans where id = p_loan_id for update;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_STATE: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'mobile_money', 'bank') then
    raise exception 'INVALID_STATE: the method must be cash, mobile money or bank' using errcode = '22023';
  end if;
  if p_method <> 'cash' and (v_reference is null or length(v_reference) < 4) then
    raise exception 'REFERENCE_REQUIRED: enter the transaction reference' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_received_on);
  select coalesce(sum(l.debit_cents), 0) into v_written
    from journal_lines l join journals j on j.id = l.journal_id join accounts a on a.id = l.account_id
   where j.source_type = 'write_off' and l.loan_id = v_loan.id and a.code = '5050';
  select coalesce(sum(amount_cents), 0) into v_recovered
    from payments where loan_id = v_loan.id and source = 'post_write_off_recovery' and status = 'posted';
  if p_amount_cents > v_written - v_recovered then
    raise exception 'OVERPAYMENT: the amount is more than the % still written off', v_written - v_recovered using errcode = '22023';
  end if;
  v_branch := coalesce(auth_branch(), v_loan.branch_id);
  if p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = v_branch;
  elsif p_method = 'bank' then
    select * into v_account from accounts where code = '1020' and active;
  else
    select * into v_account from accounts where code = '1030' and active;
  end if;
  v_receipt := next_number('receipt', v_branch);
  v_journal := post_journal(v_on, 'Recovery ' || v_receipt || ' on written-off ' || v_loan.loan_no, 'payment', v_payment, v_branch,
    jsonb_build_array(
      jsonb_build_object('account', v_account.code, 'debit_cents', p_amount_cents, 'customer_id', v_loan.customer_id),
      jsonb_build_object('account', '4100', 'credit_cents', p_amount_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id)));
  insert into payments (id, receipt_no, loan_id, customer_id, branch_id, amount_cents, method, reference, received_on,
                        received_by, collected_in_field, remittance_status, source, idempotency_key, journal_id)
  values (v_payment, v_receipt, v_loan.id, v_loan.customer_id, v_branch, p_amount_cents, p_method, v_reference, v_on,
          auth.uid(), false, 'n/a', 'post_write_off_recovery', v_key, v_journal);
  perform write_audit('payment.received', 'payment', v_payment::text, null,
    jsonb_build_object('receipt_no', v_receipt, 'loan_no', v_loan.loan_no, 'amount_cents', p_amount_cents,
                       'method', p_method, 'reference', v_reference, 'received_on', v_on,
                       'source', 'post_write_off_recovery'));
  return receipt_facts(v_payment) || jsonb_build_object('replayed', false);
end
$$;

revoke execute on function public.apply_write_off(approval_requests, text),
  public.take_recovery_payment(uuid, bigint, text, text, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.request_write_off(uuid, text) from public, anon, service_role;
grant execute on function public.request_write_off(uuid, text) to authenticated;

create or replace function public.receive_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('cashier', 'manager', 'accountant', 'admin');
begin
  if v_role in ('accountant', 'admin') then
    perform require_entry_date(p_received_on);
    if coalesce(p_received_on, business_today()) = business_today() then
      raise exception 'FORBIDDEN: payments of the day are taken by a cashier or manager' using errcode = '42501';
    end if;
  end if;
  -- SPEC 5.8: money received on a written-off loan is a recovery (Dr cash, Cr 4100).
  if exists (select 1 from loans where id = p_loan_id and status = 'written_off')
     and not exists (select 1 from payments where received_by = auth.uid() and idempotency_key = btrim(coalesce(p_idempotency_key, ''))
                                              and source = 'normal') then
    return take_recovery_payment(p_loan_id, p_amount_cents, p_method, p_reference, p_received_on, p_idempotency_key);
  end if;
  return take_payment(p_loan_id, p_amount_cents, p_method, p_reference, p_received_on, p_idempotency_key, false);
end
$$;

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

revoke execute on function public.decide_approval(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;
revoke execute on function public.receive_payment(uuid, bigint, text, text, date, text) from public, anon, service_role;
grant execute on function public.receive_payment(uuid, bigint, text, text, date, text) to authenticated;
