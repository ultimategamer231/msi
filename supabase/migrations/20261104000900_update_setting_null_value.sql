-- M0.5 fix: PostgREST passes a JSON null argument as SQL NULL, so clearing a nullable setting
-- (`migration.go_live_date`, `clock.override_at`) was refused with "needs a value". Treat SQL NULL as
-- the JSON value null; validate_setting still decides whether null is allowed for each key.
create or replace function public.update_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_value jsonb := coalesce(p_value, 'null'::jsonb);
begin
  perform require_role('admin');
  perform validate_setting(p_key, v_value);

  if p_key = 'clock.override_at' then
    if not clock_override_allowed() then
      raise exception 'FORBIDDEN: the clock can only be moved in demo, test or development environments'
        using errcode = '42501';
    end if;
    if jsonb_typeof(v_value) = 'object' then
      v_value := (v_value - 'set_at')
        || jsonb_build_object('frozen', coalesce((v_value ->> 'frozen')::boolean, true), 'set_at', now());
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
