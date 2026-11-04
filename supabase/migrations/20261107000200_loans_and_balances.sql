-- M3.2: money helpers (SPEC 5.2), loans (SPEC 7.3), balances derived from the ledger (SPEC 6.2, 7.7;
-- CLAUDE.md rule 3) and the read-only loan preview (SPEC 5.1, 8: preview_loan_terms). All money
-- is integer cents and all rates integer basis points; the helpers match tools/vectors.py.

-- round_half_up(n, d) = (2n + d) / (2d), integer division, for n >= 0 and d > 0 (SPEC 5.2).
create or replace function public.round_half_up(p_n bigint, p_d bigint)
returns bigint
language plpgsql
immutable
strict
set search_path = public
as $$
begin
  if p_n < 0 or p_d <= 0 then
    raise exception 'INVALID_STATE: round_half_up needs n >= 0 and d > 0' using errcode = '22023';
  end if;
  return (2 * p_n + p_d) / (2 * p_d);
end
$$;

-- pct(amount, bps) = round_half_up(amount * bps, 10000) (SPEC 5.2).
create or replace function public.pct(p_amount_cents bigint, p_bps int)
returns bigint
language sql
immutable
strict
set search_path = public
as $$ select round_half_up(p_amount_cents * p_bps, 10000) $$;

-- Calendar months, clamped to the month end: 31 Jan + 1 month = 28 Feb (A-02, T-02).
create or replace function public.add_months_clamped(p_date date, p_months int)
returns date
language sql
immutable
strict
set search_path = public
as $$ select (p_date + make_interval(months => p_months))::date $$;

-- Flat interest: pct(principal, rate) per month, times the term (A-03, T-01).
create or replace function public.flat_interest(p_principal_cents bigint, p_rate_bps int, p_term_months int)
returns bigint
language sql
immutable
strict
set search_path = public
as $$ select pct(p_principal_cents, p_rate_bps) * p_term_months $$;

revoke execute on function public.round_half_up(bigint, bigint), public.pct(bigint, int),
  public.add_months_clamped(date, int), public.flat_interest(bigint, int, int)
  from public, anon, authenticated, service_role;

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  loan_no text not null unique,
  customer_id uuid not null references public.customers (id),
  product_id uuid not null references public.loan_products (id),
  branch_id uuid not null references public.branches (id),
  officer_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  principal_cents bigint not null check (principal_cents > 0),
  currency text not null default 'USD',
  term_months int not null check (term_months between 1 and 36),
  purpose text check (length(purpose) <= 300),
  -- Snapshot of the product and rules, taken when the loan is submitted (SPEC 7.3).
  interest_rate_bps int check (interest_rate_bps between 1 and 10000),
  interest_cents bigint check (interest_cents >= 0),
  penalty_rate_bps int check (penalty_rate_bps between 0 and 10000),
  penalty_period_days int check (penalty_period_days between 1 and 90),
  penalty_base text check (penalty_base in ('outstanding_total', 'original_due')),
  penalty_max_periods int check (penalty_max_periods between 0 and 52),
  recovery_after_days int check (recovery_after_days between 1 and 365),
  collateral_required boolean,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected',
    'cancelled', 'active', 'overdue', 'recovery', 'closed', 'written_off')),
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  disbursed_on date,
  disbursed_by uuid references public.profiles (id),
  disbursement_method text check (disbursement_method in ('cash', 'mobile_money', 'bank')),
  disbursement_account_id uuid references public.accounts (id),
  due_date date,
  due_date_version int not null default 1 check (due_date_version >= 1),
  recovery_eligible boolean not null default false,
  parent_loan_id uuid references public.loans (id),
  closed_on date,
  created_at timestamptz not null default public.app_now(),
  updated_at timestamptz not null default public.app_now(),
  constraint loan_snapshot_complete check (
    status in ('draft', 'cancelled') or (interest_rate_bps is not null and interest_cents is not null
      and penalty_rate_bps is not null and penalty_period_days is not null and penalty_base is not null
      and penalty_max_periods is not null and recovery_after_days is not null and collateral_required is not null)),
  constraint loan_disbursement_complete check (
    status in ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled')
    or (disbursed_on is not null and due_date is not null and disbursed_by is not null
        and disbursement_method is not null and disbursement_account_id is not null))
);

comment on table public.loans is 'Loans (SPEC 7.3). No balance columns: balances come from journal_lines (loan_balances).';

create index loans_customer_idx on public.loans (customer_id);
create index loans_status_due_idx on public.loans (status, due_date);
create index loans_branch_idx on public.loans (branch_id);
create index loans_officer_idx on public.loans (officer_id);
create index loans_product_idx on public.loans (product_id);
create index loans_created_by_idx on public.loans (created_by);
create index loans_approved_by_idx on public.loans (approved_by) where approved_by is not null;
create index loans_disbursed_by_idx on public.loans (disbursed_by) where disbursed_by is not null;
create index loans_disbursement_account_idx on public.loans (disbursement_account_id) where disbursement_account_id is not null;
create index loans_parent_idx on public.loans (parent_loan_id) where parent_loan_id is not null;

alter table public.loans enable row level security;
create policy loans_read on public.loans for select to authenticated using ((select public.is_staff()));
revoke all on public.loans from anon;
revoke insert, update, delete, truncate, references, trigger on public.loans from authenticated, service_role;

-- Ledger links promised in M1.1 and M2.5, now that loans exist.
alter table public.journal_lines add constraint journal_lines_loan_fk foreign key (loan_id) references public.loans (id);
alter table public.journal_lines add constraint journal_lines_customer_fk foreign key (customer_id) references public.customers (id);
create index if not exists journal_lines_customer_idx on public.journal_lines (customer_id) where customer_id is not null;
alter table public.guarantors add constraint guarantors_loan_fk foreign key (loan_id) references public.loans (id);

-- Balances per loan and component, from the ledger only (SPEC 6.2). journal_lines is readable by
-- finance roles only (T-31), so the per-loan totals are exposed to all staff through this function
-- and the views below; no line, account or journal detail leaves it.
create or replace function public.loan_balance_rows()
returns table (
  loan_id uuid,
  principal_out bigint,
  interest_out bigint,
  penalty_out bigint,
  total_out bigint,
  last_payment_on date,
  days_overdue int,
  next_penalty_on date
)
language sql
stable
security definer
set search_path = public
as $$
  with sums as (
    select l.loan_id,
           coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'principal'), 0)::bigint as principal_out,
           coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'interest'), 0)::bigint as interest_out,
           coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'penalty'), 0)::bigint as penalty_out
      from journal_lines l
     where l.loan_id is not null
     group by l.loan_id
  )
  select ln.id,
         coalesce(s.principal_out, 0), coalesce(s.interest_out, 0), coalesce(s.penalty_out, 0),
         coalesce(s.principal_out + s.interest_out + s.penalty_out, 0),
         null::date,                     -- from payments (M4)
         case when ln.status in ('active', 'overdue', 'recovery') and ln.due_date is not null
              then greatest(0, business_today() - ln.due_date) else 0 end,
         null::date                      -- from penalty events (M5)
    from loans ln
    left join sums s on s.loan_id = ln.id
   where is_staff()
$$;

revoke execute on function public.loan_balance_rows() from public, anon, service_role;
grant execute on function public.loan_balance_rows() to authenticated;

create view public.loan_balances with (security_invoker = true) as
  select * from public.loan_balance_rows();

create view public.customer_balances with (security_invoker = true) as
  select ln.customer_id,
         coalesce(sum(b.total_out), 0)::bigint as total_out,
         count(*) filter (where ln.status in ('active', 'overdue', 'recovery'))::int as loans_active,
         count(*) filter (where ln.status in ('overdue', 'recovery'))::int as loans_overdue
    from public.loans ln
    join public.loan_balance_rows() b on b.loan_id = ln.id
   group by ln.customer_id;

revoke all on public.loan_balances, public.customer_balances from anon, service_role;
grant select on public.loan_balances, public.customer_balances to authenticated;

-- preview_loan_terms (SPEC 5.1, 8): read-only, the same helpers submission and disbursement use.
create or replace function public.preview_loan_terms(
  p_principal_cents bigint, p_product_id uuid, p_term_months int, p_disbursed_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_product loan_products;
  v_on date := coalesce(p_disbursed_on, business_today());
  v_interest bigint;
  v_total bigint;
  v_due date;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_product from loan_products where id = p_product_id and active;
  if not found then
    raise exception 'INVALID_STATE: choose an active loan product' using errcode = '22023';
  end if;
  if p_principal_cents is null or p_principal_cents <= 0 then
    raise exception 'INVALID_STATE: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_term_months is null or p_term_months < 1 or p_term_months > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term must be 1 to % months', v_product.max_term_months using errcode = '22023';
  end if;
  v_interest := flat_interest(p_principal_cents, v_product.interest_rate_bps, p_term_months);
  v_total := p_principal_cents + v_interest;
  v_due := add_months_clamped(v_on, p_term_months);
  return jsonb_build_object(
    'principal_cents', p_principal_cents,
    'interest_rate_bps', v_product.interest_rate_bps,
    'term_months', p_term_months,
    'interest_cents', v_interest,
    'total_due_cents', v_total,
    'disbursed_on', v_on,
    'due_date', v_due,
    'penalty_rate_bps', v_product.penalty_rate_bps,
    'penalty_period_days', v_product.penalty_period_days,
    'penalty_base', v_product.penalty_base,
    'penalty_max_periods', v_product.penalty_max_periods,
    'first_penalty_on', case when v_product.penalty_max_periods > 0
                             then v_due + v_product.penalty_period_days end,
    'first_penalty_cents', case when v_product.penalty_max_periods > 0
                                then pct(v_total, v_product.penalty_rate_bps) end,
    'recovery_after_days', v_product.recovery_after_days);
end
$$;

revoke execute on function public.preview_loan_terms(bigint, uuid, int, date) from public, anon, service_role;
grant execute on function public.preview_loan_terms(bigint, uuid, int, date) to authenticated;
