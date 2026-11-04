-- RLS and privileges on every table (SPEC 6.4; CLAUDE.md rule 5).
begin;
\ir _helpers.psql
select plan(11);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every table in public has row level security enabled');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
  0, 'no insert, update or delete policies exist: writes go through RPCs only');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'),
  0, 'the anonymous role has no table privileges');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'authenticated and service_role cannot write any table directly');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  0, 'every security definer function pins its search_path');

select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')$$,
  array['public_branding'],
  'the anonymous role can call only public_branding (sign-in page header)');

select ok(
  not has_function_privilege('authenticated', 'public.write_audit(text,text,text,jsonb,jsonb)', 'EXECUTE'),
  'clients cannot write audit rows directly');

select set_eq(
  $$select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')$$,
  array['app_now', 'business_today', 'environment_kind', 'auth_role', 'auth_branch', 'is_staff',
        'update_setting', 'upsert_branch', 'admin_set_profile', 'public_branding',
        'admin_record_password_reset', 'set_sequence_start', 'trial_balance',
        'request_manual_journal', 'create_customer', 'add_customer_documents',
        'request_customer_edit', 'decide_approval', 'request_capital_in', 'upsert_loan_product', 'loan_balance_rows', 'preview_loan_terms'],
  'clients can call exactly the released RPCs and helpers');

-- A signed-in cashier trying a direct insert is refused (the T-30 pattern, on an M0 table).
select ok(
  tests.try_as('authenticated', tests.create_staff('Cashier One', 'cashier', 'BR2'),
    $$insert into public.settings (key, value) values ('currency.base', '"LRD"')$$) like 'permission denied%',
  'a cashier cannot insert into settings directly');

-- public_branding exposes the company name only.
select is(tests.value_as('anon', null, $$select public.public_branding()::text$$)::jsonb,
  (select jsonb_build_object('name', value ->> 'name', 'short_name', value ->> 'short_name', 'logo_path', value ->> 'logo_path')
     from public.settings where key = 'company'),
  'public_branding returns the name, short name and logo path only');
select matches(tests.try_as('anon', null, $$select count(*) from public.settings$$),
  '^permission denied', 'signed-out visitors cannot read settings directly');

select * from finish();
rollback;
