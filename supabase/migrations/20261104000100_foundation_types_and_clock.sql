-- M0.2 Foundation: roles, shared trigger functions, deployment environment and the business clock.
-- SPEC 4 (roles), 6.3 (immutability trigger), D-06 (Africa/Monrovia), QUESTIONS B-01 (business clock).

-- Roles (SPEC 4). One role per user.
create type public.app_role as enum ('admin', 'ceo', 'manager', 'accountant', 'cashier', 'loan_officer');

-- SPEC 6.3 invariant 3: append-only tables reject UPDATE and DELETE for every role.
create or replace function public.trg_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'IMMUTABLE_RECORD: % on % is not allowed', tg_op, tg_table_name using errcode = '42501';
end
$$;

-- Deployment environment. A single row that no application role can write: only the database
-- owner changes it (seed for local development, or an operator at deploy time). It defaults to
-- 'production', so a fresh cloud database never allows the clock override.
create table public.app_environment (
  id boolean primary key default true check (id),
  kind text not null default 'production'
    check (kind in ('production', 'staging', 'demo', 'test', 'development')),
  updated_at timestamptz not null default now()
);

insert into public.app_environment default values;

create or replace function public.environment_kind()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select kind from app_environment where id;
$$;

create or replace function public.clock_override_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(environment_kind() in ('demo', 'test', 'development'), false);
$$;

-- Settings store (SPEC 7.1). Defined here because the clock reads it; validation and the admin
-- RPC are in a later migration.
create table public.settings (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)*$'),
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Business clock (B-01). Every RPC, default and view uses app_now() / business_today() instead of
-- now() / current_date. In demo, test and development environments the setting
-- `clock.override_at` = {"at": <timestamptz>, "frozen": <bool>, "set_at": <timestamptz>} moves the
-- clock; a frozen clock always returns `at`, a running clock advances from `at` in real time.
-- In staging and production the setting is ignored even if present.
create or replace function public.app_now()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_override jsonb;
begin
  if not clock_override_allowed() then
    return now();
  end if;

  select value into v_override from settings where key = 'clock.override_at';
  if v_override is null or jsonb_typeof(v_override) <> 'object' then
    return now();
  end if;

  if coalesce((v_override ->> 'frozen')::boolean, true) then
    return (v_override ->> 'at')::timestamptz;
  end if;

  return (v_override ->> 'at')::timestamptz + (now() - (v_override ->> 'set_at')::timestamptz);
end
$$;

-- Business date in Africa/Monrovia (D-06: UTC+0, no daylight saving).
create or replace function public.business_today()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (app_now() at time zone 'Africa/Monrovia')::date;
$$;

alter table public.settings alter column updated_at set default public.app_now();
