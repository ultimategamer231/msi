-- Audit log: append-only for every role (SPEC 6.3, T-21 pattern), readable only by CEO, manager and
-- admin (SPEC 4), and hash-chained so tampering is detectable (R-02).
begin;
\ir _helpers.psql
select plan(14);

-- Arrange: three audit rows written through the normal path.
select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Ceo One', 'ceo') as ceo_id \gset
select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Officer One', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset

select tests.try_as('authenticated', :'admin_id', $$select public.update_setting('approvals.expense_limit_cents', '15000')$$);
select tests.try_as('authenticated', :'admin_id', $$select public.update_setting('approvals.expense_limit_cents', '20000')$$);

-- Immutability for every role, including the service role and the database owner.
select matches(
  tests.try_as('authenticated', :'admin_id', $$update public.audit_log set action = 'x.y'$$),
  '^permission denied', 'admin cannot update audit rows');
select matches(
  tests.try_as('service_role', null, $$delete from public.audit_log$$),
  '^permission denied', 'service role cannot delete audit rows');
select throws_ok(
  $$update public.audit_log set action = 'tampered.row'$$,
  '42501', null, 'even the database owner gets IMMUTABLE_RECORD on update');
select throws_like(
  $$delete from public.audit_log$$,
  'IMMUTABLE_RECORD: DELETE on audit_log is not allowed', 'even the database owner gets IMMUTABLE_RECORD on delete');
select throws_like(
  $$truncate public.audit_log$$,
  'IMMUTABLE_RECORD: TRUNCATE on audit_log is not allowed', 'truncate is refused');

-- Read access (SPEC 4: audit log for ceo, manager, admin).
select ok(tests.value_as('authenticated', :'manager_id', 'select count(*) from public.audit_log')::int >= 2,
  'manager can read the audit log');
select ok(tests.value_as('authenticated', :'ceo_id', 'select count(*) from public.audit_log')::int >= 2,
  'CEO can read the audit log');
select is(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.audit_log')::int, 0,
  'cashier sees no audit rows');
select is(tests.value_as('authenticated', :'officer_id', 'select count(*) from public.audit_log')::int, 0,
  'loan officer sees no audit rows');
select is(tests.value_as('authenticated', :'accountant_id', 'select count(*) from public.audit_log')::int, 0,
  'accountant sees no audit rows');

-- Hash chain.
select is(public.verify_audit_chain(), null, 'the chain verifies when nobody has tampered with it');

select is(
  (select count(*)::int from public.audit_log a
     join public.audit_log b on b.chain_no = a.chain_no + 1 where b.prev_hash <> a.hash),
  0, 'each row links to the hash of the row before it');

-- Tamper as a superuser who disables the immutability trigger: the chain exposes the edit.
select max(chain_no) as last_no from public.audit_log \gset
alter table public.audit_log disable trigger audit_immutable;
update public.audit_log set after = '{"value": 99999}'::jsonb where chain_no = :last_no - 1;
alter table public.audit_log enable trigger audit_immutable;
select is(public.verify_audit_chain(), (:last_no - 1)::bigint, 'an edited row is reported as the first broken link');

-- Removing the newest row is also detected (head no longer matches).
alter table public.audit_log disable trigger audit_immutable;
delete from public.audit_log where chain_no >= :last_no - 1;
alter table public.audit_log enable trigger audit_immutable;
select is(public.verify_audit_chain(), (:last_no - 1)::bigint, 'a removed row is detected');

select * from finish();
rollback;
