-- Client answers 2026-11-09: cheques, collateral types, head-office contact, standard wording.
begin;
\ir _helpers.psql
select plan(10);

insert into public.branches (code, name) values ('TQ', 'Test Cheques');
select tests.create_staff('Officer TQ', 'loan_officer', 'TQ') as officer_id \gset
select tests.create_staff('Manager TQ', 'manager') as manager_id \gset
select tests.create_staff('Cashier TQ', 'cashier', 'TQ') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-01-05T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
delete from public.period_locks;

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Cheque", "last_name": "Payer", "phone": "0978 300 001",
  "id_type": "national_id", "id_number": "TQ-300001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.register_collateral(jsonb_build_object('owner_customer_id', (select id from public.customers where id_number = 'TQ-300001'),
  'type', 'gold', 'description', 'Gold necklace, 22 carat', 'estimated_value_cents', 90000, 'location_note', 'Safe')) as item_id \gset
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'TQ-300001'),
  'product_id', :'product_id', 'principal_cents', 50000, 'term_months', 1)) as loan_id \gset
select public.link_collateral(:'loan_id', :'item_id');
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.unbecome();

select is((select type from public.collaterals where id = :'item_id'), 'gold', 'gold is a collateral type');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.disburse_loan('%s', 'cheque', null, null)$$, :'loan_id')),
  '^REFERENCE_REQUIRED', 'a cheque payout needs the cheque number');
select is(tests.try_as('authenticated', :'cashier_id', format($$select public.disburse_loan('%s', 'cheque', null, null, ' 004512 ')$$, :'loan_id')), null,
  'a loan can be paid out by cheque');
select is((select memo from public.journals where source_type = 'disbursement' and source_id = :'loan_id'),
  (select 'Loan ' || loan_no || ' paid out, cheque 004512' from public.loans where id = :'loan_id'), 'the cheque number is kept in the payout memo');
select results_eq(format($$select a.code from public.journal_lines l join public.accounts a on a.id = l.account_id
                           join public.journals j on j.id = l.journal_id where j.source_type = 'disbursement' and j.source_id = '%s' and l.credit_cents > 0 and a.code like '10%%'$$, :'loan_id'),
  $$values ('1020'::text)$$, 'a cheque payout comes out of the bank (1020)');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 10000, 'cheque', '', null, 'cheque-key-0001')$$, :'loan_id')),
  '^REFERENCE_REQUIRED', 'a cheque payment needs the cheque number');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 10000, 'cheque', 'CHQ 004512', null, 'cheque-key-0002')$$, :'loan_id'));
select results_eq(format($$select p.method, a.code from public.payments p join public.journal_lines l on l.journal_id = p.journal_id and l.debit_cents > 0
                           join public.accounts a on a.id = l.account_id where p.loan_id = '%s'$$, :'loan_id'),
  $$values ('cheque'::text, '1020'::text)$$, 'a cheque payment goes to the bank (1020)');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.record_field_payment('%s', 5000, 'cheque', 'CHQ 1', null, 'cheque-key-0003')$$, :'loan_id')),
  '^INVALID_STATE: cheques are taken at the office', 'officers do not take cheques in the field');

select is((select value ->> 'address' from public.settings where key = 'company'),
  'Peace Community, Mamba District #1, Margibi County, Liberia', 'the head-office address prints on documents');
select ok((select value ->> 'demand_notice' not like '%PLACEHOLDER%' and value ->> 'demand_notice' like '%hereby required to pay%'
             from public.settings where key = 'templates'), 'the demand notice carries the standard wording');

select * from finish();
rollback;
