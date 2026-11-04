-- M3.1: loan products as configuration (SPEC 4, 7.1; FR-06).
begin;
\ir _helpers.psql
select plan(12);

select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset

select results_eq(
  $$select interest_rate_bps, default_term_months, penalty_rate_bps, penalty_period_days, penalty_base,
           penalty_max_periods, recovery_after_days from public.loan_products where name = 'Standard 1-month'$$,
  $$values (2000, 1, 2000, 7, 'outstanding_total'::text, 4, 30)$$,
  'the standard product is seeded with the A-02, A-03, A-06 and A-08 defaults');
select is(tests.value_as('authenticated', :'officer_id', $$select count(*) from public.loan_products where active$$)::int >= 1,
  true, 'staff read products');

select matches(tests.try_as('authenticated', :'manager_id', $$select public.upsert_loan_product('{
  "name": "Test 2-month", "interest_rate_bps": 1500, "default_term_months": 2, "max_term_months": 3,
  "penalty_rate_bps": 1000, "penalty_period_days": 7, "penalty_max_periods": 4, "recovery_after_days": 30}')$$),
  '^FORBIDDEN', 'only the admin manages products');
select is(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{
  "name": "Test 2-month", "interest_rate_bps": 1500, "default_term_months": 2, "max_term_months": 3,
  "penalty_rate_bps": 1000, "penalty_period_days": 7, "penalty_base": "original_due",
  "penalty_max_periods": 4, "recovery_after_days": 30}')$$), null, 'the admin creates a product');
select id as product_id from public.loan_products where name = 'Test 2-month' \gset
select is((select count(*)::int from public.audit_log where action = 'loan_product.created' and entity_id = :'product_id'), 1,
  'creation is audited');

select matches(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{
  "name": "Bad rate", "interest_rate_bps": 20.5, "default_term_months": 1, "max_term_months": 1,
  "penalty_rate_bps": 0, "penalty_period_days": 7, "penalty_max_periods": 0, "recovery_after_days": 30}')$$),
  '^INVALID_STATE', 'rates are whole basis points (no floats)');
select matches(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{
  "name": "Bad term", "interest_rate_bps": 2000, "default_term_months": 4, "max_term_months": 3,
  "penalty_rate_bps": 0, "penalty_period_days": 7, "penalty_max_periods": 0, "recovery_after_days": 30}')$$),
  '^INVALID_STATE', 'the default term cannot exceed the maximum');
select matches(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{
  "name": "Standard 1-month", "interest_rate_bps": 2000, "default_term_months": 1, "max_term_months": 1,
  "penalty_rate_bps": 0, "penalty_period_days": 7, "penalty_max_periods": 0, "recovery_after_days": 30}')$$),
  '^INVALID_STATE', 'product names are unique');
select matches(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{
  "name": "Weekly", "interest_rate_bps": 2000, "rate_period": "week", "default_term_months": 1, "max_term_months": 1,
  "penalty_rate_bps": 0, "penalty_period_days": 7, "penalty_max_periods": 0, "recovery_after_days": 30}')$$),
  '^INVALID_STATE', 'only monthly flat interest in this release (A-03)');

select is(tests.try_as('authenticated', :'admin_id', format(
  $$select public.upsert_loan_product('{"id": "%s", "interest_rate_bps": 1800, "active": false}')$$, :'product_id')),
  null, 'the admin changes a rate and deactivates the product');
select results_eq(
  format($$select (before ->> 'interest_rate_bps')::int, (after ->> 'interest_rate_bps')::int, (after ->> 'active')::boolean
           from public.audit_log where action = 'loan_product.updated' and entity_id = '%s'$$, :'product_id'),
  $$values (1500, 1800, false)$$, 'the change is audited with before and after');
select matches(tests.try_as('authenticated', :'admin_id',
  $$update public.loan_products set interest_rate_bps = 1 where name = 'Standard 1-month'$$),
  '^permission denied', 'products are written only through the RPC');

select * from finish();
rollback;
