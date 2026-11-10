-- M5.1: daily accruals (SPEC 5.2, 5.5; FR-12; T-03, T-04, T-05, T-06 penalty part, T-07, T-08,
-- T-33 run A). The job runs every day here; 22_accruals_late covers late runs (T-33 run B, T-33b).
begin;
\ir _helpers.psql
select plan(27);

insert into public.branches (code, name) values ('TA', 'Test Accruals');
select tests.create_staff('Officer TA', 'loan_officer', 'TA') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TA', 'cashier', 'TA') as cashier_id \gset
select tests.create_staff('Admin TA', 'admin') as admin_id \gset
select set_config('tests.manager', :'manager_id', false);
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T01:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.run(p_user uuid) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_user, 'select public.run_daily_accruals()::text')::jsonb $$;
create function tests.owed(p_loan uuid) returns bigint language sql as $$
  select penalty_cents + interest_cents + principal_cents from public.loan_owed(p_loan) $$;
create function tests.penalties(p_loan uuid) returns bigint[] language sql as $$
  select coalesce(array_agg(penalty_cents order by period_no), '{}') from public.loan_penalty_events where loan_id = p_loan $$;
-- A loan of 100000 (interest 20000) paid out on 05 Jan 2026, due 05 Feb 2026 (T-02).
create function tests.loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid;
begin
  perform tests.set_day('2026-01-05');
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Accrual', 'last_name', p_id_number,
    'phone', '0985 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', 100000, 'term_months', 1));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;

select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TA-100001', :'product_id') as loan_t03 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TA-100002', :'product_id') as loan_t08 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TA-100003', :'product_id') as loan_t33 \gset
update public.loans set penalty_base = 'original_due' where id = :'loan_t08';   -- T-08 uses the other base
select is((select due_date from public.loans where id = :'loan_t03'), '2026-02-05'::date, 'due 05 Feb 2026');

-- Who may run the job, and for which day.
select tests.set_day('2026-02-05');
select matches(tests.try_as('authenticated', :'cashier_id', 'select public.run_daily_accruals()'), '^FORBIDDEN',
  'a cashier cannot run the job');
select matches(tests.try_as('authenticated', :'manager_id', $$select public.run_daily_accruals('2026-02-06')$$),
  '^DATE_NOT_ALLOWED', 'not for a day that has not come yet');
select tests.run(:'manager_id');
select is((select count(*)::int from public.loans where id in (:'loan_t03', :'loan_t08', :'loan_t33') and status = 'overdue'), 0,
  'on the due date nothing is overdue');

-- T-04: day 6 nothing, day 7 the first penalty.
select tests.set_day('2026-02-06');
select tests.run(:'admin_id');
select is((select count(*)::int from public.loans where id in (:'loan_t03', :'loan_t08', :'loan_t33') and status = 'overdue'), 3,
  'the day after the due date the loans are overdue (the admin may run the job too)');
select is((select status from public.loans where id = :'loan_t03'), 'overdue', 'status overdue (SPEC 5.3)');
select tests.set_day('2026-02-11');
select tests.run(:'manager_id');
select is(tests.penalties(:'loan_t03'), '{}'::bigint[], 'T-04: no penalty on day 6');
select tests.set_day('2026-02-12');
select tests.run(:'manager_id');
select is((select count(*)::int from public.loan_penalty_events where loan_id in (:'loan_t03', :'loan_t08', :'loan_t33')), 3,
  'T-04: day 7 charges each loan once');
select is(tests.penalties(:'loan_t03'), '{24000}'::bigint[], 'T-03: first penalty 24000');
select results_eq(format($$select charged_on, base_cents from public.loan_penalty_events where loan_id = '%s'$$, :'loan_t03'),
  $$values ('2026-02-12'::date, 120000::bigint)$$, 'charged on the 7th day on a base of 120000');
select results_eq(
  format($$select a.code, l.debit_cents, l.credit_cents, l.component from public.journal_lines l join public.accounts a on a.id = l.account_id
            where l.journal_id = (select journal_id from public.loan_penalty_events where loan_id = '%s') order by l.line_no$$, :'loan_t03'),
  $$values ('1120'::text, 24000::bigint, 0::bigint, 'penalty'::text), ('4010', 0, 24000, null)$$, 'R4: Dr 1120, Cr 4010');

-- T-07: the same day again posts nothing.
select is((tests.run(:'manager_id')) ->> 'penalties_posted', '0', 'T-07: a rerun posts nothing');
select is((select count(*)::int from public.loan_penalty_events where loan_id = :'loan_t03'), 1, 'T-07: still one event');
select is((select count(*)::int from public.accrual_runs where run_date = '2026-02-12' and triggered_by = :'manager_id'), 2, 'both runs are logged');
select is(tests.value_as('authenticated', :'manager_id', format($$select next_penalty_on::text from public.loan_balances where loan_id = '%s'$$, :'loan_t03')), '2026-02-19',
  'the next penalty date is shown');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.loan_next_penalty('%s')::text$$, :'loan_t03'))::jsonb,
  '{"on": "2026-02-19", "period_no": 2, "cents": 28800}'::jsonb, 'and the next penalty: 20% of the 144000 owed now');

-- T-06 / T-33 run A: 50000 paid on 14 Feb goes to penalty, interest, then 6000 principal; next penalty 18800.
select tests.set_day('2026-02-13');
select tests.run(:'manager_id');
select tests.set_day('2026-02-14');
select tests.run(:'manager_id');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 50000, 'cash', null, null, 'accrual-key-0001')$$, :'loan_t33'));
select results_eq(format($$select penalty_cents, interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_t33'),
  $$values (0::bigint, 0::bigint, 94000::bigint)$$, 'T-06: 94000 principal left after the payment');
do $$ declare d date; begin
  for d in select generate_series('2026-02-15'::date, '2026-02-19'::date, '1 day')::date loop
    perform tests.set_day(d);
    perform tests.run(current_setting('tests.manager')::uuid);
  end loop;
end $$;
select is(tests.penalties(:'loan_t33'), '{24000,18800}'::bigint[], 'T-33 run A: 24000 then 18800 (pct of 94000)');
select is(tests.owed(:'loan_t33'), 112800::bigint, 'T-33 run A: owes 112800');
select results_eq(format($$select penalty_cents, principal_cents from public.loan_owed('%s')$$, :'loan_t33'),
  $$values (18800::bigint, 94000::bigint)$$, 'T-33 run A: principal 94000, penalty 18800');

-- T-03 continues weekly; T-05 stops at 4; A-08 recovery eligibility after 30 days.
do $$ declare d date; begin
  for d in select generate_series('2026-02-20'::date, '2026-03-12'::date, '1 day')::date loop
    perform tests.set_day(d);
    perform tests.run(current_setting('tests.manager')::uuid);
  end loop;
end $$;
select is(tests.penalties(:'loan_t03'), '{24000,28800,34560,41472}'::bigint[], 'T-03: 24000, 28800, 34560, 41472');
select is(tests.owed(:'loan_t03'), 248832::bigint, 'T-03: owes 248832');
select is((select count(*)::int from public.loan_penalty_events where loan_id = :'loan_t03'), 4, 'T-05: no 5th penalty on day 35');
select is(tests.penalties(:'loan_t08'), '{24000,24000,24000,24000}'::bigint[], 'T-08: 24000 four times on the original due');
select is(tests.owed(:'loan_t08'), 216000::bigint, 'T-08: owes 216000');
select is((select recovery_eligible from public.loans where id = :'loan_t03'), true, 'A-08: eligible for recovery after 30 days');
select is(tests.value_as('authenticated', :'manager_id', format($$select next_penalty_on::text from public.loan_balances where loan_id = '%s'$$, :'loan_t03')), null,
  'no next penalty after the 4th');

select * from finish();
rollback;
