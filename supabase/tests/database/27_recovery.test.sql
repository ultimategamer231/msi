-- M6.3: recovery cases and collateral sale (SPEC 5.7; FR-17; A-08, A-14; B-04, B-05; T-14, T-15).
begin;
\ir _helpers.psql
select plan(22);

insert into public.branches (code, name) values ('TR2', 'Test Recovery');
select tests.create_staff('Officer TR', 'loan_officer', 'TR2') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TR', 'cashier', 'TR2') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
-- A loan of 100000 paid out 05 Jan 2026 (due 05 Feb), secured by one item; returns the loan id.
create function tests.secured_loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid, p_item text)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid; v_item uuid;
begin
  perform tests.set_day('2026-01-05');
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Recovery', 'last_name', p_id_number,
    'phone', '0980 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_item := public.register_collateral(jsonb_build_object('owner_customer_id', v_customer, 'type', 'vehicle',
    'description', p_item, 'plate_no', p_id_number, 'estimated_value_cents', 420000, 'location_note', 'Yard'));
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', 100000, 'term_months', 1));
  perform public.link_collateral(v_id, v_item);
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;

select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TR-100001', :'product_id', 'Toyota Corolla') as loan_a \gset
select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TR-100002', :'product_id', 'Nissan Sunny') as loan_b \gset
select collateral_id as item_a from public.loan_collaterals where loan_id = :'loan_a' \gset
select collateral_id as item_b from public.loan_collaterals where loan_id = :'loan_b' \gset
-- Loan A could take up to 6 penalties, so the stop when a case opens can be seen.
update public.loans set penalty_max_periods = 6 where id = :'loan_a';

-- Day 29: four penalties each (owes 248832), not yet eligible.
select tests.set_day('2026-03-06');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.open_recovery_case('%s', 'Too early')$$, :'loan_a')),
  '^INVALID_STATE', 'no case before the loan is eligible (30 days)');
select tests.set_day('2026-03-07');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select is((select recovery_eligible from public.loans where id = :'loan_a'), true, 'eligible on day 30 (A-08)');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.open_recovery_case('%s', 'Open')$$, :'loan_a')),
  '^FORBIDDEN', 'a loan officer does not open cases');

select tests.value_as('authenticated', :'manager_id', format($$select public.open_recovery_case('%s', 'No reply to calls')::text$$, :'loan_a')) as case_a \gset
select tests.value_as('authenticated', :'manager_id', format($$select public.open_recovery_case('%s', 'Customer left town')::text$$, :'loan_b')) as case_b \gset
select results_eq(format($$select stage, case_no ~ '^RC-[0-9]{6}$' from public.recovery_cases where id = '%s'$$, :'case_a'),
  $$values ('opened'::text, true)$$, 'B-04, B-05: case RC-…, first stage "opened"');
select results_eq(format($$select l.status, c.status, lc.status from public.loans l join public.loan_collaterals lc on lc.loan_id = l.id
                           join public.collaterals c on c.id = lc.collateral_id where l.id = '%s'$$, :'loan_a'),
  $$values ('recovery'::text, 'in_recovery'::text, 'seized'::text)$$, 'loan in recovery, item seized');
select is((select count(*)::int from public.collateral_events where collateral_id = :'item_a' and event_type = 'seized'), 1,
  'the seizure is in the custody log');

-- Penalties stop (A-08): a 5th would be due on 12 Mar for loan A.
select tests.set_day('2026-03-12');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select is((select count(*)::int from public.loan_penalty_events where loan_id = :'loan_a'), 4, 'no penalty once the case is open');

-- Stages move forward only.
select is(tests.try_as('authenticated', :'manager_id', format($$select public.advance_recovery_stage('%s', 'notice_sent', 'Demand notice delivered by hand')$$, :'case_a')),
  null, 'demand notice sent');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.advance_recovery_stage('%s', 'notice_sent', 'Again')$$, :'case_a')),
  '^INVALID_STATE', 'a stage cannot be repeated or go back');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.advance_recovery_stage('%s', 'court_filed', 'Filed at the magistrate court', 'MC-2026-114')$$, :'case_a')),
  null, 'court filed with its reference');
select results_eq(format($$select stage, court_ref from public.recovery_cases where id = '%s'$$, :'case_a'),
  $$values ('court_filed'::text, 'MC-2026-114'::text)$$, 'the case keeps the stage and court reference');

-- Sale preview and T-14: sale 200000 against 248832 owed.
select is(tests.value_as('authenticated', :'manager_id', format($$select public.preview_collateral_sale('%s', 200000)::text$$, :'case_a'))::jsonb,
  '{"owed": {"penalty": 128832, "interest": 20000, "principal": 100000, "total": 248832},
    "allocation": {"penalty": 128832, "interest": 20000, "principal": 51168}, "surplus_cents": 0, "shortfall_cents": 48832}'::jsonb,
  'the preview allocates penalty, interest, then principal and shows the shortfall');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.record_collateral_sale('%s', '%s', 200000, 'Moses Doe', 'cash')$$, :'case_a', :'item_a')),
  null, 'the manager records the sale');
select results_eq(format($$select penalty_cents, interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_a'),
  $$values (0::bigint, 0::bigint, 48832::bigint)$$, 'T-14: 128832 / 20000 / 51168 applied; 48832 principal left');
select results_eq(format($$select l.status, rc.stage, c.status from public.loans l join public.recovery_cases rc on rc.loan_id = l.id
                           join public.collaterals c on c.id = '%s' where l.id = '%s'$$, :'item_a', :'loan_a'),
  $$values ('recovery'::text, 'disposal'::text, 'sold'::text)$$, 'T-14: the loan stays open, the case moves to disposal, the item is sold');

-- T-15: sale 300000 against the same 248832 on loan B.
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.record_collateral_sale('%s', '%s', 300000, 'Buyer', 'cash')$$, :'case_b', :'item_a')),
  '^INVALID_STATE', 'an item of another case cannot be sold here');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.record_collateral_sale('%s', '%s', 300000, 'Comfort Kollie', 'bank', null, 'MC-2026-120')$$, :'case_b', :'item_b')),
  null, 'the sale of loan B''s item for 300000');
select results_eq(format($$select l.status, rc.stage, rc.closed_on is not null from public.loans l join public.recovery_cases rc on rc.loan_id = l.id where l.id = '%s'$$, :'loan_b'),
  $$values ('closed'::text, 'closed'::text, true)$$, 'T-15: the loan closes and so does the case');
select is(tests.value_as('authenticated', :'manager_id', format($$select public.loan_surplus_cents('%s')::text$$, :'loan_b')), '51168',
  'T-15: 51168 surplus held for the borrower on 2100');

-- R7b: the surplus is paid out once, not more than is held.
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.pay_surplus('%s', 51169, 'cash')$$, :'loan_b')),
  '^INVALID_STATE', 'not more than the surplus');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.pay_surplus('%s', 51168, 'cash')$$, :'loan_b')), null,
  'the surplus is paid to the borrower');
select is(tests.value_as('authenticated', :'manager_id', format($$select public.loan_surplus_cents('%s')::text$$, :'loan_b')), '0',
  'nothing is held any more');

select * from finish();
rollback;
