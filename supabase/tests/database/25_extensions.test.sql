-- M5.4: loan extension (SPEC 5.6; FR-18; A-09; T-13).
begin;
\ir _helpers.psql
select plan(16);

insert into public.branches (code, name) values ('TX', 'Test Extension');
select tests.create_staff('Officer TX', 'loan_officer', 'TX') as officer_id \gset
select tests.create_staff('Officer Other', 'loan_officer', 'BR3') as officer3_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Cashier TX', 'cashier', 'TX') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = 'true' where key = 'extension.enabled';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
select tests.set_day('2026-01-05');
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Extend", "last_name": "Test", "phone": "0982 100 001",
  "id_type": "national_id", "id_number": "TX-100001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'TX-100001'),
  'product_id', :'product_id', 'principal_cents', 100000, 'term_months', 1)) as loan_id \gset
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
select tests.unbecome();

-- Overdue on 10 Feb, before the first penalty (12 Feb).
select tests.set_day('2026-02-10');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select is((select status from public.loans where id = :'loan_id'), 'overdue', 'the loan is overdue');

select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.request_extension('%s', 1, 'Stock delayed')$$, :'loan_id')),
  '^FORBIDDEN', 'a cashier cannot ask for an extension');
select matches(tests.try_as('authenticated', :'officer3_id', format($$select public.request_extension('%s', 1, 'Stock delayed')$$, :'loan_id')),
  '^FORBIDDEN', 'an officer of another branch cannot either');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.request_extension('%s', 1, ' ')$$, :'loan_id')),
  '^INVALID_STATE', 'a reason is required');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.request_extension('%s', 4, 'Stock delayed')$$, :'loan_id')),
  '^INVALID_STATE', 'at most the product''s longest term (3 months)');
update public.settings set value = 'false' where key = 'extension.enabled';
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.request_extension('%s', 1, 'Stock delayed')$$, :'loan_id')),
  '^INVALID_STATE', 'refused while extensions are switched off');
update public.settings set value = 'true' where key = 'extension.enabled';

select is(tests.try_as('authenticated', :'officer_id', format($$select public.request_extension('%s', 1, 'Shop stock delayed at port')$$, :'loan_id')),
  null, 'the officer asks for one more month');
select results_eq($$select payload ->> 'extra_interest_cents', payload ->> 'new_due_date', payload ->> 'owed_after_cents',
                          payload ->> 'next_penalty_on', required_role::text
                     from public.approval_requests where type = 'loan_extension'$$,
  $$values ('20000'::text, '2026-03-05'::text, '140000'::text, '2026-02-12'::text, 'manager'::text)$$,
  'the request shows 20000 more interest, due 05 Mar, 140000 owed, and the penalty it avoids');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.request_extension('%s', 1, 'Again')$$, :'loan_id')),
  '^INVALID_STATE', 'one extension request at a time');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.decide_approval(
  (select id from public.approval_requests where type = 'loan_extension'), 'approve', null)$$),
  '^FORBIDDEN', 'an officer does not decide');

-- T-13: approved by a manager.
select is(tests.try_as('authenticated', :'manager_id', $$select public.decide_approval(
  (select id from public.approval_requests where type = 'loan_extension'), 'approve', null)$$), null, 'a manager approves');
select results_eq(format($$select status, due_date, due_date_version, recovery_eligible from public.loans where id = '%s'$$, :'loan_id'),
  $$values ('active'::text, '2026-03-05'::date, 2, false)$$, 'T-13: due date +1 month, version 2, active again');
select results_eq(format($$select interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_id'),
  $$values (40000::bigint, 100000::bigint)$$, 'T-13: 20000 extra interest (R5)');
select results_eq(format($$select extra_months, old_due_date, new_due_date, extra_interest_cents from public.loan_extensions where loan_id = '%s'$$, :'loan_id'),
  $$values (1, '2026-02-05'::date, '2026-03-05'::date, 20000::bigint)$$, 'the extension is recorded');

-- T-13: penalties restart at period 1 of the new due date.
select tests.set_day('2026-03-12');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select results_eq(format($$select due_date_version, period_no, charged_on, penalty_cents from public.loan_penalty_events where loan_id = '%s'$$, :'loan_id'),
  $$values (2, 1, '2026-03-12'::date, 28000::bigint)$$, 'T-13: penalty 1 of the new term, 20% of 140000');

-- A loan in recovery cannot be extended (recovery cases arrive in M6; the status is set directly here).
update public.loans set status = 'recovery' where id = :'loan_id';
select matches(tests.try_as('authenticated', :'manager2_id', format($$select public.request_extension('%s', 1, 'Late again')$$, :'loan_id')),
  '^INVALID_STATE', 'no extension in recovery');

select * from finish();
rollback;
