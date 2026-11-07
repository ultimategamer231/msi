-- M5.2: the daily job is scheduled in Postgres (SPEC 5.5, D-11).
begin;
\ir _helpers.psql
select plan(4);

select results_eq($$select schedule, command from cron.job where jobname = 'daily-accruals'$$,
  $$values ('0 1 * * *'::text, 'select public.scheduled_daily_accruals()'::text)$$,
  'pg_cron runs the job daily at 01:00 UTC (Monrovia time)');

update public.settings set value = '{"at": "2026-02-12T01:00:00Z", "frozen": true}' where key = 'clock.override_at';
select is((public.scheduled_daily_accruals()) ->> 'run_date', '2026-02-12', 'the scheduled run uses the business date');
select results_eq($$select source, triggered_by is null from public.accrual_runs order by started_at desc limit 1$$,
  $$values ('cron'::text, true)$$, 'and is logged as a scheduled run with no user');
select matches(tests.try_as('authenticated', tests.create_staff('Manager Cron', 'manager'), 'select public.scheduled_daily_accruals()'),
  '^permission denied', 'staff call run_daily_accruals instead; the scheduled entry point is not exposed');

select * from finish();
rollback;
