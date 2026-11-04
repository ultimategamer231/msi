-- M2.1: customer register, duplicate guard (T-32), attachments (SPEC 4, 5.11, 6.4, 7.2; FR-03).
begin;
\ir _helpers.psql
select plan(31);

select id as br1 from public.branches where code = 'BR1' \gset
select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Officer One', 'loan_officer', 'BR1') as officer_br1_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier Two', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Admin One', 'admin') as admin_id \gset

-- Phones from a reserved test range so earlier local runs cannot collide.
select coalesce(max(last_value), 0) as customer_counter from public.document_sequences where kind = 'customer' \gset

-- Who may create (SPEC 4).
select matches(tests.try_as('authenticated', :'cashier_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Ama", "last_name": "Test", "phone": "0999 100 001",
  "id_type": "national_id", "id_number": "T-100001"}')$$), '^FORBIDDEN', 'a cashier cannot create customers');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Ama", "last_name": "Test", "phone": "0999 100 001",
  "id_type": "national_id", "id_number": "T-100001"}')$$), '^FORBIDDEN', 'an accountant cannot create customers');

-- A loan officer creates in their branch and is the assigned officer.
select is(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "  Ama ", "last_name": "Test", "phone": "0999 100 001",
  "id_type": "national_id", "id_number": "T-100001", "address": "", "occupation": "Market trader"}')$$),
  null, 'a loan officer creates a customer');
select results_eq(
  $$select code, branch_id, assigned_officer_id, status, first_name, address from public.customers where id_number = 'T-100001'$$,
  format($$values ('CU-%s'::text, '%s'::uuid, '%s'::uuid, 'active'::text, 'Ama'::text, null::text)$$,
         lpad((:customer_counter + 1)::text, 6, '0'), :'br2', :'officer_id'),
  'the code is the next CU number; branch and officer come from the creator; text is trimmed, blanks are null');
select is((select count(*)::int from public.audit_log where action = 'customer.created' and actor_id = :'officer_id'
            and after ->> 'code' = (select code from public.customers where id_number = 'T-100001')), 1,
  'creation is audited with the new record');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Kofi", "last_name": "Test", "phone": "0999 100 002",
  "id_type": "passport", "id_number": "T-100002", "branch_id": "%s"}')$$, :'br1')),
  '^FORBIDDEN', 'a loan officer cannot create in another branch');

-- Validation.
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Kofi", "phone": "0999 100 002", "id_type": "passport", "id_number": "T-100002"}')$$),
  '^INVALID_STATE', 'an individual needs a last name');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Kofi", "last_name": "Test", "phone": "0999 100 002"}')$$),
  '^INVALID_STATE', 'an individual needs an ID');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Kofi", "last_name": "Test", "phone": "12", "id_type": "passport", "id_number": "T-100002"}')$$),
  '^INVALID_STATE', 'a phone number needs at least 7 digits');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Kofi", "last_name": "Test", "phone": "0999 100 002",
  "id_type": "passport", "id_number": "T-100002", "date_of_birth": "2999-01-01"}')$$),
  '^INVALID_STATE', 'a date of birth cannot be in the future');
select matches(tests.try_as('authenticated', :'manager_id', $$select public.create_customer('{
  "type": "business", "business_name": "Test Trading", "phone": "0999 100 003"}')$$),
  '^INVALID_STATE', 'a manager without a branch must choose one');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.create_customer('{
  "type": "business", "business_name": "Test Trading", "phone": "0999 100 003", "branch_id": "%s"}')$$, :'br1')),
  '^INVALID_STATE', 'a business needs a contact person');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.create_customer('{
  "type": "business", "business_name": "Test Trading", "contact_person": "Joe", "phone": "0999 100 003",
  "branch_id": "%s", "assigned_officer_id": "%s"}')$$, :'br1', :'officer_id')),
  '^INVALID_STATE', 'the assigned officer must work at the customer''s branch');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.create_customer('{
  "type": "business", "business_name": "Test Trading", "registration_no": "BR-77", "contact_person": "Joe",
  "phone": "0999 100 003", "branch_id": "%s", "assigned_officer_id": "%s"}')$$, :'br1', :'officer_br1_id')),
  null, 'a manager creates a business customer for a branch and officer');

-- Duplicate guard (T-32): same phone, in another format, or the second phone; same ID number.
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "+231 999 100 001",
  "id_type": "passport", "id_number": "T-100009"}')$$),
  '^DUPLICATE_CUSTOMER', 'T-32: the same phone in international format is a duplicate');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 008",
  "phone_alt": "0999100001", "id_type": "passport", "id_number": "T-100009"}')$$),
  '^DUPLICATE_CUSTOMER', 'a second phone matching an existing customer is a duplicate');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 008",
  "id_type": "voter_card", "id_number": "t 100001"}')$$),
  '^DUPLICATE_CUSTOMER', 'the same ID number, written differently, is a duplicate');

-- The error carries the matching record in DETAIL for the warning on screen.
create function tests.duplicate_detail(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare v_detail text;
begin
  perform tests.become('authenticated', p_user);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform tests.unbecome();
  return v_detail::jsonb;
end $$;
select is(
  (tests.duplicate_detail(:'officer_id', $$select public.create_customer('{
    "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 001",
    "id_type": "passport", "id_number": "T-100009"}')$$) -> 0) - 'id',
  jsonb_build_object('code', (select code from public.customers where id_number = 'T-100001'),
                     'name', 'Ama Test', 'status', 'active', 'match', 'phone'),
  'the duplicate warning lists the existing customer');

select matches(tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 001",
  "id_type": "passport", "id_number": "T-100009", "duplicate_override": true, "duplicate_reason": "Shared phone"}')$$),
  '^FORBIDDEN', 'T-32: a loan officer cannot override');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 001", "branch_id": "%s",
  "id_type": "passport", "id_number": "T-100009", "duplicate_override": true}')$$, :'br2')),
  '^INVALID_STATE', 'an override needs a reason');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Other", "last_name": "Person", "phone": "0999 100 001", "branch_id": "%s",
  "id_type": "passport", "id_number": "T-100009", "duplicate_override": true, "duplicate_reason": "Husband and wife share a phone"}')$$, :'br2')),
  null, 'T-32: a manager overrides with a reason');
select is((select after #>> '{duplicate_override,reason}' from public.audit_log
            where action = 'customer.created' and actor_id = :'manager_id' and after ->> 'id_number' = 'T-100009'),
  'Husband and wife share a phone', 'the override and its reason are audited');

-- Attachments: only the uploader's own unlinked files; type and size from storage.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('documents', :'officer_id' || '/photo-1.jpg', :'officer_id', '{"mimetype": "image/jpeg", "size": 2048}'),
  ('documents', :'officer_id' || '/id-1.pdf', :'officer_id', '{"mimetype": "application/pdf", "size": 4096}'),
  ('documents', :'cashier_id' || '/id-2.pdf', :'cashier_id', '{"mimetype": "application/pdf", "size": 4096}');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Doc", "last_name": "Test", "phone": "0999 100 004",
  "id_type": "passport", "id_number": "T-100004",
  "files": [{"kind": "id_document", "storage_path": "%s/id-2.pdf", "file_name": "id.pdf"}]}')$$, :'cashier_id')),
  '^INVALID_STATE', 'a file uploaded by someone else cannot be linked');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Doc", "last_name": "Test", "phone": "0999 100 004",
  "id_type": "passport", "id_number": "T-100004",
  "files": [{"kind": "photo", "storage_path": "%s/id-1.pdf", "file_name": "id.pdf"}]}')$$, :'officer_id')),
  '^INVALID_STATE', 'a photo must be an image');
select is(tests.try_as('authenticated', :'officer_id', format($$select public.create_customer('{
  "type": "individual", "first_name": "Doc", "last_name": "Test", "phone": "0999 100 004",
  "id_type": "passport", "id_number": "T-100004",
  "files": [{"kind": "photo", "storage_path": "%1$s/photo-1.jpg", "file_name": "me.jpg"},
            {"kind": "id_document", "storage_path": "%1$s/id-1.pdf", "file_name": "Passport.pdf"}]}')$$, :'officer_id')),
  null, 'a customer is created with a photo and an ID scan');
select results_eq(
  $$select a.kind, a.mime, a.size_bytes, c.photo_path = a.storage_path from public.attachments a
      join public.customers c on c.id = a.entity_id where c.id_number = 'T-100004' order by a.kind$$,
  format($$values ('id_document'::text, 'application/pdf'::text, 4096::bigint, false), ('photo', 'image/jpeg', 2048, true)$$),
  'attachments record storage facts and the photo path is set');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.add_customer_documents(
  (select id from public.customers where id_number = 'T-100001'),
  '[{"kind": "other", "storage_path": "%s/id-1.pdf", "file_name": "again.pdf"}]')$$, :'officer_id')),
  '^INVALID_STATE', 'a file can be linked only once');

-- RLS and immutability.
select is(tests.value_as('authenticated', :'cashier_id',
  $$select count(*) from public.customers where id_number in ('T-100001', 'T-100004')$$)::int, 2,
  'every staff member reads customers');
select matches(tests.try_as('anon', null, 'select count(*) from public.customers'), '^permission denied',
  'anonymous users cannot read customers');
select matches(tests.try_as('authenticated', :'manager_id',
  $$update public.customers set phone = '0999 000 000' where id_number = 'T-100001'$$),
  '^permission denied', 'customers cannot be updated directly (edits need approval)');
select throws_ok(
  $$delete from public.attachments where storage_path like '%/photo-1.jpg'$$,
  null, null, 'attachments are append-only, even for the owner');

select * from finish();
rollback;
