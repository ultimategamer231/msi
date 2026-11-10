-- M4.3: payment voids and journal reversals (SPEC 5.4.9; FR-20; R8; T-25; B-12 default).
begin;
\ir _helpers.psql
select plan(19);

insert into public.branches (code, name) values ('TV', 'Test Voids');
select id as br from public.branches where code = 'TV' \gset
select tests.create_staff('Officer TV', 'loan_officer', 'TV') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Cashier TV', 'cashier', 'TV') as cashier_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-02-12T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
delete from public.period_locks;

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Void", "last_name": "Test", "phone": "0987 100 001",
  "id_type": "national_id", "id_number": "T9-100001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'T9-100001'),
  'product_id', :'product_id', 'principal_cents', 50000, 'term_months', 1)) as loan_id \gset
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
-- Pay it off completely: 60000 closes the loan.
select public.receive_payment(:'loan_id', 60000, 'cash', null, null, 'void-key-0001') ->> 'payment_id' as payment_id \gset
select tests.unbecome();
select is((select status from public.loans where id = :'loan_id'), 'closed', 'the loan is closed after full payment');

select matches(tests.try_as('authenticated', :'officer_id', format($$select public.request_void_payment('%s', 'Wrong loan')$$, :'payment_id')),
  '^FORBIDDEN', 'a loan officer cannot request a void');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.request_void_payment('%s', ' ')$$, :'payment_id')),
  '^INVALID_STATE', 'a void needs a reason');

-- T-25: a void approved by its requester is refused.
select is(tests.try_as('authenticated', :'manager_id', format($$select public.request_void_payment('%s', 'Entered on the wrong loan')$$, :'payment_id')),
  null, 'a manager requests the void');
select id as void_request from public.approval_requests where type = 'payment_void' and entity_id = :'payment_id' \gset
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'void_request')),
  '^SELF_APPROVAL', 'T-25: the requester cannot approve the void');
select is((select status from public.payments where id = :'payment_id'), 'posted', 'nothing changes yet');

select is(tests.try_as('authenticated', :'manager2_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'void_request')),
  null, 'another manager approves');
select results_eq(format($$select status, void_journal_id is not null from public.payments where id = '%s'$$, :'payment_id'),
  $$values ('voided'::text, true)$$, 'T-25: the payment is marked void');
select is((select reversal_of from public.journals where id = (select void_journal_id from public.payments where id = :'payment_id')),
  (select journal_id from public.payments where id = :'payment_id'), 'T-25: the reversing journal points to the original');
select results_eq(format($$select penalty_cents, interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_id'),
  $$values (0::bigint, 10000::bigint, 50000::bigint)$$, 'T-25: balances are restored');
select is((select status from public.loans where id = :'loan_id'), 'active', 'the closed loan opens again');
select is((select count(*)::int from public.journals where id = (select journal_id from public.payments where id = :'payment_id')), 1,
  'the original journal is untouched');
select is(public.verify_journal_chain(), null, 'the journal chain still verifies');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.request_void_payment('%s', 'Again')$$, :'payment_id')),
  '^INVALID_STATE', 'a voided payment cannot be voided again');

-- Journal reversal (B-12 default).
select tests.become('authenticated', :'accountant_id');
select public.request_manual_journal(jsonb_build_object('entry_date', '2026-02-12', 'memo', 'Rent paid twice', 'branch_id', :'br',
  'lines', '[{"account": "5010", "debit_cents": 7000}, {"account": "1010-TV", "credit_cents": 7000}]'::jsonb));
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where type = 'manual_journal' and payload ->> 'memo' = 'Rent paid twice'), 'approve', null);
select tests.unbecome();
select id as rent_journal from public.journals where memo = 'Rent paid twice' \gset
select matches(tests.try_as('authenticated', :'accountant_id', format($$select public.request_journal_reversal('%s', 'Wrong')$$,
  (select journal_id from public.payments where id = :'payment_id'))), '^INVALID_STATE', 'payment journals are voided, not reversed');
select is(tests.try_as('authenticated', :'accountant_id', format($$select public.request_journal_reversal('%s', 'Rent was entered twice')$$, :'rent_journal')),
  null, 'the accountant requests the reversal of a manual journal');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval(
  (select id from public.approval_requests where type = 'journal_reversal' and entity_id = '%s'), 'approve', null)$$, :'rent_journal')),
  null, 'a manager approves it');
select results_eq(format($$select a.code, l.debit_cents, l.credit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
                           where l.journal_id = (select id from public.journals where reversal_of = '%s') order by l.line_no$$, :'rent_journal'),
  $$values ('5010'::text, 0::bigint, 7000::bigint), ('1010-TV', 7000, 0)$$, 'R8: the same lines with debit and credit swapped');
select matches(tests.try_as('authenticated', :'accountant_id', format($$select public.request_journal_reversal('%s', 'Again')$$, :'rent_journal')),
  '^INVALID_STATE', 'a journal is reversed only once');

select * from finish();
rollback;
