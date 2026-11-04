-- M2.1: customer register (SPEC 5.11, 7.2; FR-03), attachments and the private `documents` bucket
-- (SPEC 6.4). Customers are created directly by a loan officer, manager or admin (SPEC 4); every
-- later change goes through approval (M2.3). Nothing is ever deleted.

-- Comparison keys for the duplicate guard. Phones compare by digits, with the Liberian country
-- code folded to the local form (+231 770 555 010 = 0770 555 010); ID numbers compare without
-- spaces, dashes or case.
create or replace function public.phone_key(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when d = '' then null
    when d like '231%' and length(d) > 9 then '0' || substr(d, 4)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) s
$$;

create or replace function public.id_number_key(p_id text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(upper(regexp_replace(coalesce(p_id, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

revoke execute on function public.phone_key(text), public.id_number_key(text) from public, anon, authenticated, service_role;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null check (type in ('individual', 'business')),
  first_name text,
  last_name text,
  business_name text,
  registration_no text,
  contact_person text,
  phone text not null,
  phone_alt text,
  address text,
  city text,
  id_type text check (id_type in ('national_id', 'passport', 'voter_card', 'drivers_license', 'other')),
  id_number text,
  date_of_birth date,
  occupation text,
  employer_or_business text,
  next_of_kin_name text,
  next_of_kin_phone text,
  next_of_kin_relation text,
  photo_path text,
  branch_id uuid not null references public.branches (id),
  assigned_officer_id uuid references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'blacklisted', 'archived')),
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now(),
  phone_key text generated always as (public.phone_key(phone)) stored,
  phone_alt_key text generated always as (public.phone_key(phone_alt)) stored,
  id_number_key text generated always as (public.id_number_key(id_number)) stored,
  -- Lower-case text for the list search (name, code, phone as typed and as digits, ID number).
  search_text text generated always as (lower(
    code || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(business_name, '')
    || ' ' || coalesce(contact_person, '') || ' ' || phone || ' ' || coalesce(public.phone_key(phone), '')
    || ' ' || coalesce(phone_alt, '') || ' ' || coalesce(public.phone_key(phone_alt), '')
    || ' ' || coalesce(id_number, '') || ' ' || coalesce(public.id_number_key(id_number), ''))) stored,
  constraint customer_names check (
    (type = 'individual' and nullif(btrim(first_name), '') is not null and nullif(btrim(last_name), '') is not null)
    or (type = 'business' and nullif(btrim(business_name), '') is not null)),
  constraint customer_id_pair check ((id_type is null) = (id_number is null))
);

comment on table public.customers is 'Customer register (SPEC 7.2). Edits only through approved requests; never deleted.';

create index customers_branch_id_idx on public.customers (branch_id);
create index customers_assigned_officer_id_idx on public.customers (assigned_officer_id);
create index customers_created_by_idx on public.customers (created_by);
create index customers_phone_key_idx on public.customers (phone_key);
create index customers_phone_alt_key_idx on public.customers (phone_alt_key) where phone_alt_key is not null;
create index customers_id_number_key_idx on public.customers (id_number_key) where id_number_key is not null;
create index customers_status_created_idx on public.customers (status, created_at desc);

-- Display name used in lists, approvals and audit rows.
create or replace function public.customer_display_name(p_customer public.customers)
returns text
language sql
stable
set search_path = public
as $$
  select case when p_customer.type = 'business' then btrim(p_customer.business_name)
              else btrim(btrim(p_customer.first_name) || ' ' || btrim(p_customer.last_name)) end
$$;

revoke execute on function public.customer_display_name(public.customers) from public, anon, authenticated, service_role;

-- Attachments (SPEC 7.2): append-only. Replacing a file adds a row.
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer', 'loan', 'collateral', 'recovery_action', 'expense')),
  entity_id uuid not null,
  kind text not null,
  storage_path text not null unique,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now()
);

comment on table public.attachments is 'Files linked to records (SPEC 7.2). Append-only; storage_path is in the documents bucket.';

create index attachments_entity_idx on public.attachments (entity_type, entity_id, created_at);
create index attachments_created_by_idx on public.attachments (created_by);

create trigger attachments_immutable
  before update or delete on public.attachments
  for each row execute function public.trg_immutable();

-- RLS: every active staff member reads customers and their documents (SPEC 4); only RPCs write.
alter table public.customers enable row level security;
alter table public.attachments enable row level security;

create policy customers_read on public.customers
  for select to authenticated using ((select public.is_staff()));
create policy attachments_read on public.attachments
  for select to authenticated using ((select public.is_staff()));

revoke all on public.customers, public.attachments from anon;
revoke insert, update, delete, truncate, references, trigger on public.customers, public.attachments
  from authenticated, service_role;

-- Private bucket for customer photos and document scans. Uploads go to a folder named after the
-- uploader (`<user id>/<file>`); the RPC that links a file checks the uploader. Downloads use
-- short-lived signed URLs created server-side for signed-in staff. No update or delete policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy documents_read_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select public.is_staff()));

create policy documents_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.auth_role()) in ('loan_officer', 'cashier', 'manager', 'admin')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Checks that a file was uploaded by the caller to the documents bucket and is not yet linked, and
-- returns the stored file facts (type and size come from storage, not from the browser).
create or replace function public.claim_upload(p_path text, p_images_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_object record;
begin
  select o.name, o.metadata into v_object
    from storage.objects o
   where o.bucket_id = 'documents' and o.name = p_path and o.owner_id = auth.uid()::text;
  if not found or (storage.foldername(p_path))[1] is distinct from auth.uid()::text then
    raise exception 'INVALID_STATE: the file was not found among your uploads' using errcode = '22023';
  end if;
  if exists (select 1 from attachments where storage_path = p_path) then
    raise exception 'INVALID_STATE: the file is already linked to a record' using errcode = '22023';
  end if;
  if p_images_only and coalesce(v_object.metadata ->> 'mimetype', '') not like 'image/%' then
    raise exception 'INVALID_STATE: a photo must be an image' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'storage_path', p_path,
    'mime', coalesce(v_object.metadata ->> 'mimetype', 'application/octet-stream'),
    'size_bytes', coalesce((v_object.metadata ->> 'size')::bigint, 0));
end
$$;

revoke execute on function public.claim_upload(text, boolean) from public, anon, authenticated, service_role;

-- Links uploaded files to a record. Called by the RPCs that own the record (create_customer,
-- add_customer_document, later collateral and expenses); not callable directly.
create or replace function public.link_attachments(p_entity_type text, p_entity_id uuid, p_files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_claim jsonb;
  v_kind text;
  v_name text;
  v_linked jsonb := '[]'::jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return v_linked;
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'INVALID_STATE: at most 10 files at a time' using errcode = '22023';
  end if;
  for v_file in select value from jsonb_array_elements(p_files) loop
    v_kind := v_file ->> 'kind';
    v_name := left(btrim(coalesce(v_file ->> 'file_name', '')), 200);
    if p_entity_type = 'customer' and v_kind not in ('photo', 'id_document', 'proof_of_address', 'other') then
      raise exception 'INVALID_STATE: unknown document kind' using errcode = '22023';
    end if;
    if v_name = '' then
      raise exception 'INVALID_STATE: a file needs a name' using errcode = '22023';
    end if;
    v_claim := claim_upload(v_file ->> 'storage_path', v_kind = 'photo');
    insert into attachments (entity_type, entity_id, kind, storage_path, file_name, mime, size_bytes, created_by)
    values (p_entity_type, p_entity_id, v_kind, v_claim ->> 'storage_path', v_name, v_claim ->> 'mime',
            (v_claim ->> 'size_bytes')::bigint, auth.uid());
    v_linked := v_linked || jsonb_build_object('kind', v_kind, 'storage_path', v_claim ->> 'storage_path',
                                               'file_name', v_name);
  end loop;
  return v_linked;
end
$$;

revoke execute on function public.link_attachments(text, uuid, jsonb) from public, anon, authenticated, service_role;

-- Customers matching a phone (either number) or ID number, excluding one customer (for edits).
create or replace function public.find_duplicate_customers(
  p_phone text, p_phone_alt text, p_id_number text, p_exclude uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'code', c.code, 'name', customer_display_name(c), 'status', c.status,
           'match', case when k.id_key is not null and c.id_number_key = k.id_key then 'id_number' else 'phone' end)
           order by c.code), '[]'::jsonb)
    from customers c,
         (select array_remove(array[phone_key(p_phone), phone_key(p_phone_alt)], null) as phones,
                 id_number_key(p_id_number) as id_key) k
   where (p_exclude is null or c.id <> p_exclude)
     and (k.phones && array_remove(array[c.phone_key, c.phone_alt_key], null)
          or (k.id_key is not null and c.id_number_key = k.id_key))
$$;

revoke execute on function public.find_duplicate_customers(text, text, text, uuid) from public, anon, authenticated, service_role;

-- Fields a customer form may set, and later an approved edit may change (SPEC 5.11). Code, type,
-- status (blacklisting is its own approved request) and the photo are handled separately.
create or replace function public.customer_editable_fields()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['first_name', 'last_name', 'business_name', 'registration_no', 'contact_person', 'phone',
               'phone_alt', 'address', 'city', 'id_type', 'id_number', 'date_of_birth', 'occupation',
               'employer_or_business', 'next_of_kin_name', 'next_of_kin_phone', 'next_of_kin_relation',
               'branch_id', 'assigned_officer_id', 'notes']
$$;

-- Keeps only editable keys, trims text and turns blanks into JSON null.
create or replace function public.customer_clean(p_input jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(e.key,
           case when jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '' then 'null'::jsonb
                when jsonb_typeof(e.value) = 'string' then to_jsonb(btrim(e.value #>> '{}'))
                else e.value end), '{}'::jsonb)
    from jsonb_each(coalesce(p_input, '{}'::jsonb)) e
   where e.key = any (customer_editable_fields())
$$;

-- Validates a complete customer row (new or with an edit applied). Raises INVALID_STATE.
create or replace function public.validate_customer(p_row public.customers)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text;
begin
  if p_row.type = 'individual' then
    if p_row.first_name is null or p_row.last_name is null then
      raise exception 'INVALID_STATE: first and last name are required' using errcode = '22023';
    end if;
    if p_row.id_type is null or p_row.id_number is null then
      raise exception 'INVALID_STATE: an individual needs an ID type and number' using errcode = '22023';
    end if;
  elsif p_row.type = 'business' then
    if p_row.business_name is null then
      raise exception 'INVALID_STATE: the registered business name is required' using errcode = '22023';
    end if;
    if p_row.contact_person is null then
      raise exception 'INVALID_STATE: a business needs a contact person' using errcode = '22023';
    end if;
  else
    raise exception 'INVALID_STATE: customer type must be individual or business' using errcode = '22023';
  end if;
  if (p_row.id_type is null) <> (p_row.id_number is null) then
    raise exception 'INVALID_STATE: give both the ID type and the ID number' using errcode = '22023';
  end if;
  if length(coalesce(phone_key(p_row.phone), '')) not between 7 and 15 then
    raise exception 'INVALID_STATE: the phone number is not valid' using errcode = '22023';
  end if;
  if p_row.phone_alt is not null and length(coalesce(phone_key(p_row.phone_alt), '')) not between 7 and 15 then
    raise exception 'INVALID_STATE: the second phone number is not valid' using errcode = '22023';
  end if;
  if p_row.next_of_kin_phone is not null
     and length(coalesce(phone_key(p_row.next_of_kin_phone), '')) not between 7 and 15 then
    raise exception 'INVALID_STATE: the next of kin phone number is not valid' using errcode = '22023';
  end if;
  if p_row.date_of_birth is not null and (p_row.date_of_birth >= business_today()
                                          or p_row.date_of_birth < date '1900-01-01') then
    raise exception 'INVALID_STATE: the date of birth is not valid' using errcode = '22023';
  end if;
  foreach v_text in array array[p_row.first_name, p_row.last_name, p_row.business_name, p_row.registration_no,
                                p_row.contact_person, p_row.phone, p_row.phone_alt, p_row.city, p_row.id_number,
                                p_row.occupation, p_row.employer_or_business, p_row.next_of_kin_name,
                                p_row.next_of_kin_phone, p_row.next_of_kin_relation] loop
    if length(v_text) > 120 then
      raise exception 'INVALID_STATE: a field is too long (120 characters at most)' using errcode = '22023';
    end if;
  end loop;
  if length(p_row.address) > 300 or length(p_row.notes) > 1000 then
    raise exception 'INVALID_STATE: the address or notes are too long' using errcode = '22023';
  end if;
  if not exists (select 1 from branches where id = p_row.branch_id and active) then
    raise exception 'INVALID_STATE: choose an active branch' using errcode = '22023';
  end if;
  if p_row.assigned_officer_id is not null and not exists (
       select 1 from profiles
        where id = p_row.assigned_officer_id and active and role = 'loan_officer' and branch_id = p_row.branch_id) then
    raise exception 'INVALID_STATE: the loan officer must be active and work at the customer''s branch'
      using errcode = '22023';
  end if;
end
$$;

revoke execute on function public.customer_editable_fields(), public.customer_clean(jsonb),
  public.validate_customer(public.customers) from public, anon, authenticated, service_role;

-- Raises DUPLICATE_CUSTOMER with the matching records in DETAIL (JSON), unless a manager overrides
-- with a reason. Returns the matches that were overridden (empty when there were none).
create or replace function public.guard_duplicate_customer(
  p_row public.customers, p_override boolean, p_override_reason text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matches jsonb := find_duplicate_customers(p_row.phone, p_row.phone_alt, p_row.id_number, p_row.id);
begin
  if jsonb_array_length(v_matches) = 0 then
    return v_matches;
  end if;
  if not coalesce(p_override, false) then
    raise exception 'DUPLICATE_CUSTOMER: a customer with this phone or ID number already exists'
      using errcode = '23505', detail = v_matches::text;
  end if;
  if auth_role() is distinct from 'manager' then
    raise exception 'FORBIDDEN: only a manager can override the duplicate check' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'INVALID_STATE: give a reason for overriding the duplicate check' using errcode = '22023';
  end if;
  return v_matches;
end
$$;

revoke execute on function public.guard_duplicate_customer(public.customers, boolean, text)
  from public, anon, authenticated, service_role;

-- create_customer (SPEC 8; FR-03). Input: the editable fields plus
--   "type": "individual" | "business",
--   "files": [{"kind": "photo" | "id_document" | "proof_of_address" | "other",
--              "storage_path": "<uid>/<file>", "file_name": "..."}],
--   "duplicate_override": true, "duplicate_reason": "..." (manager only).
-- A loan officer creates in their own branch and is the assigned officer. Returns the code.
create or replace function public.create_customer(p_customer jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager', 'admin');
  v_clean jsonb := customer_clean(p_customer);
  v_row customers;
  v_overridden jsonb;
  v_files jsonb := coalesce(p_customer -> 'files', '[]'::jsonb);
  v_linked jsonb;
  v_photo text;
begin
  if v_role = 'loan_officer' then
    if v_clean ->> 'branch_id' is not null and (v_clean ->> 'branch_id')::uuid is distinct from auth_branch() then
      raise exception 'FORBIDDEN: a loan officer creates customers in their own branch' using errcode = '42501';
    end if;
    v_clean := v_clean || jsonb_build_object('branch_id', auth_branch(), 'assigned_officer_id', auth.uid());
  elsif v_clean ->> 'branch_id' is null then
    v_clean := v_clean || jsonb_build_object('branch_id', auth_branch());
  end if;

  v_row := jsonb_populate_record(null::customers, v_clean || jsonb_build_object(
    'id', gen_random_uuid(), 'type', p_customer ->> 'type', 'status', 'active'));
  if v_row.branch_id is null then
    raise exception 'INVALID_STATE: choose a branch' using errcode = '22023';
  end if;
  perform validate_customer(v_row);
  v_overridden := guard_duplicate_customer(v_row, (p_customer ->> 'duplicate_override')::boolean,
                                           p_customer ->> 'duplicate_reason');

  if jsonb_typeof(v_files) <> 'array'
     or (select count(*) from jsonb_array_elements(v_files) f where f ->> 'kind' = 'photo') > 1 then
    raise exception 'INVALID_STATE: send at most one photo' using errcode = '22023';
  end if;
  select f ->> 'storage_path' into v_photo from jsonb_array_elements(v_files) f where f ->> 'kind' = 'photo';

  v_row.code := next_number('customer', null);
  insert into customers (id, code, type, first_name, last_name, business_name, registration_no, contact_person,
                         phone, phone_alt, address, city, id_type, id_number, date_of_birth, occupation,
                         employer_or_business, next_of_kin_name, next_of_kin_phone, next_of_kin_relation,
                         photo_path, branch_id, assigned_officer_id, status, notes, created_by)
  values (v_row.id, v_row.code, v_row.type, v_row.first_name, v_row.last_name, v_row.business_name,
          v_row.registration_no, v_row.contact_person, v_row.phone, v_row.phone_alt, v_row.address, v_row.city,
          v_row.id_type, v_row.id_number, v_row.date_of_birth, v_row.occupation, v_row.employer_or_business,
          v_row.next_of_kin_name, v_row.next_of_kin_phone, v_row.next_of_kin_relation, v_photo, v_row.branch_id,
          v_row.assigned_officer_id, 'active', v_row.notes, auth.uid());

  v_linked := link_attachments('customer', v_row.id, v_files);

  perform write_audit('customer.created', 'customer', v_row.id::text, null,
    (select to_jsonb(c) - array['phone_key', 'phone_alt_key', 'id_number_key', 'search_text'] from customers c where c.id = v_row.id)
    || jsonb_build_object('files', v_linked)
    || case when jsonb_array_length(v_overridden) > 0
            then jsonb_build_object('duplicate_override', jsonb_build_object(
                   'matches', v_overridden, 'reason', btrim(p_customer ->> 'duplicate_reason')))
            else '{}'::jsonb end);
  return v_row.code;
end
$$;

revoke execute on function public.create_customer(jsonb) from public, anon, service_role;
grant execute on function public.create_customer(jsonb) to authenticated;

-- Adds documents to an existing customer. Adding a file changes no customer data and nothing is
-- replaced or removed, so it needs no approval; the photo changes only through an approved edit.
create or replace function public.add_customer_documents(p_customer_id uuid, p_files jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked jsonb;
begin
  perform require_role('loan_officer', 'cashier', 'manager', 'admin');
  if not exists (select 1 from customers where id = p_customer_id) then
    raise exception 'INVALID_STATE: the customer does not exist' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'INVALID_STATE: choose at least one file' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_files) f where f ->> 'kind' = 'photo') then
    raise exception 'INVALID_STATE: a new photo is a customer edit and needs approval' using errcode = '22023';
  end if;
  v_linked := link_attachments('customer', p_customer_id, p_files);
  perform write_audit('customer.documents_added', 'customer', p_customer_id::text, null,
                      jsonb_build_object('files', v_linked));
end
$$;

revoke execute on function public.add_customer_documents(uuid, jsonb) from public, anon, service_role;
grant execute on function public.add_customer_documents(uuid, jsonb) to authenticated;
