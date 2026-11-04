-- Auth helpers, branches and staff profiles (SPEC 4, 6.4, 7.1; FR-01, FR-02; B-11).
begin;
\ir _helpers.psql
select plan(24);

select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Gone Officer', 'loan_officer', 'BR1', false) as inactive_id \gset
select id as br2 from public.branches where code = 'BR2' \gset

-- Helpers read the role and branch from the signed-in user's JWT.
select is(tests.value_as('authenticated', :'cashier_id', 'select public.auth_role()::text'), 'cashier',
  'auth_role() returns the caller''s role');
select is(tests.value_as('authenticated', :'cashier_id', 'select public.auth_branch()::text'), :'br2',
  'auth_branch() returns the caller''s branch');
select is(tests.value_as('authenticated', :'cashier_id', 'select public.is_staff()::text'), 'true',
  'is_staff() is true for active staff');
select is(tests.value_as('authenticated', :'inactive_id', 'select public.auth_role()::text'), null,
  'a deactivated user has no role');
select is(tests.value_as('authenticated', :'inactive_id', 'select public.is_staff()::text'), 'false',
  'a deactivated user is not staff');
select is(tests.value_as('authenticated', :'inactive_id', 'select count(*) from public.branches')::int, 0,
  'a deactivated user reads nothing');
select is(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.branches')::int, 3,
  'staff read all branches (SPEC 4: reads are not branch-scoped)');

-- Profile branch rule (SPEC 4, B-11).
select lives_ok(
  $$insert into auth.users (id, instance_id, email, aud, role) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'm2@test.local', 'authenticated', 'authenticated');
    insert into public.profiles (id, full_name, role) values ('11111111-1111-1111-1111-111111111111', 'Manager Two', 'manager')$$,
  'a manager may have no branch (B-11)');
select throws_ok(
  $$insert into auth.users (id, instance_id, email, aud, role) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'c2@test.local', 'authenticated', 'authenticated');
    insert into public.profiles (id, full_name, role) values ('22222222-2222-2222-2222-222222222222', 'Cashier Two', 'cashier')$$,
  '23514', null, 'a cashier must have a branch');

-- Branches: admin only, code fixed, audited.
select matches(tests.try_as('authenticated', :'manager_id',
  $$select public.upsert_branch('{"code": "BR4", "name": "Branch 4"}')$$), '^FORBIDDEN', 'manager cannot create a branch');
select is(tests.try_as('authenticated', :'admin_id',
  $$select public.upsert_branch('{"code": "br4", "name": "Branch 4", "phone": "0770 000 004"}')$$), null,
  'admin creates a branch');
select is((select name from public.branches where code = 'BR4'), 'Branch 4', 'the code is stored upper case');
select is((select count(*)::int from public.audit_log where action = 'branch.created' and after ->> 'code' = 'BR4'), 1,
  'branch creation is audited');
select id as br4 from public.branches where code = 'BR4' \gset
select matches(tests.try_as('authenticated', :'admin_id',
  format($$select public.upsert_branch('{"id": "%s", "code": "BR5"}')$$, :'br4')), '^INVALID_STATE',
  'a branch code cannot change');
select is(tests.try_as('authenticated', :'admin_id',
  format($$select public.upsert_branch('{"id": "%s", "name": "Gbarnga"}')$$, :'br4')), null, 'admin renames a branch');
select results_eq(
  $$select before ->> 'name', after ->> 'name' from public.audit_log where action = 'branch.updated' order by chain_no desc limit 1$$,
  $$values ('Branch 4'::text, 'Gbarnga'::text)$$, 'the rename is audited with before and after');

-- Profiles: admin only, audited, no self-lockout.
select tests.create_login('new.officer@test.local') as new_login \gset
select matches(tests.try_as('authenticated', :'manager_id',
  format($$select public.admin_set_profile('%s', 'New Officer', null, 'loan_officer', '%s', true)$$, :'new_login', :'br2')),
  '^FORBIDDEN', 'manager cannot create staff profiles');
select is(tests.try_as('authenticated', :'admin_id',
  format($$select public.admin_set_profile('%s', 'New Officer', '0770 555 099', 'loan_officer', '%s', true)$$, :'new_login', :'br2')),
  null, 'admin creates a staff profile');
select is((select count(*)::int from public.audit_log where action = 'profile.created' and entity_id = :'new_login'), 1,
  'profile creation is audited');
select matches(tests.try_as('authenticated', :'admin_id',
  format($$select public.admin_set_profile('%s', 'New Officer', null, 'loan_officer', null, true)$$, :'new_login')),
  '^INVALID_STATE', 'a loan officer needs a branch');
select is(tests.try_as('authenticated', :'admin_id',
  format($$select public.admin_set_profile('%s', 'New Officer', '0770 555 099', 'loan_officer', '%s', false)$$, :'new_login', :'br2')),
  null, 'admin deactivates a user');
select results_eq(
  format($$select (before ->> 'active')::boolean, (after ->> 'active')::boolean from public.audit_log
           where action = 'profile.updated' and entity_id = '%s' order by chain_no desc limit 1$$, :'new_login'),
  $$values (true, false)$$, 'deactivation is audited with before and after');
select matches(tests.try_as('authenticated', :'admin_id',
  format($$select public.admin_set_profile('%s', 'Admin One', null, 'manager', null, true)$$, :'admin_id')),
  '^INVALID_STATE', 'an admin cannot remove their own admin role');
select matches(tests.try_as('authenticated', :'admin_id',
  format($$select public.admin_set_profile('%s', 'Admin One', null, 'admin', null, false)$$, :'admin_id')),
  '^INVALID_STATE', 'an admin cannot deactivate themselves');

select * from finish();
rollback;
