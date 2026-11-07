-- M5.3: due list (SPEC 7.7, 9 /due, 10.3; FR-13; B-07, B-18).
begin;
\ir _helpers.psql
select plan(9);

insert into public.branches (code, name) values ('TD', 'Test Due');
select tests.create_staff('Officer TD', 'loan_officer', 'TD') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TD', 'cashier', 'TD') as cashier_id \gset
select tests.create_staff('Admin TD', 'admin') as admin_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = '7' where key = 'due.upcoming_days';
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
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Due', 'last_name', p_id_number,
    'phone', '0983 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', 50000, 'term_months', 1));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;

-- As of 12 Feb 2026: due 05 Jan (38 days), 13 Jan (30), 22 Jan (21), 05 Feb (7), 12 Feb (today),
-- 15 Feb (in 3 days), 20 Feb (in 8 days, outside the 7-day window).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100001', :'product_id', '2025-12-05') as l38 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100002', :'product_id', '2025-12-13') as l30 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100003', :'product_id', '2025-12-22') as l21 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100004', :'product_id', '2026-01-05') as l7 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100005', :'product_id', '2026-01-12') as l0 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100006', :'product_id', '2026-01-15') as lm3 \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TD-100007', :'product_id', '2026-01-20') as lm8 \gset
select tests.set_day('2026-02-12');
create temp table ours as
  select unnest(array[:'l38', :'l30', :'l21', :'l7', :'l0', :'lm3', :'lm8']::uuid[]) as id;
grant select on ours to authenticated;

select is(tests.value_as('authenticated', :'officer_id',
  $$select string_agg(bucket || ':' || days, ', ' order by due_date) from public.due_list where loan_id in (select id from ours)$$),
  'overdue_30_plus:38, overdue_8_30:30, overdue_8_30:21, overdue_1_7:7, due_today:0, due_7d:-3',
  'B-18: 31+ days, 30 and 21 days in 8-30, 7 in 1-7; due today; due in 3 days; 8 days ahead is not listed (B-07)');
select is(tests.value_as('authenticated', :'officer_id',
  'select count(*)::text from public.due_list where loan_id in (select id from ours)'), '6', 'every staff role reads the list');
select is((select count(*)::int from public.due_list where loan_id in (select id from ours)), 0,
  'nothing without a staff login');

update public.settings set value = '14' where key = 'due.upcoming_days';
select is(tests.value_as('authenticated', :'officer_id', format($$select bucket from public.due_list where loan_id = '%s'$$, :'lm8')),
  'due_7d', 'with a 14-day window the loan due in 8 days is listed');
select matches(tests.try_as('authenticated', :'admin_id', $$select public.update_setting('due.upcoming_days', '0')$$),
  '^INVALID_SETTING', 'the window must be 1 to 60 days');

-- A paid-off loan leaves the list.
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 60000, 'cash', null, null, 'due-key-00001')$$, :'l0'));
select is(tests.value_as('authenticated', :'officer_id', format($$select count(*)::text from public.due_list where loan_id = '%s'$$, :'l0')),
  '0', 'a loan that owes nothing is not listed');

-- SPEC 10.3: each reminder tap is audited.
select is(tests.try_as('authenticated', :'officer_id', format($$select public.log_reminder_opened('%s', 'reminder_overdue')$$, :'l21')),
  null, 'the officer opens a WhatsApp reminder');
select results_eq(format($$select action, actor_id, after ->> 'template' from public.audit_log where entity_id = '%s' and action = 'loan.reminder_opened'$$, :'l21'),
  format($$values ('loan.reminder_opened'::text, '%s'::uuid, 'reminder_overdue'::text)$$, :'officer_id'), 'logged as loan.reminder_opened');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.log_reminder_opened('%s', 'reminder')$$, :'l0')),
  '^INVALID_STATE', 'not for a closed loan');

select * from finish();
rollback;
