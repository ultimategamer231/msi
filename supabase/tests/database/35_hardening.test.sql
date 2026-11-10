-- M9.3: hardening (SPEC 11; T-30, T-31 are in 13 and 05/07).
begin;
\ir _helpers.psql
select plan(6);

-- Account lockout: 5 failures lock for 15 minutes; a success clears; only the service role calls it.
select is(public.login_guard('Locked@Example.test', 'check'), 'ok', 'a fresh account is not locked');
do $$ begin for i in 1..4 loop perform public.login_guard('locked@example.test', 'failed'); end loop; end $$;
select is(public.login_guard(' LOCKED@example.test ', 'failed'), 'locked', 'the 5th failure locks it (case and spaces ignored)');
select is((select count(*)::int from public.login_failures where email_hash !~ '^[0-9a-f]{64}$'), 0, 'only hashes are stored, never the email');
select is(public.login_guard('locked@example.test', 'succeeded'), 'ok', 'a successful sign-in clears the count');
select matches(tests.try_as('anon', null, $$select public.login_guard('x@example.test', 'failed')$$), '^permission denied',
  'anonymous callers cannot touch the lockout');
select is(tests.value_as('anon', null, $$select public.health_check() ->> 'database'$$), 'ok', 'the health check answers anonymously');

select * from finish();
rollback;
