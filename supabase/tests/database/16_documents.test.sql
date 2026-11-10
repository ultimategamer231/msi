-- M3.7: issued documents and the loan agreement number (SPEC 7.5, 8, 10.1; FR-25).
begin;
\ir _helpers.psql
select plan(8);

select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier Two', 'cashier', 'BR2') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Doc", "last_name": "Test", "phone": "0991 100 001",
  "id_type": "national_id", "id_number": "T6-100001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'T6-100001'),
  'product_id', :'product_id', 'principal_cents', 100000, 'term_months', 1)) as loan_id \gset
select tests.unbecome();

select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.issue_document('loan_agreement', '%s')$$, :'loan_id')),
  '^INVALID_STATE', 'no agreement for a draft');

select tests.become('authenticated', :'officer_id');
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.unbecome();

select is(tests.try_as('authenticated', :'cashier_id', format($$select public.issue_document('loan_agreement', '%s')$$, :'loan_id')),
  null, 'any staff member prints the agreement of an approved loan');
select results_eq(
  format($$select number, kind, length(token) >= 22 from public.issued_documents where entity_id = '%s'$$, :'loan_id'),
  format($$values ('AGR-' || (select loan_no from public.loans where id = '%s'), 'loan_agreement'::text, true)$$, :'loan_id'),
  'the agreement is numbered after the loan and has a long random token');
select tests.try_as('authenticated', :'officer_id', format($$select public.issue_document('loan_agreement', '%s')$$, :'loan_id'));
select is((select count(*)::int from public.issued_documents where entity_id = :'loan_id'), 1,
  'a reprint returns the same document');
select is((select count(*)::int from public.audit_log where action = 'document.issued' and after ->> 'entity_id' = :'loan_id'), 1,
  'issuing is audited once');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.issue_document('receipt', '%s')$$, :'loan_id')),
  '^INVALID_STATE', 'other kinds arrive with their milestones');
select matches(tests.try_as('anon', null, format($$select public.issue_document('loan_agreement', '%s')$$, :'loan_id')),
  '^permission denied', 'anonymous users cannot issue documents');
select ok((select value ->> 'loan_agreement' like '%Republic of Liberia%' and value ->> 'loan_agreement' not like '%PLACEHOLDER%'
             from public.settings where key = 'templates'),
  'the agreement carries the standard wording MSI accepted (SPEC 10.1; client answer 2026-11-09)');

select * from finish();
rollback;
