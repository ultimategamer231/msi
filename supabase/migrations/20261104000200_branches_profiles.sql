-- M0.2 Foundation: branches, staff profiles and the auth helper functions.
-- SPEC 4 (roles, branch scoping), 6.4 (helpers), 7.1 (tables), QUESTIONS B-11 (manager without branch).

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  address text check (address is null or length(address) <= 300),
  phone text check (phone is null or length(phone) <= 40),
  active boolean not null default true,
  created_at timestamptz not null default public.app_now(),
  created_by uuid,
  updated_at timestamptz not null default public.app_now(),
  updated_by uuid
);

comment on table public.branches is 'Lending branches (SPEC 7.1). Codes appear in document numbers and never change.';

-- One profile per Supabase auth user. Users are never deleted, only deactivated, so the
-- foreign key restricts deletion of the auth user.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text check (phone is null or length(phone) <= 40),
  role public.app_role not null,
  branch_id uuid references public.branches (id),
  active boolean not null default true,
  created_at timestamptz not null default public.app_now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default public.app_now(),
  updated_by uuid references public.profiles (id),
  -- SPEC 4 + B-11: cashiers and loan officers belong to a branch; admin, CEO, manager and
  -- accountant may work across all branches.
  constraint profiles_branch_required
    check (branch_id is not null or role in ('admin', 'ceo', 'manager', 'accountant'))
);

comment on table public.profiles is 'Staff profile, role and branch for each auth user (SPEC 4, 7.1).';

create index profiles_branch_id_idx on public.profiles (branch_id);

alter table public.branches
  add constraint branches_created_by_fkey foreign key (created_by) references public.profiles (id),
  add constraint branches_updated_by_fkey foreign key (updated_by) references public.profiles (id);

alter table public.settings
  add constraint settings_updated_by_fkey foreign key (updated_by) references public.profiles (id);

-- SPEC 6.4 helpers. Inactive staff have no role, so every check fails closed for them.
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and active;
$$;

create or replace function public.auth_branch()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from profiles where id = auth.uid() and active;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Raises FORBIDDEN unless the caller is active staff with one of the given roles.
-- Internal: called by RPCs, not granted to clients.
create or replace function public.require_role(variadic p_roles public.app_role[])
returns public.app_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role := auth_role();
begin
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'FORBIDDEN: this action is not allowed for your role' using errcode = '42501';
  end if;
  return v_role;
end
$$;
