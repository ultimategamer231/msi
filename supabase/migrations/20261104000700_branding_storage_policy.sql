-- M0.4: signed-in staff read the company logo from the private `branding` bucket through
-- short-lived signed URLs created server-side (SPEC 6.4, 11 Branding). No write policy: the logo
-- is replaced by the admin through a server action in M0.5.
create policy branding_read_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and (select public.is_staff()));
