-- M5.2: the daily job runs inside Postgres (SPEC 5.5, D-11): pg_cron at 01:00 UTC (= Monrovia),
-- for the business date, with no signed-in user (triggered_by null, source 'cron').
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.scheduled_daily_accruals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return accruals_run(business_today(), null, 'cron');
end
$$;

revoke execute on function public.scheduled_daily_accruals() from public, anon, authenticated, service_role;

-- cron.schedule with the same name replaces the job, so this is safe to run again.
select cron.schedule('daily-accruals', '0 1 * * *', 'select public.scheduled_daily_accruals()');
