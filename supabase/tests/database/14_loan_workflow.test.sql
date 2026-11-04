-- M3.3: loan applications (SPEC 4, 5.3, 8; FR-07): T-17, T-18, T-19.
begin;
\ir _helpers.psql
select plan(27);

select id as br1 from public.branches where code = 'BR1' \gset
select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Officer One', 'loan_officer', 'BR1') as officer_br1_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Chief Exec', 'ceo') as ceo_id \gset
select tests.create_staff('Cashier Two', 'cashier', 'BR2') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '200000' where key = 'approvals.loan_manager_limit_cents';
update public.settings set value = '{"at": "2026-02-11T10:00:00Z", "frozen": true}' where key = 'clock.override_at';

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Loan", "last_name": "Test", "phone": "0995 100 001",
  "id_type": "national_id", "id_number": "T4-100001"}')$$);
select id as customer_id from public.customers where id_number = 'T4-100001' \gset

-- Who may apply.
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 100000, "term_months": 1}')$$, :'customer_id', :'product_id')),
  '^FORBIDDEN', 'a cashier cannot create a loan application');
select matches(tests.try_as('authenticated', :'officer_br1_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 100000, "term_months": 1}')$$, :'customer_id', :'product_id')),
  '^FORBIDDEN', 'a loan officer applies only for customers of their own branch');

-- Validation.
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 1000.5, "term_months": 1}')$$, :'customer_id', :'product_id')),
  '^INVALID_STATE', 'the amount is whole cents');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 100000, "term_months": 4}')$$, :'customer_id', :'product_id')),
  '^INVALID_STATE', 'the term cannot exceed the product maximum');

-- A draft with a guarantor.
select is(tests.try_as('authenticated', :'officer_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 200000, "term_months": 1, "purpose": "Market stock",
  "guarantors": [{"full_name": "Joseph Test", "phone": "0995 100 014", "relationship": "Brother"}]}')$$,
  :'customer_id', :'product_id')), null, 'a loan officer creates a draft with a guarantor');
select id as loan_a from public.loans where customer_id = :'customer_id' and principal_cents = 200000 \gset
select results_eq(format($$select status, branch_id, officer_id, interest_cents from public.loans where id = '%s'$$, :'loan_a'),
  format($$values ('draft'::text, '%s'::uuid, '%s'::uuid, null::bigint)$$, :'br2', :'officer_id'),
  'the draft belongs to the customer''s branch and officer; no snapshot yet');
select matches((select loan_no from public.loans where id = :'loan_a'), '^LN-BR2-[0-9]{5}$', 'the loan number carries the branch (B-02)');
select is((select count(*)::int from public.guarantors where loan_id = :'loan_a'), 1, 'the guarantor is stored with the loan');
select is((select count(*)::int from public.audit_log where action = 'loan.created' and entity_id = :'loan_a'), 1, 'creation is audited');

select matches(tests.try_as('authenticated', :'officer_br1_id', format($$select public.update_loan_draft('%s', '{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 150000, "term_months": 1}')$$, :'loan_a', :'customer_id', :'product_id')),
  '^FORBIDDEN', 'only the creator can change a draft');
select is(tests.try_as('authenticated', :'officer_id', format($$select public.update_loan_draft('%s', '{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 200000, "term_months": 1, "purpose": "Market stock and rent"}')$$,
  :'loan_a', :'customer_id', :'product_id')), null, 'the creator changes the draft');

-- T-19: 200000 (the limit) goes to a manager.
select is(tests.try_as('authenticated', :'officer_id', format($$select public.submit_loan('%s')$$, :'loan_a')), null,
  'the officer submits the loan');
select results_eq(
  format($$select l.status, l.interest_cents, l.interest_rate_bps, l.penalty_rate_bps, l.collateral_required, r.required_role::text
           from public.loans l join public.approval_requests r on r.entity_id = l.id and r.type = 'loan_approval'
          where l.id = '%s'$$, :'loan_a'),
  $$values ('pending_approval'::text, 40000::bigint, 2000, 2000, true, 'manager'::text)$$,
  'T-19: 200000 is routed to a manager; the product rules and interest are snapshotted');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.update_loan_draft('%s', '{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 100000, "term_months": 1}')$$, :'loan_a', :'customer_id', :'product_id')),
  '^INVALID_STATE', 'a submitted loan can no longer be changed');

-- T-18: 250000 goes to the CEO; a manager gets FORBIDDEN.
select tests.try_as('authenticated', :'manager_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 250000, "term_months": 1}')$$, :'customer_id', :'product_id'));
select id as loan_b from public.loans where customer_id = :'customer_id' and principal_cents = 250000 \gset
select is((select officer_id from public.loans where id = :'loan_b'), :'officer_id'::uuid,
  'a manager''s draft takes the customer''s assigned officer');
select tests.try_as('authenticated', :'manager_id', format($$select public.submit_loan('%s')$$, :'loan_b'));
select id as request_b from public.approval_requests where entity_id = :'loan_b' \gset
select is((select required_role::text from public.approval_requests where id = :'request_b'), 'ceo',
  'T-18: 250000 is above the manager limit and needs the CEO');
select matches(tests.try_as('authenticated', :'manager2_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'request_b')),
  '^FORBIDDEN', 'T-18: a manager cannot approve it');

-- T-17: the creator cannot approve their own loan.
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'request_b')),
  '^SELF_APPROVAL', 'T-17: the loan''s creator cannot approve it');
select is(tests.try_as('authenticated', :'ceo_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'request_b')),
  null, 'the CEO approves it');
select results_eq(format($$select status, approved_by from public.loans where id = '%s'$$, :'loan_b'),
  format($$values ('approved'::text, '%s'::uuid)$$, :'ceo_id'), 'the loan is approved by the CEO');

-- A manager decides the manager-level loan; a rejection rejects the loan.
select id as request_a from public.approval_requests where entity_id = :'loan_a' \gset
select is(tests.try_as('authenticated', :'manager2_id', format($$select public.decide_approval('%s', 'reject', 'Income not shown')$$, :'request_a')),
  null, 'a manager rejects the loan with a reason');
select is((select status from public.loans where id = :'loan_a'), 'rejected', 'the loan is rejected');
select is((select count(*)::int from public.audit_log where entity_id = :'loan_a' and action in ('loan.submitted', 'loan.rejected')), 2,
  'submission and rejection are audited');

-- Cancelling.
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.cancel_loan('%s', null)$$, :'loan_b')),
  '^INVALID_STATE', 'cancelling an approved loan needs a reason');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.cancel_loan('%s', 'Customer withdrew')$$, :'loan_b')),
  null, 'an approved loan that is not paid out can be cancelled');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.cancel_loan('%s', 'x')$$, :'loan_a')),
  '^INVALID_STATE', 'a rejected loan cannot be cancelled');

-- No new loan for a blacklisted customer.
update public.customers set status = 'blacklisted' where id = :'customer_id';
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_loan_draft('{
  "customer_id": "%s", "product_id": "%s", "principal_cents": 100000, "term_months": 1}')$$, :'customer_id', :'product_id')),
  '^INVALID_STATE', 'a blacklisted customer cannot get a new loan');

select * from finish();
rollback;
