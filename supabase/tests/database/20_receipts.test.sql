-- M4.5: receipts (SPEC 10.1; FR-25; T-25 "receipt marked VOID").
begin;
\ir _helpers.psql
select plan(9);

insert into public.branches (code, name) values ('TR', 'Test Receipts');
select tests.create_staff('Officer TR', 'loan_officer', 'TR') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Cashier TR', 'cashier', 'TR') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-02-12T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
delete from public.period_locks;

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Receipt", "last_name": "Test", "phone": "0986 100 001",
  "id_type": "national_id", "id_number": "T10-100001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'T10-100001'),
  'product_id', :'product_id', 'principal_cents', 100000, 'term_months', 1)) as loan_id \gset
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
select public.receive_payment(:'loan_id', 50000, 'cash', null, null, 'rcpt-key-0001') ->> 'payment_id' as first_id \gset
select public.receive_payment(:'loan_id', 30000, 'cash', null, null, 'rcpt-key-0002') ->> 'payment_id' as second_id \gset
select public.issue_document('receipt', :'first_id') as first_doc \gset
select tests.unbecome();

select is((:'first_doc'::jsonb) ->> 'number', (select receipt_no from public.payments where id = :'first_id'),
  'the receipt document carries the receipt number');
select is((tests.value_as('authenticated', :'officer_id', format($$select public.issue_document('receipt', '%s')::text$$, :'first_id'))::jsonb) ->> 'token',
  (:'first_doc'::jsonb) ->> 'token', 'a reprint by anyone on the staff returns the same token');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_balance_after('%s')::text$$, :'first_id')),
  '70000', 'balance after the first payment: 120000 - 50000');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_balance_after('%s')::text$$, :'second_id')),
  '40000', 'balance after the second payment');
select matches(tests.try_as('anon', null, format($$select public.receipt_balance_after('%s')$$, :'first_id')),
  'permission denied', 'not for the public');

-- T-25: after the void the receipt is marked VOID, printed or not.
select tests.try_as('authenticated', :'cashier_id', format($$select public.request_void_payment('%s', 'Wrong amount')$$, :'first_id'));
select tests.try_as('authenticated', :'cashier_id', format($$select public.request_void_payment('%s', 'Wrong amount')$$, :'second_id'));
select tests.try_as('authenticated', :'manager2_id', $$select public.decide_approval(id, 'approve', null)
  from public.approval_requests where type = 'payment_void' and status = 'pending' and reason = 'Wrong amount'
  order by requested_at limit 1$$);
select tests.try_as('authenticated', :'manager2_id', $$select public.decide_approval(id, 'approve', null)
  from public.approval_requests where type = 'payment_void' and status = 'pending' and reason = 'Wrong amount'
  order by requested_at limit 1$$);
select is((tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('receipt', '%s')::text$$, :'first_id'))::jsonb) ->> 'is_void',
  'true', 'T-25: the printed receipt is now VOID');
select is((tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('receipt', '%s')::text$$, :'first_id'))::jsonb) ->> 'token',
  (:'first_doc'::jsonb) ->> 'token', 'it keeps its number and token');
select is((tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('receipt', '%s')::text$$, :'second_id'))::jsonb) ->> 'is_void',
  'true', 'a receipt first printed after its void prints VOID too');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_balance_after('%s')::text$$, :'first_id')),
  '70000', 'the balance printed on a receipt does not change afterwards');

select * from finish();
rollback;
