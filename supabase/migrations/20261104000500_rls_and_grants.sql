-- M0.2 Foundation: row level security and privileges.
-- SPEC 6.4: RLS on every table, read policies only, writes only through security definer RPCs,
-- functions revoked from public and granted explicitly.

alter table public.app_environment enable row level security;
alter table public.settings enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.hash_chains enable row level security;
alter table public.audit_log enable row level security;
alter table public.document_sequences enable row level security;

-- Read policies (SPEC 4 "Read access"). All active staff read branches, staff names and settings
-- (the company header is on every screen). The audit log is for CEO, manager and admin.
create policy app_environment_read on public.app_environment
  for select to authenticated using ((select public.is_staff()));

create policy settings_read on public.settings
  for select to authenticated using ((select public.is_staff()));

create policy branches_read on public.branches
  for select to authenticated using ((select public.is_staff()));

create policy profiles_read on public.profiles
  for select to authenticated using ((select public.is_staff()));

create policy audit_log_read on public.audit_log
  for select to authenticated
  using ((select public.auth_role()) in ('ceo', 'manager', 'admin'));

-- hash_chains and document_sequences have no policies: no client reads or writes them.

-- Table privileges: nobody but the database owner writes tables directly. The anonymous role has
-- no table access at all; the service role cannot write either (defence in depth: server code uses
-- the service role only for auth administration, SPEC 8).
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;

-- Function privileges: revoke everything, then grant what clients may call.
revoke execute on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;

grant execute on function public.app_now() to authenticated;
grant execute on function public.business_today() to authenticated;
grant execute on function public.environment_kind() to authenticated;
grant execute on function public.auth_role() to authenticated;
grant execute on function public.auth_branch() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.update_setting(text, jsonb) to authenticated;
grant execute on function public.upsert_branch(jsonb) to authenticated;
grant execute on function public.admin_set_profile(uuid, text, text, public.app_role, uuid, boolean) to authenticated;

-- Integrity check (R-02, R-03): server-side health and nightly jobs only.
grant execute on function public.verify_audit_chain() to service_role;
