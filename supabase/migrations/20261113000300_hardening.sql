-- M9.3: hardening (SPEC 11).

-- Login lockout: 5 failed sign-ins for one account lock it for 15 minutes (SPEC 11 Security),
-- on top of Supabase's per-IP limits. Emails are kept only as SHA-256 hashes. Only the server
-- (service role, in the sign-in action) can read or write these rows.
create table public.login_failures (
  id bigint generated always as identity primary key,
  email_hash text not null,
  failed_at timestamptz not null default now()
);
create index login_failures_email_idx on public.login_failures (email_hash, failed_at desc);
alter table public.login_failures enable row level security;
revoke all on public.login_failures from anon, authenticated, service_role;

create or replace function public.login_email_hash(p_email text)
returns text
language sql
immutable
set search_path = public
as $$ select encode(extensions.digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex') $$;
revoke execute on function public.login_email_hash(text) from public, anon, authenticated, service_role;

-- 'locked' | 'ok'; p_event 'check' only reads, 'failed' records a failure, 'succeeded' clears.
create or replace function public.login_guard(p_email text, p_event text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := login_email_hash(p_email);
begin
  delete from login_failures where failed_at < now() - interval '1 day';
  if p_event = 'failed' then
    insert into login_failures (email_hash) values (v_hash);
  elsif p_event = 'succeeded' then
    delete from login_failures where email_hash = v_hash;
  end if;
  return case when (select count(*) from login_failures
                     where email_hash = v_hash and failed_at > now() - interval '15 minutes') >= 5
              then 'locked' else 'ok' end;
end
$$;
revoke execute on function public.login_guard(text, text) from public, anon, authenticated;
grant execute on function public.login_guard(text, text) to service_role;

-- /api/health (SPEC 11 Observability): the database answers, and the last daily job's date.
create or replace function public.health_check()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('database', 'ok', 'last_accrual_run',
                            (select max(run_date) from accrual_runs), 'business_date', business_today())
$$;
revoke execute on function public.health_check() from public, service_role;
grant execute on function public.health_check() to anon, authenticated;
