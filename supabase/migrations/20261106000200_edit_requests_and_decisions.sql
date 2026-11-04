-- M2.3: customer edit and status requests (SPEC 5.11; FR-04), the approval dispatcher
-- decide_approval (SPEC 8; FR-28) and the capital-in request for recipe R10 (R-14, approved by
-- Foday 2026-11-04). Requester and approver always differ (SELF_APPROVAL, CLAUDE.md rule 7).

alter table public.approval_requests drop constraint approval_requests_type_check;
alter table public.approval_requests add constraint approval_requests_type_check
  check (type in ('customer_edit', 'loan_approval', 'loan_extension', 'payment_void', 'journal_reversal',
                  'write_off', 'expense', 'manual_journal', 'day_close', 'customer_blacklist', 'capital_in'));

-- One open request of a kind per record: a second edit of the same customer waits until the first
-- is decided, so the approver never sees two competing versions.
create unique index approval_requests_one_pending_idx
  on public.approval_requests (type, entity_id)
  where status = 'pending' and entity_id is not null;

-- Posting date rule shared by journal requests (A-19): today only after go-live, never in the
-- future. Checked when the request is made and again when it is approved.
create or replace function public.require_posting_date(p_date date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_go_live date;
begin
  if p_date is null then
    raise exception 'INVALID_STATE: the journal needs a valid date' using errcode = '22023';
  end if;
  select (value #>> '{}')::date into v_go_live from settings where key = 'migration.go_live_date';
  if v_go_live is not null and business_today() >= v_go_live and p_date <> business_today() then
    raise exception 'DATE_NOT_ALLOWED: after go-live a journal is dated today' using errcode = '42501';
  end if;
  if p_date > business_today() then
    raise exception 'DATE_NOT_ALLOWED: a journal cannot be dated in the future' using errcode = '42501';
  end if;
end
$$;

revoke execute on function public.require_posting_date(date) from public, anon, authenticated, service_role;

-- request_customer_edit (SPEC 8). p_patch holds the fields to change (column names, as in
-- create_customer), or {"photo": {"storage_path": "<uid>/<file>", "file_name": "..."}} for a new
-- photo, or {"status": "blacklisted" | "archived" | "active"} alone for a status change (its own
-- request type, reason required). "duplicate_override": true lets a manager keep a changed phone or
-- ID that matches another customer, with p_reason as the reason. Nothing changes until approved.
create or replace function public.request_customer_edit(p_customer_id uuid, p_patch jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current customers;
  v_candidate customers;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb) - 'duplicate_override';
  v_clean jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_photo jsonb;
  v_overridden jsonb := '[]'::jsonb;
  v_type text := 'customer_edit';
  v_payload jsonb;
  v_id uuid;
begin
  perform require_role('loan_officer', 'cashier', 'manager', 'admin');
  select * into v_current from customers where id = p_customer_id;
  if not found then
    raise exception 'INVALID_STATE: the customer does not exist' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'INVALID_STATE: the change must be a set of fields' using errcode = '22023';
  end if;
  if length(v_reason) > 300 then
    raise exception 'INVALID_STATE: the reason is too long (300 characters at most)' using errcode = '22023';
  end if;

  if v_patch ? 'status' then
    if (select count(*) from jsonb_object_keys(v_patch)) <> 1 then
      raise exception 'INVALID_STATE: a status change is requested on its own' using errcode = '22023';
    end if;
    if v_patch ->> 'status' not in ('active', 'blacklisted', 'archived') or v_patch ->> 'status' = v_current.status then
      raise exception 'INVALID_STATE: choose a different status' using errcode = '22023';
    end if;
    if v_reason is null then
      raise exception 'INVALID_STATE: a status change needs a reason' using errcode = '22023';
    end if;
    v_type := 'customer_blacklist';
    v_changes := jsonb_build_object('status', jsonb_build_object('before', v_current.status,
                                                                 'after', v_patch ->> 'status'));
  else
    for v_key in select jsonb_object_keys(v_patch) loop
      if v_key <> 'photo' and not v_key = any (customer_editable_fields()) then
        raise exception 'INVALID_STATE: % cannot be changed this way', v_key using errcode = '22023';
      end if;
    end loop;
    v_clean := customer_clean(v_patch);
    v_candidate := jsonb_populate_record(v_current, v_clean);
    perform validate_customer(v_candidate);
    for v_key in select jsonb_object_keys(v_clean) loop
      if (to_jsonb(v_current) -> v_key) is distinct from (to_jsonb(v_candidate) -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object(
          'before', to_jsonb(v_current) -> v_key, 'after', to_jsonb(v_candidate) -> v_key));
      end if;
    end loop;
    if v_patch ? 'photo' then
      v_photo := claim_upload(v_patch #>> '{photo,storage_path}', true)
        || jsonb_build_object('file_name',
             coalesce(nullif(left(btrim(coalesce(v_patch #>> '{photo,file_name}', '')), 200), ''), 'photo'));
    end if;
    if v_changes = '{}'::jsonb and v_photo is null then
      raise exception 'INVALID_STATE: nothing would change' using errcode = '22023';
    end if;
    if v_changes ?| array['phone', 'phone_alt', 'id_number'] then
      v_overridden := guard_duplicate_customer(v_candidate, (p_patch ->> 'duplicate_override')::boolean, v_reason);
    end if;
  end if;

  if exists (select 1 from approval_requests
              where status = 'pending' and entity_id = p_customer_id
                and type in ('customer_edit', 'customer_blacklist')) then
    raise exception 'INVALID_STATE: a change to this customer is already waiting for approval' using errcode = '22023';
  end if;

  v_payload := jsonb_build_object(
    'customer_id', v_current.id, 'code', v_current.code, 'name', customer_display_name(v_current),
    'changes', v_changes)
    || case when v_photo is null then '{}'::jsonb else jsonb_build_object('photo', v_photo) end
    || case when jsonb_array_length(v_overridden) > 0
            then jsonb_build_object('duplicate_override', jsonb_build_object('matches', v_overridden, 'reason', v_reason))
            else '{}'::jsonb end;

  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values (v_type, 'customer', v_current.id, v_payload, 'manager', v_reason, auth.uid())
  returning id into v_id;

  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', v_type, 'required_role', 'manager', 'payload', v_payload));
  return v_id;
end
$$;

revoke execute on function public.request_customer_edit(uuid, jsonb, text) from public, anon, service_role;
grant execute on function public.request_customer_edit(uuid, jsonb, text) to authenticated;

-- apply_customer_edit (SPEC 5.11): applies an approved request. Refuses if any changed field no
-- longer has the value the requester saw, and checks fields and duplicates again.
create or replace function public.apply_customer_edit(p_request public.approval_requests)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current customers;
  v_updated customers;
  v_changes jsonb := p_request.payload -> 'changes';
  v_key text;
  v_after jsonb := '{}'::jsonb;
  v_photo jsonb := p_request.payload -> 'photo';
  v_object record;
begin
  select * into v_current from customers where id = p_request.entity_id for update;
  if not found then
    raise exception 'INVALID_STATE: the customer does not exist' using errcode = 'P0002';
  end if;
  for v_key in select jsonb_object_keys(v_changes) loop
    if (to_jsonb(v_current) -> v_key) is distinct from (v_changes -> v_key -> 'before') then
      raise exception 'INVALID_STATE: the record changed after this request was made; reject it and ask for a new one'
        using errcode = '22023';
    end if;
    v_after := v_after || jsonb_build_object(v_key, v_changes -> v_key -> 'after');
  end loop;

  if v_photo is not null then
    select o.metadata into v_object from storage.objects o
     where o.bucket_id = 'documents' and o.name = v_photo ->> 'storage_path'
       and o.owner_id = p_request.requested_by::text;
    if not found or exists (select 1 from attachments where storage_path = v_photo ->> 'storage_path') then
      raise exception 'INVALID_STATE: the new photo is no longer available' using errcode = '22023';
    end if;
    insert into attachments (entity_type, entity_id, kind, storage_path, file_name, mime, size_bytes, created_by)
    values ('customer', v_current.id, 'photo', v_photo ->> 'storage_path', v_photo ->> 'file_name',
            coalesce(v_object.metadata ->> 'mimetype', v_photo ->> 'mime'),
            coalesce((v_object.metadata ->> 'size')::bigint, (v_photo ->> 'size_bytes')::bigint),
            p_request.requested_by);
    v_after := v_after || jsonb_build_object('photo_path', v_photo ->> 'storage_path');
    v_changes := v_changes || jsonb_build_object('photo_path', jsonb_build_object(
      'before', to_jsonb(v_current.photo_path), 'after', v_photo -> 'storage_path'));
  end if;

  v_updated := jsonb_populate_record(v_current, v_after);
  if p_request.type = 'customer_edit' then
    perform validate_customer(v_updated);
    if v_changes ?| array['phone', 'phone_alt', 'id_number']
       and p_request.payload -> 'duplicate_override' is null
       and jsonb_array_length(find_duplicate_customers(v_updated.phone, v_updated.phone_alt, v_updated.id_number,
                                                       v_updated.id)) > 0 then
      raise exception 'DUPLICATE_CUSTOMER: another customer now has this phone or ID number'
        using errcode = '23505',
              detail = find_duplicate_customers(v_updated.phone, v_updated.phone_alt, v_updated.id_number,
                                                v_updated.id)::text;
    end if;
  end if;

  update customers set
    first_name = v_updated.first_name, last_name = v_updated.last_name, business_name = v_updated.business_name,
    registration_no = v_updated.registration_no, contact_person = v_updated.contact_person,
    phone = v_updated.phone, phone_alt = v_updated.phone_alt, address = v_updated.address, city = v_updated.city,
    id_type = v_updated.id_type, id_number = v_updated.id_number, date_of_birth = v_updated.date_of_birth,
    occupation = v_updated.occupation, employer_or_business = v_updated.employer_or_business,
    next_of_kin_name = v_updated.next_of_kin_name, next_of_kin_phone = v_updated.next_of_kin_phone,
    next_of_kin_relation = v_updated.next_of_kin_relation, branch_id = v_updated.branch_id,
    assigned_officer_id = v_updated.assigned_officer_id, notes = v_updated.notes,
    photo_path = v_updated.photo_path, status = v_updated.status
  where id = v_current.id;

  -- The audit row carries only the changed fields, before and after (T-29).
  perform write_audit('customer.updated', 'customer', v_current.id::text,
    (select coalesce(jsonb_object_agg(key, value -> 'before'), '{}'::jsonb) from jsonb_each(v_changes)),
    (select coalesce(jsonb_object_agg(key, value -> 'after'), '{}'::jsonb) from jsonb_each(v_changes))
      || jsonb_build_object('approval_request_id', p_request.id, 'requested_by', p_request.requested_by));
  return jsonb_build_object('customer_id', v_current.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(v_changes) k));
end
$$;

revoke execute on function public.apply_customer_edit(public.approval_requests) from public, anon, authenticated, service_role;

-- request_capital_in (recipe R10: Dr cash/bank, Cr 3000 Owner's Capital), requested by the
-- accountant or admin and approved by a manager, like a manual journal (R-14). Input:
-- {"entry_date": "YYYY-MM-DD", "account": "1010-BR2" | "1020" | "1030", "amount_cents": 200000,
--  "memo": "...", "reference": "..."}
create or replace function public.request_capital_in(p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_account accounts;
  v_amount bigint;
  v_memo text := btrim(coalesce(p_request ->> 'memo', ''));
  v_reference text := nullif(btrim(coalesce(p_request ->> 'reference', '')), '');
  v_lines jsonb;
  v_payload jsonb;
  v_id uuid;
begin
  perform require_role('accountant', 'admin');
  begin
    v_date := (p_request ->> 'entry_date')::date;
  exception when others then
    v_date := null;
  end;
  perform require_posting_date(v_date);
  if jsonb_typeof(p_request -> 'amount_cents') <> 'number'
     or (p_request ->> 'amount_cents') !~ '^[0-9]+$' or (p_request ->> 'amount_cents')::numeric <= 0 then
    raise exception 'INVALID_STATE: the amount must be a positive whole number of cents' using errcode = '22023';
  end if;
  v_amount := (p_request ->> 'amount_cents')::bigint;
  select * into v_account from accounts
   where code = p_request ->> 'account' and active and (is_cash or code in ('1020', '1030'));
  if not found then
    raise exception 'INVALID_STATE: choose a branch cash, bank or mobile money account' using errcode = '22023';
  end if;
  if v_memo = '' or length(v_memo) > 500 or length(v_reference) > 100 then
    raise exception 'INVALID_STATE: a capital entry needs a memo (up to 500 characters)' using errcode = '22023';
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account', v_account.code, 'debit_cents', v_amount),
    jsonb_build_object('account', '3000', 'credit_cents', v_amount));

  -- Dry run under the real posting rules (periods, accounts, balance), always rolled back.
  begin
    perform post_journal(v_date, v_memo, 'capital_in', null, v_account.branch_id, v_lines);
    raise exception 'DRY_RUN_OK';
  exception when others then
    if sqlerrm <> 'DRY_RUN_OK' then
      raise;
    end if;
  end;

  v_payload := jsonb_build_object('entry_date', v_date, 'memo', v_memo, 'reference', v_reference,
                                  'account', v_account.code, 'amount_cents', v_amount,
                                  'branch_id', v_account.branch_id, 'lines', v_lines);
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('capital_in', 'journal', null, v_payload, 'manager', v_memo, auth.uid())
  returning id into v_id;

  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'capital_in', 'required_role', 'manager', 'payload', v_payload));
  return v_id;
end
$$;

revoke execute on function public.request_capital_in(jsonb) from public, anon, service_role;
grant execute on function public.request_capital_in(jsonb) to authenticated;

-- decide_approval (SPEC 8; FR-28): one entry point for every maker-checker decision, dispatching on
-- the request type. p_decision is 'approve' or 'reject'; a rejection needs a note. Types whose
-- effects arrive in later milestones are refused until then.
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('manager', 'ceo');
  v_request approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb := '{}'::jsonb;
  v_journal uuid;
begin
  select * into v_request from approval_requests where id = p_id for update;
  if not found then
    raise exception 'INVALID_STATE: the request does not exist' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'INVALID_STATE: this request was already decided' using errcode = '22023';
  end if;
  if v_request.required_role = 'ceo' and v_role <> 'ceo' then
    raise exception 'FORBIDDEN: only the CEO can decide this request' using errcode = '42501';
  end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'SELF_APPROVAL: you cannot decide a request you made' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_STATE: the decision must be approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'INVALID_STATE: give a reason for the rejection' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long (500 characters at most)' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    case v_request.type
      when 'customer_edit', 'customer_blacklist' then
        v_result := apply_customer_edit(v_request);
      when 'manual_journal', 'capital_in' then
        perform require_posting_date((v_request.payload ->> 'entry_date')::date);
        v_journal := post_journal((v_request.payload ->> 'entry_date')::date, v_request.payload ->> 'memo',
                                  v_request.type, v_request.id, nullif(v_request.payload ->> 'branch_id', '')::uuid,
                                  v_request.payload -> 'lines');
        v_result := jsonb_build_object('journal_id', v_journal,
                                       'journal_no', (select journal_no from journals where id = v_journal));
      else
        raise exception 'INVALID_STATE: requests of this type cannot be decided yet' using errcode = '22023';
    end case;
  end if;

  update approval_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = app_now(), decision_note = v_note
   where id = v_request.id;

  perform write_audit(case when p_decision = 'approve' then 'approval.approved' else 'approval.rejected' end,
    'approval_request', v_request.id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
                       'type', v_request.type, 'note', v_note, 'result', v_result));
  return v_result;
end
$$;

revoke execute on function public.decide_approval(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;
