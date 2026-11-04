-- Settings: admin only, validated, audited with before/after (M0 acceptance "audit rows on settings
-- change"; FR-02, FR-26). Business clock (B-01).
begin;
\ir _helpers.psql
select plan(26);

select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Former Admin', 'admin', null, false) as inactive_admin_id \gset

-- Permissions.
select matches(tests.try_as('authenticated', :'cashier_id',
  $$select public.update_setting('approvals.expense_limit_cents', '5000')$$), '^FORBIDDEN', 'cashier gets FORBIDDEN');
select matches(tests.try_as('authenticated', :'manager_id',
  $$select public.update_setting('approvals.expense_limit_cents', '5000')$$), '^FORBIDDEN', 'manager gets FORBIDDEN');
select matches(tests.try_as('authenticated', :'inactive_admin_id',
  $$select public.update_setting('approvals.expense_limit_cents', '5000')$$), '^FORBIDDEN', 'a deactivated admin gets FORBIDDEN');
select matches(tests.try_as('service_role', null,
  $$select public.update_setting('approvals.expense_limit_cents', '5000')$$), '^permission denied', 'the service role cannot call it');

-- A change by the admin writes exactly one audit row with before and after. Start from the seeded
-- value so the test does not depend on changes left by other test runs.
update public.settings set value = '10000' where key = 'approvals.expense_limit_cents';
select count(*) as audit_before from public.audit_log \gset
select is(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('approvals.expense_limit_cents', '12500')$$), null, 'admin can change a setting');
select is((select value from public.settings where key = 'approvals.expense_limit_cents'), '12500'::jsonb,
  'the new value is stored');
select is((select count(*) from public.audit_log) - :audit_before, 1::bigint, 'exactly one audit row is written');
select results_eq(
  $$select action, entity_type, entity_id, before, after from public.audit_log order by chain_no desc limit 1$$,
  $$values ('setting.updated'::text, 'setting'::text, 'approvals.expense_limit_cents'::text, '10000'::jsonb, '12500'::jsonb)$$,
  'the audit row records the key with the value before and after');
select is((select actor_id from public.audit_log order by chain_no desc limit 1), :'admin_id'::uuid,
  'the audit row names the admin as actor');
select is((select actor_role::text from public.audit_log order by chain_no desc limit 1), 'admin',
  'the audit row records the actor role');
select is((select updated_by from public.settings where key = 'approvals.expense_limit_cents'), :'admin_id'::uuid,
  'the setting records who changed it');

-- Saving the same value again writes nothing.
select count(*) as audit_mid from public.audit_log \gset
select tests.try_as('authenticated', :'admin_id', $$select public.update_setting('approvals.expense_limit_cents', '12500')$$);
select is((select count(*) from public.audit_log) - :audit_mid, 0::bigint, 'an unchanged value writes no audit row');

-- Validation.
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('approvals.loan_manager_limit_cents', '2000.50')$$), '^INVALID_SETTING',
  'money settings must be whole cents (no floats)');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('currency.base', '"LRD"')$$), '^INVALID_SETTING', 'only USD in this release (A-01)');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('payments.allocation_order', '["interest", "interest", "principal"]')$$),
  '^INVALID_SETTING', 'allocation order must list each component once');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('company', '{"name": "", "short_name": "MSI", "address": "", "phone": "", "email": "", "logo_path": null, "receipt_footer": ""}')$$),
  '^INVALID_SETTING', 'the company name cannot be empty');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('loan.limit', '5')$$), '^INVALID_SETTING', 'unknown setting keys are rejected');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('migration.go_live_date', '"2026-02-30"')$$), '^INVALID_SETTING',
  'go-live date must be a real date');

-- Business clock (B-01): allowed in this test environment, frozen by default.
select tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('clock.override_at', '{"at": "2026-02-12T09:10:00Z"}')$$);
select is(public.app_now(), '2026-02-12 09:10:00+00'::timestamptz, 'app_now() returns the frozen demo time');
select is(public.business_today(), '2026-02-12'::date, 'business_today() follows the clock in Africa/Monrovia');
select is((select (value ->> 'frozen')::boolean from public.settings where key = 'clock.override_at'), true,
  'a clock without "frozen" is stored as frozen');

-- SQL NULL (how PostgREST passes JSON null) clears nullable settings.
select is(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('clock.override_at', null)$$), null, 'SQL NULL resets the clock to real time');
select is((select value from public.settings where key = 'clock.override_at'), 'null'::jsonb, 'stored as JSON null');
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('company', null)$$), '^INVALID_SETTING', 'null is still refused where a value is required');

-- In production the override is refused and any stored value is ignored.
update public.app_environment set kind = 'production' where id;
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.update_setting('clock.override_at', '{"at": "2026-03-01T00:00:00Z"}')$$), '^FORBIDDEN',
  'production refuses to move the clock');
select isnt(public.app_now(), '2026-02-12 09:10:00+00'::timestamptz, 'production ignores a stored clock override');

select * from finish();
rollback;
