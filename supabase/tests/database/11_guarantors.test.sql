-- M2.5: guarantor model and validation (SPEC 7.2; FR-05).
begin;
\ir _helpers.psql
select plan(9);

select tests.create_staff('Cashier Two', 'cashier', 'BR2') as cashier_id \gset

select has_table('public', 'guarantors', 'the guarantors table exists');
select is((select relrowsecurity from pg_class where oid = 'public.guarantors'::regclass), true, 'RLS is on');
select matches(tests.try_as('authenticated', :'cashier_id',
  $$insert into public.guarantors (loan_id, full_name, phone, created_by) values (gen_random_uuid(), 'X', '0770 555 014', auth.uid())$$),
  '^permission denied', 'guarantors are written only by the loan RPCs');
select is(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.guarantors where false')::int, 0,
  'staff can read guarantors');

select is(public.clean_guarantors(null), '[]'::jsonb, 'guarantors are optional (A-10)');
select is(public.clean_guarantors($$[{"full_name": " Joseph Kollie ", "phone": "0770 555 014", "relationship": "Brother",
  "id_type": "national_id", "id_number": "LR-0099887", "address": ""}]$$),
  $$[{"full_name": "Joseph Kollie", "phone": "0770 555 014", "relationship": "Brother", "id_type": "national_id",
     "id_number": "LR-0099887", "address": null}]$$::jsonb,
  'a guarantor is trimmed and blanks become null');
select throws_ok($$select public.clean_guarantors('[{"full_name": "Joseph", "phone": "12"}]')$$,
  '22023', null, 'a guarantor needs a valid phone');
select throws_ok($$select public.clean_guarantors('[{"full_name": "Joseph", "phone": "0770 555 014", "id_number": "X1"}]')$$,
  '22023', null, 'ID type and number go together');
select throws_ok($$select public.clean_guarantors('[{"full_name": "A", "phone": "0770555014"}, {"full_name": "B", "phone": "0770555015"},
  {"full_name": "C", "phone": "0770555016"}, {"full_name": "D", "phone": "0770555017"}]')$$,
  '22023', null, 'at most 3 guarantors');

select * from finish();
rollback;
