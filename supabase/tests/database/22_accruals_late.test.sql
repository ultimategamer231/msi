-- M5.1: late accrual runs (SPEC 5.2 determinism rule; B-15; T-33 run B, T-33b). The job does not run
-- for days; when it does, the penalties equal those of a daily run (21_accruals, T-33 run A).
begin;
\ir _helpers.psql
select plan(9);

insert into public.branches (code, name) values ('TL', 'Test Late');
select tests.create_staff('Officer TL', 'loan_officer', 'TL') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TL', 'cashier', 'TL') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid, p_day date)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid;
begin
  perform tests.set_day(p_day);
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Late', 'last_name', p_id_number,
    'phone', '0984 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
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

select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TL-100001', :'product_id', '2026-01-05') as loan_b \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TL-100002', :'product_id', '2026-01-19') as loan_c \gset

-- Loan B: due 05 Feb, 50000 paid on 14 Feb before any job has run (interest 20000, principal 30000).
select tests.set_day('2026-02-14');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 50000, 'cash', null, null, 'late-key-00001')$$, :'loan_b'));
select is(public.loan_outstanding_as_of(:'loan_b', '2026-02-12'), 120000::bigint, 'as of 12 Feb the payment of 14 Feb is not counted');
select is(public.loan_outstanding_as_of(:'loan_b', '2026-02-14'), 70000::bigint, 'as of 14 Feb it is');

-- T-33 run B: the job first runs on 19 Feb.
select tests.set_day('2026-02-19');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select results_eq(format($$select period_no, charged_on, base_cents, penalty_cents from public.loan_penalty_events
                           where loan_id = '%s' order by period_no$$, :'loan_b'),
  $$values (1, '2026-02-12'::date, 120000::bigint, 24000::bigint), (2, '2026-02-19', 94000, 18800)$$,
  'T-33 run B: same amounts and charge dates as the daily run (24000 on 12 Feb, 18800 on 19 Feb)');
select results_eq(format($$select penalty_cents, interest_cents, principal_cents from public.loan_owed('%s')$$, :'loan_b'),
  $$values (42800::bigint, 0::bigint, 70000::bigint)$$, 'T-33 run B: principal 70000, penalty 42800, total 112800');
select is((select entry_date from public.journals where id = (select journal_id from public.loan_penalty_events
            where loan_id = :'loan_b' and period_no = 1)), '2026-02-19'::date, 'the late penalty journal is dated the run day');

-- T-33b (B-15): loan C is due 19 Feb, 50000 is paid on 28 Feb (after the first charge date), and the
-- job next runs on 12 Mar, three periods late. Daily oracle (tools/vectors.py T-33b): 24000; then
-- 94000 -> 18800; then 112800 -> 22560; owes 135360.
select tests.set_day('2026-02-28');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 50000, 'cash', null, null, 'late-key-00002')$$, :'loan_c'));
select tests.set_day('2026-03-12');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select results_eq(format($$select period_no, charged_on, base_cents, penalty_cents from public.loan_penalty_events
                           where loan_id = '%s' order by period_no$$, :'loan_c'),
  $$values (1, '2026-02-26'::date, 120000::bigint, 24000::bigint), (2, '2026-03-05', 94000, 18800),
           (3, '2026-03-12', 112800, 22560)$$,
  'T-33b: three periods in one run give the daily amounts (earlier penalties count from their charge dates)');
select is((select penalty_cents + interest_cents + principal_cents from public.loan_owed(:'loan_c')), 135360::bigint,
  'T-33b: owes 135360, as with daily runs');
select is(public.loan_outstanding_as_of(:'loan_b', '2026-03-05'), 162432::bigint,
  'loan B, also caught up late: 112800 + 22560 (26 Feb) + 27072 (05 Mar)');
select is((select count(*)::int from public.journals j join public.loan_penalty_events e on e.journal_id = j.id
            where e.loan_id = :'loan_c' and j.entry_date = '2026-03-12'), 3, 'all three journals are dated the run day');

select * from finish();
rollback;
