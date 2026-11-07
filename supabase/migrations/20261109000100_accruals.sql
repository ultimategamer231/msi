-- M5.1: daily accruals (SPEC 5.2, 5.5; FR-12; A-06, A-08; B-15). Penalties are charged per
-- 7-day mark after the due date (product snapshot on the loan), at most penalty_max_periods times,
-- never twice for the same (loan, due date version, period). The amount does not depend on when the
-- job runs: each penalty's base is read as of its charge date (the late-run rule).

create table public.loan_penalty_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id),
  due_date_version int not null check (due_date_version >= 1),
  period_no int not null check (period_no >= 1),
  base_cents bigint not null check (base_cents > 0),
  penalty_cents bigint not null check (penalty_cents > 0),
  charged_on date not null,          -- the charge date due_date + k * period_days, not the run date
  journal_id uuid not null references public.journals (id),
  run_id uuid,
  created_at timestamptz not null default public.app_now(),
  unique (loan_id, due_date_version, period_no)
);

comment on table public.loan_penalty_events is 'One row per penalty charged (SPEC 7.3); the unique key makes accrual reruns safe (T-07).';

create index loan_penalty_events_journal_idx on public.loan_penalty_events (journal_id);
create index loan_penalty_events_charged_idx on public.loan_penalty_events (loan_id, charged_on);

create trigger loan_penalty_events_immutable
  before update or delete on public.loan_penalty_events
  for each row execute function public.trg_immutable();

create table public.accrual_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  overdue_marked int not null default 0,
  penalties_posted int not null default 0,
  penalty_cents bigint not null default 0,
  recovery_flagged int not null default 0,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  triggered_by uuid references public.profiles (id),
  source text not null check (source in ('manual', 'cron'))
);

comment on table public.accrual_runs is 'Log of daily accrual runs (SPEC 5.5 step 4).';

create index accrual_runs_date_idx on public.accrual_runs (run_date desc, started_at desc);
create index accrual_runs_triggered_by_idx on public.accrual_runs (triggered_by) where triggered_by is not null;
alter table public.loan_penalty_events
  add constraint loan_penalty_events_run_fk foreign key (run_id) references public.accrual_runs (id) deferrable initially deferred;
create index loan_penalty_events_run_idx on public.loan_penalty_events (run_id) where run_id is not null;

create trigger accrual_runs_immutable
  before update or delete on public.accrual_runs
  for each row execute function public.trg_immutable();

alter table public.loan_penalty_events enable row level security;
alter table public.accrual_runs enable row level security;
create policy loan_penalty_events_read on public.loan_penalty_events
  for select to authenticated using ((select public.is_staff()));
create policy accrual_runs_read on public.accrual_runs
  for select to authenticated using ((select public.is_staff()));
revoke all on public.loan_penalty_events, public.accrual_runs from anon;
revoke insert, update, delete, truncate, references, trigger on public.loan_penalty_events, public.accrual_runs
  from authenticated, service_role;

-- loan_outstanding_as_of (SPEC 8; B-15): what the loan owed at the end of p_date. Ledger lines dated
-- up to that day, except penalty journals (dated the day the job ran), plus the penalties whose
-- charge date is on or before that day. Read-only; used by the accrual job.
create or replace function public.loan_outstanding_as_of(p_loan_id uuid, p_date date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (select coalesce(sum(l.debit_cents - l.credit_cents), 0)
            from journal_lines l join journals j on j.id = l.journal_id
           where l.loan_id = p_loan_id and l.component is not null
             and j.entry_date <= p_date and j.source_type <> 'penalty')
       + (select coalesce(sum(e.penalty_cents), 0)
            from loan_penalty_events e
           where e.loan_id = p_loan_id and e.charged_on <= p_date)
$$;

-- Penalties due on one loan up to p_as_of (SPEC 5.5 step 2). The caller holds the loan row lock.
create or replace function public.accrue_loan_penalties(p_loan_id uuid, p_as_of date, p_run_id uuid)
returns table (posted int, posted_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_charge_on date;
  v_base bigint;
  v_penalty bigint;
  v_event uuid;
  v_journal uuid;
begin
  posted := 0;
  posted_cents := 0;
  select * into v_loan from loans where id = p_loan_id;
  if v_loan.status not in ('active', 'overdue') or v_loan.due_date is null then
    return next;
    return;
  end if;
  for v_k in 1 .. v_loan.penalty_max_periods loop
    v_charge_on := v_loan.due_date + v_k * v_loan.penalty_period_days;
    exit when v_charge_on > p_as_of;                                         -- T-04: day >= k * period
    continue when exists (select 1 from loan_penalty_events
                           where loan_id = v_loan.id and due_date_version = v_loan.due_date_version
                             and period_no = v_k);                          -- T-07: reruns post nothing
    v_base := case v_loan.penalty_base
                when 'original_due' then v_loan.principal_cents + v_loan.interest_cents   -- T-08
                else loan_outstanding_as_of(v_loan.id, v_charge_on) end;               -- T-03, T-33
    continue when v_base <= 0;                                               -- nothing was owed that day
    v_penalty := pct(v_base, v_loan.penalty_rate_bps);
    continue when v_penalty <= 0;
    v_event := gen_random_uuid();
    v_journal := post_journal(business_today(),
      format('Penalty %s of %s on %s', v_k, v_loan.penalty_max_periods, v_loan.loan_no),
      'penalty', v_event, v_loan.branch_id,
      jsonb_build_array(
        jsonb_build_object('account', '1120', 'debit_cents', v_penalty, 'loan_id', v_loan.id,
                           'customer_id', v_loan.customer_id, 'component', 'penalty'),
        jsonb_build_object('account', '4010', 'credit_cents', v_penalty)));      -- R4
    insert into loan_penalty_events (id, loan_id, due_date_version, period_no, base_cents, penalty_cents,
                                     charged_on, journal_id, run_id)
    values (v_event, v_loan.id, v_loan.due_date_version, v_k, v_base, v_penalty, v_charge_on, v_journal, p_run_id);
    perform write_audit('loan.penalty_charged', 'loan', v_loan.id::text, null,
      jsonb_build_object('period_no', v_k, 'due_date_version', v_loan.due_date_version, 'base_cents', v_base,
                         'penalty_cents', v_penalty, 'charged_on', v_charge_on, 'journal_id', v_journal));
    posted := posted + 1;
    posted_cents := posted_cents + v_penalty;
  end loop;
  return next;
end
$$;

-- The job itself (SPEC 5.5). One run at a time; every step is idempotent.
create or replace function public.accruals_run(p_as_of date, p_triggered_by uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz := app_now();             -- business clock, like every other record (B-01)
  v_clock timestamptz := clock_timestamp();        -- the real duration is kept on top of it
  v_run uuid := gen_random_uuid();
  v_loan loans;
  v_owed bigint;
  v_marked int := 0;
  v_flagged int := 0;
  v_posted int := 0;
  v_cents bigint := 0;
  v_result record;
begin
  if p_as_of is null or p_as_of > business_today() then
    raise exception 'DATE_NOT_ALLOWED: accruals run for today or an earlier day' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.accruals_run'));

  for v_loan in select * from loans
                 where status in ('active', 'overdue') and due_date is not null and due_date < p_as_of
                 order by loan_no for update loop
    select penalty_cents + interest_cents + principal_cents into v_owed from loan_owed(v_loan.id);
    continue when v_owed <= 0;

    -- 1. Past due with money owed: overdue (SPEC 5.3).
    if v_loan.status = 'active' then
      update loans set status = 'overdue', updated_at = app_now() where id = v_loan.id;
      perform write_audit('loan.overdue', 'loan', v_loan.id::text, jsonb_build_object('status', 'active'),
                          jsonb_build_object('status', 'overdue', 'as_of', p_as_of, 'due_date', v_loan.due_date));
      v_marked := v_marked + 1;
    end if;

    -- 2. Penalties by the late-run rule (no open recovery case: status recovery is never selected).
    select * into v_result from accrue_loan_penalties(v_loan.id, p_as_of, v_run);
    v_posted := v_posted + v_result.posted;
    v_cents := v_cents + v_result.posted_cents;

    -- 3. Recovery eligibility (A-08).
    if not v_loan.recovery_eligible and p_as_of - v_loan.due_date >= v_loan.recovery_after_days then
      update loans set recovery_eligible = true, updated_at = app_now() where id = v_loan.id;
      perform write_audit('loan.recovery_eligible', 'loan', v_loan.id::text, null,
                          jsonb_build_object('as_of', p_as_of, 'days_overdue', p_as_of - v_loan.due_date));
      v_flagged := v_flagged + 1;
    end if;
  end loop;

  -- 4. The run log.
  insert into accrual_runs (id, run_date, overdue_marked, penalties_posted, penalty_cents, recovery_flagged,
                            started_at, finished_at, triggered_by, source)
  values (v_run, p_as_of, v_marked, v_posted, v_cents, v_flagged, v_started, v_started + (clock_timestamp() - v_clock), p_triggered_by,
          p_source);
  perform write_audit('accruals.run', 'accrual_run', v_run::text, null,
    jsonb_build_object('run_date', p_as_of, 'source', p_source, 'overdue_marked', v_marked,
                       'penalties_posted', v_posted, 'penalty_cents', v_cents, 'recovery_flagged', v_flagged));
  return jsonb_build_object('run_id', v_run, 'run_date', p_as_of, 'overdue_marked', v_marked,
                            'penalties_posted', v_posted, 'penalty_cents', v_cents, 'recovery_flagged', v_flagged);
end
$$;

-- run_daily_accruals (SPEC 8; D-11): the manual run, by a manager or the admin. Idempotent (T-07).
create or replace function public.run_daily_accruals(p_as_of date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_role('manager', 'admin');
  return accruals_run(coalesce(p_as_of, business_today()), auth.uid(), 'manual');
end
$$;

revoke execute on function public.loan_outstanding_as_of(uuid, date),
  public.accrue_loan_penalties(uuid, date, uuid),
  public.accruals_run(date, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.run_daily_accruals(date) from public, anon, service_role;
grant execute on function public.run_daily_accruals(date) to authenticated;

-- Balances (SPEC 7.7): last payment and next penalty dates now that both exist; days overdue only
-- while money is owed.
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
  ),
  paid as (
    select loan_id, max(received_on) as last_on from payments where status = 'posted' group by loan_id
  ),
  charged as (
    select e.loan_id, e.due_date_version, count(*)::int as periods
      from loan_penalty_events e group by e.loan_id, e.due_date_version
  )
  select ln.id,
         coalesce(s.principal_out, 0), coalesce(s.interest_out, 0), coalesce(s.penalty_out, 0),
         coalesce(s.principal_out + s.interest_out + s.penalty_out, 0),
         p.last_on,
         case when ln.status in ('active', 'overdue', 'recovery') and ln.due_date is not null
                   and coalesce(s.principal_out + s.interest_out + s.penalty_out, 0) > 0
              then greatest(0, business_today() - ln.due_date) else 0 end,
         case when ln.status in ('active', 'overdue') and ln.due_date is not null
                   and coalesce(s.principal_out + s.interest_out + s.penalty_out, 0) > 0
                   and coalesce(c.periods, 0) < ln.penalty_max_periods
              then ln.due_date + (coalesce(c.periods, 0) + 1) * ln.penalty_period_days end
    from loans ln
    left join sums s on s.loan_id = ln.id
    left join paid p on p.loan_id = ln.id
    left join charged c on c.loan_id = ln.id and c.due_date_version = ln.due_date_version
   where is_staff()
$$;

revoke execute on function public.loan_balance_rows() from public, anon, service_role;
grant execute on function public.loan_balance_rows() to authenticated;
