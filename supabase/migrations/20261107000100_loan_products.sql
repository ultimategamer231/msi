-- M3.1: loan products as configuration (SPEC 7.1; FR-06; CLAUDE.md rule 6). Loans copy the
-- product's rules when they are submitted, so changing a product never changes an existing loan.

create table public.loan_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  interest_rate_bps int not null check (interest_rate_bps between 1 and 10000),
  rate_period text not null default 'month' check (rate_period in ('month')),
  interest_method text not null default 'flat' check (interest_method in ('flat')),
  default_term_months int not null check (default_term_months between 1 and 36),
  max_term_months int not null check (max_term_months between 1 and 36),
  penalty_rate_bps int not null check (penalty_rate_bps between 0 and 10000),
  penalty_period_days int not null check (penalty_period_days between 1 and 90),
  penalty_base text not null default 'outstanding_total' check (penalty_base in ('outstanding_total', 'original_due')),
  penalty_max_periods int not null check (penalty_max_periods between 0 and 52),
  recovery_after_days int not null check (recovery_after_days between 1 and 365),
  active boolean not null default true,
  created_at timestamptz not null default public.app_now(),
  updated_at timestamptz not null default public.app_now(),
  updated_by uuid references public.profiles (id),
  constraint loan_product_terms check (default_term_months <= max_term_months)
);

comment on table public.loan_products is 'Loan products (SPEC 7.1, FR-06). Rules are copied onto each loan at submission.';

create index loan_products_updated_by_idx on public.loan_products (updated_by);

alter table public.loan_products enable row level security;
create policy loan_products_read on public.loan_products
  for select to authenticated using ((select public.is_staff()));
revoke all on public.loan_products from anon;
revoke insert, update, delete, truncate, references, trigger on public.loan_products from authenticated, service_role;

-- upsert_loan_product (SPEC 4: admin manages products). Input: the product columns, plus "id" to
-- change an existing product. Every change is audited with before and after.
create or replace function public.upsert_loan_product(p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_before loan_products;
  v_row loan_products;
  v_key text;
begin
  perform require_role('admin');
  foreach v_key in array array['interest_rate_bps', 'default_term_months', 'max_term_months', 'penalty_rate_bps',
                               'penalty_period_days', 'penalty_max_periods', 'recovery_after_days'] loop
    if p_product ? v_key and (jsonb_typeof(p_product -> v_key) <> 'number' or (p_product ->> v_key) !~ '^[0-9]+$') then
      raise exception 'INVALID_STATE: % must be a whole number', v_key using errcode = '22023';
    end if;
  end loop;

  if v_id is not null then
    select * into v_before from loan_products where id = v_id for update;
    if not found then
      raise exception 'INVALID_STATE: the product does not exist' using errcode = 'P0002';
    end if;
  end if;
  if v_before.id is null then
    v_row := jsonb_populate_record(null::loan_products, jsonb_build_object(
      'id', gen_random_uuid(), 'rate_period', 'month', 'interest_method', 'flat',
      'penalty_base', 'outstanding_total', 'active', true)
      || (p_product - 'id' - 'created_at' - 'updated_at' - 'updated_by'));
  else
    v_row := jsonb_populate_record(v_before, p_product - 'id' - 'created_at' - 'updated_at' - 'updated_by');
  end if;
  v_row.name := btrim(coalesce(v_row.name, ''));

  begin
    if v_before.id is null then
      insert into loan_products (id, name, interest_rate_bps, rate_period, interest_method, default_term_months,
                                 max_term_months, penalty_rate_bps, penalty_period_days, penalty_base,
                                 penalty_max_periods, recovery_after_days, active, updated_by)
      values (v_row.id, v_row.name, v_row.interest_rate_bps, v_row.rate_period, v_row.interest_method,
              v_row.default_term_months, v_row.max_term_months, v_row.penalty_rate_bps, v_row.penalty_period_days,
              v_row.penalty_base, v_row.penalty_max_periods, v_row.recovery_after_days, coalesce(v_row.active, true),
              auth.uid())
      returning * into v_row;
    else
      update loan_products set
        name = v_row.name, interest_rate_bps = v_row.interest_rate_bps, rate_period = v_row.rate_period,
        interest_method = v_row.interest_method, default_term_months = v_row.default_term_months,
        max_term_months = v_row.max_term_months, penalty_rate_bps = v_row.penalty_rate_bps,
        penalty_period_days = v_row.penalty_period_days, penalty_base = v_row.penalty_base,
        penalty_max_periods = v_row.penalty_max_periods, recovery_after_days = v_row.recovery_after_days,
        active = coalesce(v_row.active, true), updated_at = app_now(), updated_by = auth.uid()
      where id = v_before.id
      returning * into v_row;
    end if;
  exception
    when unique_violation then
      raise exception 'INVALID_STATE: another product already has this name' using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'INVALID_STATE: a product value is missing or out of range' using errcode = '22023';
  end;

  if v_before.id is null then
    perform write_audit('loan_product.created', 'loan_product', v_row.id::text, null,
                        to_jsonb(v_row) - 'created_at' - 'updated_at' - 'updated_by');
  elsif to_jsonb(v_before) - 'updated_at' - 'updated_by' is distinct from to_jsonb(v_row) - 'updated_at' - 'updated_by' then
    perform write_audit('loan_product.updated', 'loan_product', v_row.id::text,
                        to_jsonb(v_before) - 'created_at' - 'updated_at' - 'updated_by',
                        to_jsonb(v_row) - 'created_at' - 'updated_at' - 'updated_by');
  end if;
  return v_row.id;
end
$$;

revoke execute on function public.upsert_loan_product(jsonb) from public, anon, service_role;
grant execute on function public.upsert_loan_product(jsonb) to authenticated;
