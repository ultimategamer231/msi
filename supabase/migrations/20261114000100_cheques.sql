-- Client answer 2026-11-09 (QUESTIONS client item 2): MSI takes and pays by cheque. Cheque is its own
-- method on payments, payouts, collateral sales, surplus payouts and recoveries; the cheque number is
-- the reference (required, like bank and mobile money) and the money posts to Bank (1020), where
-- cheques are deposited. Field collection stays cash, mobile money or bank. The functions below are
-- the latest versions with only those changes.

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash', 'mobile_money', 'bank', 'cheque'));
alter table public.loans drop constraint loans_disbursement_method_check;
alter table public.loans add constraint loans_disbursement_method_check
  check (disbursement_method in ('cash', 'mobile_money', 'bank', 'cheque'));

create or replace function public.take_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_idempotency_key text, p_field boolean)
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
  v_owed record;
  v_split jsonb;
  v_account accounts;
  v_branch uuid;
  v_receipt text;
  v_payment uuid := gen_random_uuid();
  v_journal uuid;
  v_lines jsonb;
  v_component text;
  v_after bigint;
  v_remittance text := 'n/a';
begin
  if length(v_key) < 8 or length(v_key) > 100 then
    raise exception 'INVALID_STATE: a payment needs a request key' using errcode = '22023';
  end if;
  -- T-12: the same key from the same person returns the original receipt and posts nothing.
  select * into v_existing from payments where received_by = auth.uid() and idempotency_key = v_key;
  if found then
    return receipt_facts(v_existing.id) || jsonb_build_object('replayed', true);
  end if;

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: payments are taken only on a paid-out, open loan' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_STATE: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'mobile_money', 'bank', 'cheque') then
    raise exception 'INVALID_STATE: the method must be cash, mobile money, bank or cheque' using errcode = '22023';
  end if;
  if p_field and p_method = 'cheque' then
    raise exception 'INVALID_STATE: cheques are taken at the office' using errcode = '22023';
  end if;
  -- T-11: mobile money, bank and cheque need the transaction reference or cheque number (at least 4 characters).
  if p_method <> 'cash' and (v_reference is null or length(v_reference) < 4) then
    raise exception 'REFERENCE_REQUIRED: enter the transaction reference' using errcode = '22023';
  end if;
  if length(v_reference) > 100 then
    raise exception 'INVALID_STATE: the reference is too long' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_received_on);                                  -- T-37

  select * into v_owed from loan_owed(v_loan.id);
  if p_amount_cents > v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents then
    raise exception 'OVERPAYMENT: the amount is more than the % owed',
      v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents using errcode = '22023';   -- T-10
  end if;
  v_split := allocate_amount(p_amount_cents, v_owed.penalty_cents, v_owed.interest_cents, v_owed.principal_cents);

  -- Receipt and cash follow the receiver's branch; staff without a branch use the loan's (B-10).
  v_branch := coalesce(auth_branch(), v_loan.branch_id);
  if p_field and p_method = 'cash'
     and coalesce((select (value #>> '{}')::boolean from settings where key = 'field.require_remittance'), true) then
    select * into v_account from accounts where code = '1015' and active;     -- R3: field cash until handed over (A-12)
    v_remittance := 'pending';
  elsif p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = v_branch;
  elsif p_method in ('bank', 'cheque') then
    select * into v_account from accounts where code = '1020' and active;
  else
    select * into v_account from accounts where code = '1030' and active;
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;

  v_receipt := next_number('receipt', v_branch);
  v_lines := jsonb_build_array(jsonb_build_object(
    'account', v_account.code, 'debit_cents', p_amount_cents, 'customer_id', v_loan.customer_id)
    || case when v_account.code = '1015' then jsonb_build_object('staff_id', auth.uid()) else '{}'::jsonb end);
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    if (v_split ->> v_component)::bigint > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', case v_component when 'penalty' then '1120' when 'interest' then '1110' else '1100' end,
        'credit_cents', (v_split ->> v_component)::bigint, 'loan_id', v_loan.id,
        'customer_id', v_loan.customer_id, 'component', v_component));
    end if;
  end loop;
  v_journal := post_journal(v_on, 'Payment ' || v_receipt || ' on ' || v_loan.loan_no,
                            case when p_field then 'field_payment' else 'payment' end, v_payment, v_branch, v_lines);

  insert into payments (id, receipt_no, loan_id, customer_id, branch_id, amount_cents, method, reference, received_on,
                        received_by, collected_in_field, remittance_status, idempotency_key, journal_id)
  values (v_payment, v_receipt, v_loan.id, v_loan.customer_id, v_branch, p_amount_cents, p_method, v_reference, v_on,
          auth.uid(), p_field, v_remittance, v_key, v_journal);
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    if (v_split ->> v_component)::bigint > 0 then
      insert into payment_allocations (payment_id, component, amount_cents)
      values (v_payment, v_component, (v_split ->> v_component)::bigint);
    end if;
  end loop;

  -- Close the loan when nothing is owed (SPEC 5.3); collateral release is prompted, not automatic.
  select penalty_cents + interest_cents + principal_cents into v_after from loan_owed(v_loan.id);
  if v_after = 0 then
    update loans set status = 'closed', closed_on = v_on, updated_at = app_now() where id = v_loan.id;
    perform write_audit('loan.closed', 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
                        jsonb_build_object('status', 'closed', 'closed_on', v_on, 'payment_id', v_payment));
  end if;

  perform write_audit('payment.received', 'payment', v_payment::text, null,
    jsonb_build_object('receipt_no', v_receipt, 'loan_no', v_loan.loan_no, 'amount_cents', p_amount_cents,
                       'method', p_method, 'reference', v_reference, 'received_on', v_on, 'field', p_field,
                       'allocation', v_split - 'unallocated', 'balance_after', v_after));
  return receipt_facts(v_payment) || jsonb_build_object('replayed', false);
end
$$;

create or replace function public.disburse_loan(
  p_loan_id uuid, p_method text, p_account_id uuid default null, p_disbursed_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_account accounts;
  v_on date;
  v_due date;
  v_check boolean;
  v_journal uuid;
  v_branch uuid;
begin
  perform require_role('cashier');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status <> 'approved' then
    raise exception 'INVALID_STATE: only an approved loan can be paid out' using errcode = '22023';
  end if;
  if (select status from customers where id = v_loan.customer_id) <> 'active' then
    raise exception 'INVALID_STATE: the customer is no longer active' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_disbursed_on);

  if p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = auth_branch();
  elsif p_method in ('bank', 'cheque') then
    select * into v_account from accounts where code = '1020' and active;
  elsif p_method = 'mobile_money' then
    select * into v_account from accounts where code = '1030' and active;
  else
    raise exception 'INVALID_STATE: the method must be cash, bank, mobile money or cheque' using errcode = '22023';
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;
  if p_account_id is not null and p_account_id <> v_account.id then
    raise exception 'INVALID_STATE: cash is paid from your branch cash account, bank and cheque from 1020, mobile money from 1030'
      using errcode = '22023';
  end if;

  if v_loan.collateral_required and not exists (
       select 1 from loan_collaterals where loan_id = v_loan.id and status = 'pledged') then
    raise exception 'COLLATERAL_REQUIRED: add collateral before paying out this loan' using errcode = '23514';
  end if;
  select coalesce((value #>> '{}')::boolean, true) into v_check from settings where key = 'disbursement.check_funds';
  if coalesce(v_check, true) and account_balance(v_account.id) < v_loan.principal_cents then
    raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay out', v_account.code using errcode = '23514';
  end if;

  v_due := add_months_clamped(v_on, v_loan.term_months);
  v_branch := coalesce(v_account.branch_id, v_loan.branch_id);
  v_journal := post_journal(v_on, 'Loan ' || v_loan.loan_no || ' paid out', 'disbursement', v_loan.id, v_branch,
    jsonb_build_array(
      jsonb_build_object('account', '1100', 'debit_cents', v_loan.principal_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id, 'component', 'principal'),
      jsonb_build_object('account', '1110', 'debit_cents', v_loan.interest_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id, 'component', 'interest'),
      jsonb_build_object('account', v_account.code, 'credit_cents', v_loan.principal_cents,
                         'customer_id', v_loan.customer_id),
      jsonb_build_object('account', '4000', 'credit_cents', v_loan.interest_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id)));

  update loans set status = 'active', disbursed_on = v_on, due_date = v_due, disbursed_by = auth.uid(),
                   disbursement_method = p_method, disbursement_account_id = v_account.id, updated_at = app_now()
   where id = v_loan.id;
  perform write_audit('loan.disbursed', 'loan', v_loan.id::text, jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'active', 'disbursed_on', v_on, 'due_date', v_due, 'method', p_method,
                       'account', v_account.code, 'journal_id', v_journal));
  return jsonb_build_object('journal_id', v_journal, 'journal_no', (select journal_no from journals where id = v_journal),
                            'due_date', v_due);
end
$$;

create or replace function public.recovery_account(p_method text, p_loan loans)
returns accounts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account accounts;
begin
  if p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = coalesce(auth_branch(), p_loan.branch_id);
  elsif p_method in ('bank', 'cheque') then
    select * into v_account from accounts where code = '1020' and active;
  elsif p_method = 'mobile_money' then
    select * into v_account from accounts where code = '1030' and active;
  else
    raise exception 'INVALID_STATE: the method must be cash, mobile money, bank or cheque' using errcode = '22023';
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;
  return v_account;
end
$$;

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
  if p_method not in ('cash', 'mobile_money', 'bank', 'cheque') then
    raise exception 'INVALID_STATE: the method must be cash, mobile money, bank or cheque' using errcode = '22023';
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
  elsif p_method in ('bank', 'cheque') then
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
