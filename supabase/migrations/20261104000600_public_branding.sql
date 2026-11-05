-- M0.3: the sign-in page is shown before anyone is signed in, so it cannot read `settings`
-- (staff only). This read-only function exposes the company name and short name and nothing else.
-- SPEC 11 Branding: names come from settings.company, never from code.
create or replace function public.public_branding()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', value ->> 'name', 'short_name', value ->> 'short_name')
    from settings
   where key = 'company';
$$;

revoke execute on function public.public_branding() from public;
grant execute on function public.public_branding() to anon, authenticated;
