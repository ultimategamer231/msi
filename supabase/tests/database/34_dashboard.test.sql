-- M9.2: role-aware dashboard (SPEC 9; FR-29).
begin;
\ir _helpers.psql
select plan(6);

select tests.create_staff('Officer DB', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Cashier DB', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Manager DB', 'manager') as manager_id \gset
select tests.create_staff('Accountant DB', 'accountant') as accountant_id \gset
select tests.create_staff('Admin DB', 'admin') as admin_id \gset
create function tests.dash(p_user uuid) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_user, 'select public.dashboard_data()::text')::jsonb $$;

select ok(tests.dash(:'officer_id') ?& array['due_today', 'overdue', 'pending_remittance', 'due_now'],
  'an officer sees their due, overdue and field cash');
select is((tests.dash(:'cashier_id') -> 'drawer' ->> 'expected_cents')::bigint,
          (tests.value_as('authenticated', :'cashier_id', format($$select public.day_close_summary((select id from public.branches where code = 'BR2'), public.business_today())::text$$))::jsonb ->> 'expected_cents')::bigint,
  'the cashier''s cash to close is the day-close expected cash');
select is((tests.dash(:'manager_id') -> 'portfolio' ->> 'cents')::bigint,
          tests.value_as('authenticated', :'manager_id', $$select coalesce(sum(b.total_out), 0)::text from public.loan_balance_rows() b
            join public.loans l on l.id = b.loan_id where l.status in ('active', 'overdue', 'recovery') and b.total_out > 0$$)::bigint,
  'the manager''s outstanding is the ledger total of open loans');
select ok(tests.dash(:'accountant_id') ?& array['cash', 'income_month', 'expenses_waiting'],
  'the accountant sees cash by branch, income this month and expenses waiting');
select ok(tests.dash(:'admin_id') ?& array['go_live', 'last_run', 'users'], 'the admin sees the system state');
select matches(tests.try_as('anon', null, 'select public.dashboard_data()'), '^permission denied', 'not public');

select * from finish();
rollback;
