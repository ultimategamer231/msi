-- M4.1: office payments (SPEC 5.2 allocation, 5.4; R2; T-06 allocation, T-10, T-11, T-12, T-37).
begin;
\ir _helpers.psql
select plan(26);

insert into public.branches (code, name) values ('TP', 'Test Payments');
select id as br from public.branches where code = 'TP' \gset
select tests.create_staff('Officer TP', 'loan_officer', 'TP') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TP', 'cashier', 'TP') as cashier_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-02-12T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

-- An active loan of 100000 (interest 20000) with a week-1 penalty of 24000: owes 144000 (T-03/T-06).
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Pay", "last_name": "Ment", "phone": "0989 100 001",
  "id_type": "national_id", "id_number": "T7-100001"}')$$);
create function tests.active_loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_customer uuid, p_product uuid, p_amount bigint)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform tests.become('authenticated', p_officer);
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', p_customer, 'product_id', p_product,
                                                      'principal_cents', p_amount, 'term_months', 1));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;
select tests.active_loan(:'officer_id', :'manager_id', :'cashier_id',
  (select id from public.customers where id_number = 'T7-100001'), :'product_id', 100000) as loan_id \gset
select tests.become('authenticated', :'manager_id');
select set_config('role', 'postgres', true);
select public.post_journal('2026-02-12', 'Test week-1 penalty', 'penalty', null, :'br', format($$[
  {"account": "1120", "debit_cents": 24000, "loan_id": "%1$s", "component": "penalty"},
  {"account": "4010", "credit_cents": 24000}]$$, :'loan_id')::jsonb);
select tests.unbecome();

-- Who may take a payment.
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.receive_payment('%s', 1000, 'cash', null, null, 'key-officer-1')$$, :'loan_id')),
  '^FORBIDDEN', 'a loan officer uses the field flow, not the office flow');
select matches(tests.try_as('authenticated', :'accountant_id', format(
  $$select public.receive_payment('%s', 1000, 'cash', null, null, 'key-acct-0001')$$, :'loan_id')),
  '^FORBIDDEN', 'an accountant does not take payments of the day');

-- T-10, T-11 and input checks.
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 144001, 'cash', null, null, 'key-over-0001')$$, :'loan_id')),
  '^OVERPAYMENT', 'T-10: more than the 144000 owed is refused');
select is((select count(*)::int from public.payments where loan_id = :'loan_id'), 0, 'T-10: nothing is posted');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 5000, 'mobile_money', null, null, 'key-momo-0001')$$, :'loan_id')),
  '^REFERENCE_REQUIRED', 'T-11: mobile money without a reference');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 5000, 'bank', 'ab', null, 'key-bank-0001')$$, :'loan_id')),
  '^REFERENCE_REQUIRED', 'a bank reference needs at least 4 characters');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 0, 'cash', null, null, 'key-zero-0001')$$, :'loan_id')),
  '^INVALID_STATE', 'a zero amount is refused (SPEC 5.2)');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 5000, 'cash', null, '2026-02-11', 'key-date-0001')$$, :'loan_id')),
  '^DATE_NOT_ALLOWED', 'a cashier cannot back-date a payment');

-- The screen's preview uses the same split the posting will (mock-up 03).
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.preview_payment('%s', 50000)::text$$, :'loan_id'))::jsonb,
  '{"owed": {"penalty": 24000, "interest": 20000, "principal": 100000, "total": 144000},
    "allocation": {"penalty": 24000, "interest": 20000, "principal": 6000}, "after_cents": 94000, "overpayment": false}'::jsonb,
  'the preview shows penalty, interest, principal and what is still owed after');
select is((tests.value_as('authenticated', :'cashier_id', format($$select public.preview_payment('%s', 144001)::text$$, :'loan_id'))::jsonb) ->> 'overpayment',
  'true', 'the preview flags an overpayment');

-- T-06 (allocation part): 50000 after the week-1 penalty.
select is(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 50000, 'cash', null, null, 'key-t06-00001')$$, :'loan_id')), null,
  'the cashier takes 50000 in cash');
select id as payment_id from public.payments where loan_id = :'loan_id' \gset
select results_eq(format($$select component, amount_cents from public.payment_allocations where payment_id = '%s'
                          order by case component when 'penalty' then 1 when 'interest' then 2 else 3 end$$, :'payment_id'),
  $$values ('penalty'::text, 24000::bigint), ('interest', 20000), ('principal', 6000)$$,
  'T-06: penalty 24000, then interest 20000, then principal 6000');
select results_eq(format($$select penalty_cents, interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_id'),
  $$values (0::bigint, 0::bigint, 94000::bigint)$$, 'T-06: remaining principal 94000');
select matches((select receipt_no from public.payments where id = :'payment_id'), '^RCT-TP-[0-9]{6}$',
  'the receipt is numbered in the cashier''s branch series');
select results_eq(
  format($$select a.code, l.debit_cents, l.credit_cents, l.component from public.journal_lines l
             join public.accounts a on a.id = l.account_id
            where l.journal_id = (select journal_id from public.payments where id = '%s') order by l.line_no$$, :'payment_id'),
  $$values ('1010-TP'::text, 50000::bigint, 0::bigint, null::text), ('1120', 0, 24000, 'penalty'),
           ('1110', 0, 20000, 'interest'), ('1100', 0, 6000, 'principal')$$,
  'R2: Dr branch cash, Cr penalty, interest and principal receivables');
select is((select count(*)::int from public.audit_log where action = 'payment.received' and entity_id = :'payment_id'), 1,
  'the payment is audited');

-- T-12: the same key again returns the original receipt and posts nothing.
select is((tests.value_as('authenticated', :'cashier_id', format(
  $$select (public.receive_payment('%s', 50000, 'cash', null, null, 'key-t06-00001') ->> 'receipt_no')$$, :'loan_id'))),
  (select receipt_no from public.payments where id = :'payment_id'), 'T-12: the original receipt is returned');
select is((select count(*)::int from public.payments where loan_id = :'loan_id'), 1, 'T-12: one payment');
select is((select count(*)::int from public.journals where source_type = 'payment' and source_id = :'payment_id'), 1,
  'T-12: one journal');

-- Mobile money with a reference goes to 1030; paying the rest closes the loan.
select is(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 4000, 'mobile_money', 'OM-7731904', null, 'key-momo-0002')$$, :'loan_id')), null,
  'mobile money with a reference is accepted');
select is((select a.code from public.payments p join public.journal_lines l on l.journal_id = p.journal_id and l.debit_cents > 0
             join public.accounts a on a.id = l.account_id where p.reference = 'OM-7731904'), '1030',
  'mobile money is debited to 1030');
select is(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 90000, 'cash', null, null, 'key-final-001')$$, :'loan_id')), null,
  'the final payment is accepted');
select results_eq(format($$select status, closed_on from public.loans where id = '%s'$$, :'loan_id'),
  $$values ('closed'::text, '2026-02-12'::date)$$, 'the loan closes when nothing is owed (SPEC 5.3)');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.receive_payment('%s', 100, 'cash', null, null, 'key-after-001')$$, :'loan_id')),
  '^INVALID_STATE', 'no payment on a closed loan');

-- T-37: after go-live, a back-dated entry by the accountant is refused.
select tests.active_loan(:'officer_id', :'manager_id', :'cashier_id',
  (select id from public.customers where id_number = 'T7-100001'), :'product_id', 50000) as loan_b \gset
update public.settings set value = '"2026-02-01"' where key = 'migration.go_live_date';
select matches(tests.try_as('authenticated', :'accountant_id', format(
  $$select public.receive_payment('%s', 1000, 'cash', null, '2026-02-11', 'key-t37-00001')$$, :'loan_b')),
  '^DATE_NOT_ALLOWED', 'T-37: after go-live the accountant cannot post a payment dated yesterday');
update public.settings set value = 'null' where key = 'migration.go_live_date';
select is(tests.try_as('authenticated', :'accountant_id', format(
  $$select public.receive_payment('%s', 1000, 'cash', null, '2026-02-11', 'key-t37-00002')$$, :'loan_b')), null,
  'before go-live the accountant may enter a paper payment with its own date (A-19)');

select * from finish();
rollback;
