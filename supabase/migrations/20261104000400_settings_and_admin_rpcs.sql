-- M0.2 Foundation: setting validation and the admin RPCs for settings, branches and profiles.
-- SPEC 2.3 (rule settings), 4 ("Manage users, products, settings": admin), 7.1, 8, 11 (Branding),
-- FR-01, FR-02, FR-26. Every RPC checks the role itself and writes audit_log in the same transaction.

create or replace function public.setting_error(p_key text, p_problem text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  raise exception 'INVALID_SETTING: % %', p_key, p_problem using errcode = '22023';
end
$$;

create or replace function public.jsonb_is_whole_number(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p) = 'number' and p::text ~ '^-?[0-9]+$';
$$;

create or replace function public.jsonb_is_short_text(p jsonb, p_max int)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p) = 'string' and length(p #>> '{}') <= p_max;
$$;

-- Validates the shape of each known setting. Unknown keys are rejected so a typo can never create
-- a setting that the money functions silently ignore. Keys arrive in the milestone that uses them.
create or replace function public.validate_setting(p_key text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_field text;
begin
  if p_value is null then
    perform setting_error(p_key, 'needs a value');
  end if;

  case p_key
    when 'currency.base' then
      -- A-01: USD only in the MVP. LRD needs the multi-currency work in phase 2.
      if p_value <> '"USD"'::jsonb then
        perform setting_error(p_key, 'must be "USD" in this release');
      end if;

    when 'accounting.basis' then
      -- A-15: accrual is the only basis the posting recipes implement.
      if p_value <> '"accrual"'::jsonb then
        perform setting_error(p_key, 'must be "accrual" in this release');
      end if;

    when 'payments.allocation_order' then
      -- A-05: any order of the three components, each exactly once.
      if jsonb_typeof(p_value) <> 'array'
         or jsonb_array_length(p_value) <> 3
         or not (p_value @> '["penalty", "interest", "principal"]'::jsonb) then
        perform setting_error(p_key, 'must list penalty, interest and principal once each');
      end if;

    when 'approvals.loan_manager_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint <= 0 then
        perform setting_error(p_key, 'must be a positive whole number of cents');
      end if;

    when 'approvals.expense_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint < 0 then
        perform setting_error(p_key, 'must be zero or a positive whole number of cents');
      end if;

    when 'loans.collateral_required', 'collateral.multi_loan', 'extension.enabled',
         'field.require_remittance', 'daycloses.enforce', 'disbursement.check_funds' then
      if jsonb_typeof(p_value) <> 'boolean' then
        perform setting_error(p_key, 'must be true or false');
      end if;

    when 'migration.go_live_date' then
      -- A-19: null until MSI sets the go-live date.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform setting_error(p_key, 'must be null or a date YYYY-MM-DD');
      end if;
      begin
        perform (p_value #>> '{}')::date;
      exception when others then
        perform setting_error(p_key, 'is not a real date');
      end;

    when 'company' then
      -- SPEC 11 Branding. Pending fields hold "[pending]" and print blank.
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field not in ('name', 'short_name', 'address', 'phone', 'email', 'logo_path', 'receipt_footer') then
          perform setting_error(p_key, format('has an unknown field "%s"', v_field));
        end if;
      end loop;
      if not jsonb_is_short_text(p_value -> 'name', 120) or length(btrim(p_value ->> 'name')) = 0 then
        perform setting_error(p_key, 'needs a name of 1 to 120 characters');
      end if;
      if not jsonb_is_short_text(p_value -> 'short_name', 20) or length(btrim(p_value ->> 'short_name')) = 0 then
        perform setting_error(p_key, 'needs a short name of 1 to 20 characters');
      end if;
      if not (jsonb_is_short_text(p_value -> 'address', 300)
              and jsonb_is_short_text(p_value -> 'phone', 60)
              and jsonb_is_short_text(p_value -> 'email', 200)
              and jsonb_is_short_text(p_value -> 'receipt_footer', 200)) then
        perform setting_error(p_key, 'address, phone, email and receipt_footer must be text (use "" or "[pending]" when unknown)');
      end if;
      if not (jsonb_typeof(p_value -> 'logo_path') = 'null' or jsonb_is_short_text(p_value -> 'logo_path', 300)) then
        perform setting_error(p_key, 'logo_path must be a storage path or null');
      end if;

    when 'templates' then
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object of named texts');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field !~ '^[a-z_]+$' or not jsonb_is_short_text(p_value -> v_field, 10000) then
          perform setting_error(p_key, format('template "%s" must be text up to 10,000 characters', v_field));
        end if;
      end loop;

    when 'clock.override_at' then
      -- B-01: null (real time) or {"at": timestamptz, "frozen": bool}.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'object'
         or jsonb_typeof(p_value -> 'at') <> 'string'
         or (p_value ? 'frozen' and jsonb_typeof(p_value -> 'frozen') <> 'boolean')
         or exists (select 1 from jsonb_object_keys(p_value) k where k not in ('at', 'frozen', 'set_at')) then
        perform setting_error(p_key, 'must be null or {"at": "<timestamp>", "frozen": true|false}');
      end if;
      begin
        perform (p_value ->> 'at')::timestamptz;
      exception when others then
        perform setting_error(p_key, '"at" is not a valid timestamp');
      end;

    else
      perform setting_error(p_key, 'is not a known setting');
  end case;
end
$$;

-- Admin changes one setting. Returns the stored value. A change writes exactly one audit row with
-- the value before and after; saving an unchanged value writes nothing.
create or replace function public.update_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_value jsonb := p_value;
begin
  perform require_role('admin');
  perform validate_setting(p_key, p_value);

  if p_key = 'clock.override_at' then
    if not clock_override_allowed() then
      raise exception 'FORBIDDEN: the clock can only be moved in demo, test or development environments'
        using errcode = '42501';
    end if;
    if jsonb_typeof(p_value) = 'object' then
      v_value := (p_value - 'set_at')
        || jsonb_build_object('frozen', coalesce((p_value ->> 'frozen')::boolean, true), 'set_at', now());
    end if;
  end if;

  select value into v_before from settings where key = p_key for update;
  if v_before is not distinct from v_value then
    return v_value;
  end if;

  insert into settings (key, value, updated_by, updated_at)
  values (p_key, v_value, auth.uid(), app_now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  perform write_audit('setting.updated', 'setting', p_key, v_before, v_value);
  return v_value;
end
$$;

-- Admin creates or edits a branch. Input: {id?, code, name, address?, phone?, active?}.
-- A branch code never changes once created because document numbers carry it.
create or replace function public.upsert_branch(p_branch jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_branch ->> 'id', '')::uuid;
  v_before public.branches;
  v_after public.branches;
begin
  perform require_role('admin');

  if v_id is null then
    insert into branches (code, name, address, phone, active, created_by, updated_by)
    values (
      upper(btrim(p_branch ->> 'code')),
      btrim(p_branch ->> 'name'),
      nullif(btrim(p_branch ->> 'address'), ''),
      nullif(btrim(p_branch ->> 'phone'), ''),
      coalesce((p_branch ->> 'active')::boolean, true),
      auth.uid(),
      auth.uid()
    )
    returning * into v_after;
    perform write_audit('branch.created', 'branch', v_after.id::text, null, to_jsonb(v_after));
    return v_after.id;
  end if;

  select * into v_before from branches where id = v_id for update;
  if not found then
    raise exception 'INVALID_STATE: branch % does not exist', v_id using errcode = 'P0002';
  end if;
  if p_branch ? 'code' and upper(btrim(p_branch ->> 'code')) <> v_before.code then
    raise exception 'INVALID_STATE: a branch code cannot change once created' using errcode = '22023';
  end if;

  update branches
     set name = coalesce(btrim(p_branch ->> 'name'), name),
         address = case when p_branch ? 'address' then nullif(btrim(p_branch ->> 'address'), '') else address end,
         phone = case when p_branch ? 'phone' then nullif(btrim(p_branch ->> 'phone'), '') else phone end,
         active = coalesce((p_branch ->> 'active')::boolean, active),
         updated_at = app_now(),
         updated_by = auth.uid()
   where id = v_id
  returning * into v_after;

  if to_jsonb(v_before) - '{updated_at,updated_by}'::text[] <> to_jsonb(v_after) - '{updated_at,updated_by}'::text[] then
    perform write_audit('branch.updated', 'branch', v_id::text, to_jsonb(v_before), to_jsonb(v_after));
  end if;
  return v_id;
end
$$;

-- Admin creates or updates the staff profile of an existing auth user (the auth user itself is
-- created by the admin_create_user server action, SPEC 8). Admins cannot change their own role
-- or deactivate themselves, so the system always keeps an active admin.
create or replace function public.admin_set_profile(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_role public.app_role,
  p_branch_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.profiles;
  v_after public.profiles;
begin
  perform require_role('admin');

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'INVALID_STATE: no sign-in account exists for user %', p_user_id using errcode = 'P0002';
  end if;

  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception 'INVALID_STATE: you cannot remove your own admin access' using errcode = '22023';
  end if;

  if p_branch_id is not null and not exists (select 1 from branches where id = p_branch_id and active) then
    raise exception 'INVALID_STATE: the branch does not exist or is inactive' using errcode = '22023';
  end if;

  if p_branch_id is null and p_role in ('cashier', 'loan_officer') then
    raise exception 'INVALID_STATE: cashiers and loan officers need a branch' using errcode = '22023';
  end if;

  select * into v_before from profiles where id = p_user_id for update;

  if not found then
    insert into profiles (id, full_name, phone, role, branch_id, active, created_by, updated_by)
    values (p_user_id, btrim(p_full_name), nullif(btrim(p_phone), ''), p_role, p_branch_id, p_active,
            auth.uid(), auth.uid())
    returning * into v_after;
    perform write_audit('profile.created', 'profile', p_user_id::text, null, to_jsonb(v_after));
    return;
  end if;

  update profiles
     set full_name = btrim(p_full_name),
         phone = nullif(btrim(p_phone), ''),
         role = p_role,
         branch_id = p_branch_id,
         active = p_active,
         updated_at = app_now(),
         updated_by = auth.uid()
   where id = p_user_id
  returning * into v_after;

  if to_jsonb(v_before) - '{updated_at,updated_by}'::text[] <> to_jsonb(v_after) - '{updated_at,updated_by}'::text[] then
    perform write_audit('profile.updated', 'profile', p_user_id::text, to_jsonb(v_before), to_jsonb(v_after));
  end if;
end
$$;
