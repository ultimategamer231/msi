-- M6.1: collateral register (SPEC 5.9; FR-15, FR-16). Photos and documents, duplicate-identifier
-- warning, custody events, release when every linked loan has ended. Also the recovery case
-- number series RC-000001 (B-04), used from M6.3.

create or replace function public.sequence_scope(p_kind text, p_branch uuid)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p_kind in ('loan', 'journal', 'customer', 'collateral', 'recovery_case') or p_branch is null
              then global_sequence_branch() else p_branch end;
$$;

create or replace function public.next_number(p_kind text, p_branch uuid default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  n bigint;
  code text;
  scope uuid := sequence_scope(p_kind, p_branch);
begin
  insert into document_sequences (kind, branch_id, last_value) values (p_kind, scope, 0)
  on conflict (kind, branch_id) do nothing;
  update document_sequences set last_value = last_value + 1
   where kind = p_kind and branch_id = scope
  returning last_value into n;
  select coalesce((select br.code from branches br where br.id = p_branch), 'HQ') into code;
  return case p_kind
    when 'receipt'    then format('RCT-%s-%s', code, lpad(n::text, 6, '0'))
    when 'loan'       then format('LN-%s-%s', code, lpad(n::text, 5, '0'))
    when 'journal'    then format('JV-%s', lpad(n::text, 7, '0'))
    when 'customer'   then format('CU-%s', lpad(n::text, 6, '0'))
    when 'collateral' then format('COL-%s', lpad(n::text, 6, '0'))
    when 'expense'    then format('EXP-%s-%s', code, lpad(n::text, 6, '0'))
    when 'recovery_case' then format('RC-%s', lpad(n::text, 6, '0'))
    else format('%s-%s', upper(p_kind), n)
  end;
end
$$;

-- Collateral photos and documents use the same private store as customers (SPEC 6.4).
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
    if (p_entity_type = 'customer' and v_kind not in ('photo', 'id_document', 'proof_of_address', 'other'))
       or (p_entity_type = 'loan' and v_kind not in ('guarantor_id', 'signed_agreement', 'other'))
       or (p_entity_type = 'collateral' and v_kind not in ('photo', 'document', 'other'))
       or (p_entity_type = 'recovery_action' and v_kind not in ('court_document', 'notice', 'other'))
       or p_entity_type not in ('customer', 'loan', 'collateral', 'recovery_action') then
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

-- SPEC 5.9: warn when the same identifier is already on another item that is not released, sold or
-- lost. Staff only; returns the matching items for the warning.
create or replace function public.find_duplicate_collateral(
  p_serial_no text, p_plate_no text, p_chassis_no text, p_document_no text, p_exclude uuid default null)
returns table (id uuid, code text, description text, status text, matched text)
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select 'serial_no' as field, upper(nullif(btrim(p_serial_no), '')) as value
    union all select 'plate_no', upper(nullif(btrim(p_plate_no), ''))
    union all select 'chassis_no', upper(nullif(btrim(p_chassis_no), ''))
    union all select 'document_no', upper(nullif(btrim(p_document_no), ''))
  )
  select c.id, c.code, c.description, c.status, w.field
    from collaterals c
    join wanted w on w.value is not null and w.value = upper(btrim(case w.field
                                                             when 'serial_no' then c.serial_no
                                                             when 'plate_no' then c.plate_no
                                                             when 'chassis_no' then c.chassis_no
                                                             else c.document_no end))
   where is_staff() and c.status in ('held', 'in_recovery') and c.id is distinct from p_exclude
   order by c.code
$$;

revoke execute on function public.find_duplicate_collateral(text, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.find_duplicate_collateral(text, text, text, text, uuid) to authenticated;

-- Photos and documents of an item (append-only, like customer documents).
create or replace function public.add_collateral_documents(p_collateral_id uuid, p_files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked jsonb;
begin
  perform require_role('loan_officer', 'cashier', 'manager');
  if not exists (select 1 from collaterals where id = p_collateral_id) then
    raise exception 'INVALID_STATE: the item does not exist' using errcode = 'P0002';
  end if;
  v_linked := link_attachments('collateral', p_collateral_id, p_files);
  perform write_audit('collateral.documents_added', 'collateral', p_collateral_id::text, null,
                      jsonb_build_object('files', v_linked));
  return v_linked;
end
$$;

revoke execute on function public.add_collateral_documents(uuid, jsonb) from public, anon, service_role;
grant execute on function public.add_collateral_documents(uuid, jsonb) to authenticated;

-- Custody log (SPEC 5.9): moved (new location), valued (new estimate; manager), note, lost
-- (manager). Received, released, seized and sold are written by the functions that do those things.
create or replace function public.log_collateral_event(p_collateral_id uuid, p_event jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'cashier', 'manager');
  v_item collaterals;
  v_type text := p_event ->> 'event_type';
  v_note text := nullif(btrim(coalesce(p_event ->> 'note', '')), '');
  v_witness text := nullif(btrim(coalesce(p_event ->> 'witness_name', '')), '');
  v_to text := nullif(btrim(coalesce(p_event ->> 'to_location', '')), '');
  v_value bigint;
  v_id uuid;
begin
  select * into v_item from collaterals where id = p_collateral_id for update;
  if not found then
    raise exception 'INVALID_STATE: the item does not exist' using errcode = 'P0002';
  end if;
  if v_type is null or v_type not in ('moved', 'valued', 'note', 'lost') then
    raise exception 'INVALID_STATE: choose moved, valued, note or lost' using errcode = '22023';
  end if;
  if v_type <> 'note' and v_item.status not in ('held', 'in_recovery') then
    raise exception 'INVALID_STATE: the item is %; only a note can be added', v_item.status using errcode = '22023';
  end if;
  if v_type in ('valued', 'lost') and v_role <> 'manager' then
    raise exception 'FORBIDDEN: a manager values an item or records it lost' using errcode = '42501';
  end if;
  if length(v_note) > 500 or length(v_witness) > 120 or length(v_to) > 200 then
    raise exception 'INVALID_STATE: the text is too long' using errcode = '22023';
  end if;
  if v_type = 'moved' and v_to is null then
    raise exception 'INVALID_STATE: say where the item is now' using errcode = '22023';
  end if;
  if v_type in ('note', 'lost') and v_note is null then
    raise exception 'INVALID_STATE: write a note' using errcode = '22023';
  end if;
  if v_type = 'valued' then
    if not jsonb_is_whole_number(p_event -> 'value_cents') or (p_event ->> 'value_cents')::bigint <= 0 then
      raise exception 'INVALID_STATE: the value must be a positive whole number of cents' using errcode = '22023';
    end if;
    v_value := (p_event ->> 'value_cents')::bigint;
  end if;

  insert into collateral_events (collateral_id, event_type, from_location, to_location, note, witness_name, actor_id)
  values (v_item.id, v_type, case when v_type = 'moved' then v_item.location_note end,
          v_to, coalesce(v_note, case when v_type = 'valued' then format('Estimated value %s cents', v_value) end),
          v_witness, auth.uid())
  returning id into v_id;
  if v_type = 'moved' then
    update collaterals set location_note = v_to where id = v_item.id;
  elsif v_type = 'valued' then
    update collaterals set estimated_value_cents = v_value where id = v_item.id;
  elsif v_type = 'lost' then
    update collaterals set status = 'lost' where id = v_item.id;
  end if;
  perform write_audit('collateral.' || v_type, 'collateral', v_item.id::text,
    jsonb_build_object('status', v_item.status, 'location_note', v_item.location_note,
                       'estimated_value_cents', v_item.estimated_value_cents),
    jsonb_build_object('event_id', v_id, 'to_location', v_to, 'value_cents', v_value, 'note', v_note,
                       'witness_name', v_witness));
  return v_id;
end
$$;

revoke execute on function public.log_collateral_event(uuid, jsonb) from public, anon, service_role;
grant execute on function public.log_collateral_event(uuid, jsonb) to authenticated;

-- Release (SPEC 5.9, FR-16): cashier or manager, only when every loan the item secured has ended
-- (closed, or written off after a sale or surrender). The owner's collection is the event.
create or replace function public.release_collateral(p_collateral_id uuid, p_note text, p_witness_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item collaterals;
  v_open text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_witness text := nullif(btrim(coalesce(p_witness_name, '')), '');
begin
  perform require_role('cashier', 'manager');
  select * into v_item from collaterals where id = p_collateral_id for update;
  if not found then
    raise exception 'INVALID_STATE: the item does not exist' using errcode = 'P0002';
  end if;
  if v_item.status <> 'held' then
    raise exception 'INVALID_STATE: the item is % and cannot be released', v_item.status using errcode = '22023';
  end if;
  select string_agg(l.loan_no, ', ' order by l.loan_no) into v_open
    from loan_collaterals lc join loans l on l.id = lc.loan_id
   where lc.collateral_id = v_item.id and lc.status in ('pledged', 'seized')
     and l.status not in ('closed', 'written_off', 'cancelled', 'rejected');
  if v_open is not null then
    raise exception 'INVALID_STATE: the item still secures % ', v_open using errcode = '22023';
  end if;
  if length(v_note) > 500 or length(v_witness) > 120 then
    raise exception 'INVALID_STATE: the text is too long' using errcode = '22023';
  end if;
  update loan_collaterals set status = 'released', released_on = business_today()
   where collateral_id = v_item.id and status in ('pledged', 'seized');
  update collaterals set status = 'released' where id = v_item.id;
  insert into collateral_events (collateral_id, event_type, from_location, note, witness_name, actor_id)
  values (v_item.id, 'released', v_item.location_note, coalesce(v_note, 'Returned to the owner'), v_witness, auth.uid());
  perform write_audit('collateral.released', 'collateral', v_item.id::text, jsonb_build_object('status', 'held'),
                      jsonb_build_object('status', 'released', 'note', v_note, 'witness_name', v_witness));
end
$$;

revoke execute on function public.release_collateral(uuid, text, text) from public, anon, service_role;
grant execute on function public.release_collateral(uuid, text, text) to authenticated;
