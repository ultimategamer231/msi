-- M0.5: admin-only additions for the settings screen (FR-01, FR-02, FR-26).

-- The admin uploads a new company logo. Uploads always create a new object (never overwrite or
-- delete), then settings.company.logo_path is pointed at it through update_setting (audited).
create policy branding_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select public.auth_role()) = 'admin');

-- Password resets happen in Supabase Auth (server action with the service role, SPEC 8). This
-- records the reset in the audit log as the admin who did it. The new password is never stored here.
create or replace function public.admin_record_password_reset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_role('admin');
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'INVALID_STATE: no staff profile exists for user %', p_user_id using errcode = 'P0002';
  end if;
  perform write_audit('profile.password_reset', 'profile', p_user_id::text, null, null);
end
$$;

revoke execute on function public.admin_record_password_reset(uuid) from public, anon, service_role;
grant execute on function public.admin_record_password_reset(uuid) to authenticated;
