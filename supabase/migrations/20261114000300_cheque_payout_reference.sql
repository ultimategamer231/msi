-- Cheque payouts (Foday, 2026-11-09): the cheque number is required when a loan is paid out by
-- cheque and is kept in the payout journal's memo ("Loan LN-… paid out, cheque 004512"). Other
-- methods may give a reference too. Same function otherwise; the extra argument is optional.
drop function public.disburse_loan(uuid, text, uuid, date);

create or replace function public.disburse_loan(
  p_loan_id uuid, p_method text, p_account_id uuid default null, p_disbursed_on date default null, p_reference text default null)
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

  if p_method = 'cheque' and length(btrim(coalesce(p_reference, ''))) < 4 then
    raise exception 'REFERENCE_REQUIRED: enter the cheque number' using errcode = '22023';
  end if;
  if length(p_reference) > 100 then
    raise exception 'INVALID_STATE: the reference is too long' using errcode = '22023';
  end if;
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
  v_journal := post_journal(v_on, 'Loan ' || v_loan.loan_no || ' paid out'
    || case when nullif(btrim(coalesce(p_reference, '')), '') is null then ''
            when p_method = 'cheque' then ', cheque ' || btrim(p_reference)
            else ', ref ' || btrim(p_reference) end, 'disbursement', v_loan.id, v_branch,
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

revoke execute on function public.disburse_loan(uuid, text, uuid, date, text) from public, anon, service_role;
grant execute on function public.disburse_loan(uuid, text, uuid, date, text) to authenticated;
