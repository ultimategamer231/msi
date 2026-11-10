-- M1.2 Ledger core: document numbers, period locks and post_journal.
-- SPEC 6.3 (next_number, post_journal), 5.10 (period locks), 7.5, FR-21, FR-27;
-- QUESTIONS B-02 (global loan counter, sequence start values) and B-03 (6-digit EXP); test T-22.

-- Day-close date locks, one row per branch (SPEC 5.10). Written by the day-close RPCs (M8).
create table public.period_locks (
  branch_id uuid primary key references public.branches (id),
  locked_through date not null,
  locked_by uuid references public.profiles (id),
  locked_at timestamptz not null default public.app_now()
);

comment on table public.period_locks is 'Last closed business date per branch (SPEC 5.10). post_journal refuses dates on or before it.';

alter table public.period_locks enable row level security;
create policy period_locks_read on public.period_locks
  for select to authenticated using ((select public.is_staff()));
revoke all on public.period_locks from anon;
revoke insert, update, delete, truncate, references, trigger on public.period_locks from authenticated, service_role;

-- Sentinel branch id for global counters (SPEC 6.3: a NULL branch would defeat the primary key).
create or replace function public.global_sequence_branch()
returns uuid
language sql
immutable
set search_path = public
as $$
  select '00000000-0000-0000-0000-000000000000'::uuid;
$$;

-- Which counter a document kind uses. Loans count globally with a branch prefix (B-02).
create or replace function public.sequence_scope(p_kind text, p_branch uuid)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p_kind in ('loan', 'journal', 'customer', 'collateral') or p_branch is null
              then global_sequence_branch() else p_branch end;
$$;

-- SPEC 6.3 invariant 4, with B-02 (global loan counter) and B-03 (EXP has 6 digits). Gapless: the
-- counter row is locked by the update and rolls back with the caller's transaction.
create or replace function public.next_number(p_kind text, p_branch uuid default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  n bigint;
  code text;
  scope uuid := sequence_scope(p_kind, p_branch);
begin
  insert into document_sequences (kind, branch_id, last_value) values (p_kind, scope, 0)
  on conflict (kind, branch_id) do nothing;
  update document_sequences set last_value = last_value + 1
   where kind = p_kind and branch_id = scope
  returning last_value into n;
  select coalesce((select br.code from branches br where br.id = p_branch), 'HQ') into code;
  return case p_kind
    when 'receipt'    then format('RCT-%s-%s', code, lpad(n::text, 6, '0'))
    when 'loan'       then format('LN-%s-%s', code, lpad(n::text, 5, '0'))
    when 'journal'    then format('JV-%s', lpad(n::text, 7, '0'))
    when 'customer'   then format('CU-%s', lpad(n::text, 6, '0'))
    when 'collateral' then format('COL-%s', lpad(n::text, 6, '0'))
    when 'expense'    then format('EXP-%s-%s', code, lpad(n::text, 6, '0'))
    else format('%s-%s', upper(p_kind), n)
  end;
end
$$;

-- B-02 / FR-27: before go-live the admin may set where a counter continues, so numbering carries on
-- from MSI's paper records. A counter can never move backwards (numbers are never reused).
create or replace function public.set_sequence_start(p_kind text, p_branch_id uuid, p_last_value bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_go_live date;
  v_scope uuid := sequence_scope(p_kind, p_branch_id);
  v_current bigint;
begin
  perform require_role('admin');

  if p_kind not in ('receipt', 'loan', 'journal', 'customer', 'collateral', 'expense') then
    raise exception 'INVALID_STATE: unknown document kind %', p_kind using errcode = '22023';
  end if;
  if p_last_value is null or p_last_value < 0 then
    raise exception 'INVALID_STATE: the starting number must be zero or more' using errcode = '22023';
  end if;
  if p_branch_id is not null and not exists (select 1 from branches where id = p_branch_id) then
    raise exception 'INVALID_STATE: the branch does not exist' using errcode = 'P0002';
  end if;

  select (value #>> '{}')::date into v_go_live from settings where key = 'migration.go_live_date';
  if v_go_live is not null and business_today() >= v_go_live then
    raise exception 'DATE_NOT_ALLOWED: numbering can only be set before the go-live date' using errcode = '42501';
  end if;

  insert into document_sequences (kind, branch_id, last_value) values (p_kind, v_scope, 0)
  on conflict (kind, branch_id) do nothing;
  select last_value into v_current from document_sequences where kind = p_kind and branch_id = v_scope for update;
  if p_last_value < v_current then
    raise exception 'INVALID_STATE: the counter is already at %, numbers cannot be reused', v_current
      using errcode = '22023';
  end if;

  update document_sequences set last_value = p_last_value where kind = p_kind and branch_id = v_scope;
  perform write_audit('sequence.started', 'document_sequence', p_kind || ':' || v_scope::text,
    jsonb_build_object('last_value', v_current), jsonb_build_object('last_value', p_last_value));
end
$$;

-- The receivable component each loan account carries (loan balances sum by component, SPEC 6.2).
create or replace function public.account_component(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_code when '1100' then 'principal' when '1110' then 'interest' when '1120' then 'penalty' end;
$$;

-- The only function that writes journals (SPEC 6.3). Internal: the posting recipes call it.
-- p_lines: [{"account": "1010-BR2", "debit_cents": 50000, "credit_cents": 0, "loan_id": …,
--            "customer_id": …, "payee_id": …, "staff_id": …, "component": …, "currency": "USD"}, …]
create or replace function public.post_journal(
  p_date date,
  p_memo text,
  p_source_type text,
  p_source_id uuid,
  p_branch uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_no text;
  v_line jsonb;
  v_index int := 0;
  v_account public.accounts;
  v_debit bigint;
  v_credit bigint;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_currency text;
  v_base_currency text;
  v_component text;
  v_branches uuid[] := array_remove(array[p_branch], null);
  v_canonical jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
begin
  if p_date is null or p_memo is null or btrim(p_memo) = '' or p_source_type is null then
    raise exception 'INVALID_STATE: a journal needs a date, a memo and a source' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'JOURNAL_UNBALANCED: a journal needs at least two lines' using errcode = '23514';
  end if;

  select value #>> '{}' into v_base_currency from settings where key = 'currency.base';

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;

    select * into v_account from accounts where code = v_line ->> 'account';
    if not found or not v_account.active then
      raise exception 'INVALID_STATE: account % does not exist or is inactive', v_line ->> 'account' using errcode = '22023';
    end if;

    if not (jsonb_is_whole_number(coalesce(v_line -> 'debit_cents', '0'))
            and jsonb_is_whole_number(coalesce(v_line -> 'credit_cents', '0'))) then
      raise exception 'INVALID_STATE: amounts must be whole cents' using errcode = '22023';
    end if;
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'JOURNAL_UNBALANCED: each line is either a debit or a credit' using errcode = '23514';
    end if;

    v_currency := coalesce(v_line ->> 'currency', v_base_currency);
    if v_currency is distinct from v_base_currency then
      raise exception 'INVALID_STATE: all lines must be in %', v_base_currency using errcode = '22023';
    end if;

    -- Loan receivables must name the loan and the matching component (loan_balances depends on it).
    v_component := v_line ->> 'component';
    if account_component(v_account.code) is not null then
      if v_line ->> 'loan_id' is null or v_component is distinct from account_component(v_account.code) then
        raise exception 'INVALID_STATE: account % needs a loan and component %', v_account.code,
          account_component(v_account.code) using errcode = '22023';
      end if;
    elsif v_component is not null then
      raise exception 'INVALID_STATE: only loan receivable accounts carry a component' using errcode = '22023';
    end if;

    if v_account.branch_id is not null and not (v_account.branch_id = any (v_branches)) then
      v_branches := v_branches || v_account.branch_id;
    end if;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;

    -- Same shape and types as journal_lines_canonical(), so the stored rows hash identically.
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_array(
      v_index, v_account.code, v_debit, v_credit, v_currency, 1000000::bigint,
      (v_line ->> 'loan_id')::uuid, (v_line ->> 'customer_id')::uuid, (v_line ->> 'payee_id')::uuid,
      (v_line ->> 'staff_id')::uuid, v_component));
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'line_no', v_index, 'account_id', v_account.id, 'debit', v_debit, 'credit', v_credit,
      'currency', v_currency, 'loan_id', v_line ->> 'loan_id', 'customer_id', v_line ->> 'customer_id',
      'payee_id', v_line ->> 'payee_id', 'staff_id', v_line ->> 'staff_id', 'component', v_component));
  end loop;

  if v_total_debit <> v_total_credit or v_total_debit = 0 then
    raise exception 'JOURNAL_UNBALANCED: debits % credits %', v_total_debit, v_total_credit using errcode = '23514';
  end if;

  -- SPEC 5.10: no posting on or before a branch's locked date.
  if exists (select 1 from period_locks where branch_id = any (v_branches) and locked_through >= p_date) then
    raise exception 'PERIOD_LOCKED: % is closed for this branch', p_date using errcode = '42501';
  end if;

  v_no := next_number('journal', null);

  insert into journals (id, journal_no, entry_date, memo, source_type, source_id, branch_id, posted_by, content_hash)
  values (v_id, v_no, p_date, btrim(p_memo), p_source_type, p_source_id, p_branch, auth.uid(),
          journal_content_digest(v_no, p_date, btrim(p_memo), p_source_type, p_source_id, p_branch, null, v_canonical));

  insert into journal_lines (journal_id, line_no, account_id, debit_cents, credit_cents, currency, loan_id,
                             customer_id, payee_id, staff_id, component)
  select v_id, (r ->> 'line_no')::int, (r ->> 'account_id')::uuid, (r ->> 'debit')::bigint, (r ->> 'credit')::bigint,
         r ->> 'currency', (r ->> 'loan_id')::uuid, (r ->> 'customer_id')::uuid, (r ->> 'payee_id')::uuid,
         (r ->> 'staff_id')::uuid, r ->> 'component'
    from jsonb_array_elements(v_rows) r;

  perform write_audit('journal.posted', 'journal', v_id::text, null,
    jsonb_build_object('journal_no', v_no, 'entry_date', p_date, 'memo', btrim(p_memo), 'source_type', p_source_type,
                       'source_id', p_source_id, 'total_cents', v_total_debit));
  return v_id;
end
$$;

revoke execute on function public.global_sequence_branch() from public, anon, authenticated, service_role;
revoke execute on function public.sequence_scope(text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.next_number(text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.account_component(text) from public, anon, authenticated, service_role;
revoke execute on function public.post_journal(date, text, text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.set_sequence_start(text, uuid, bigint) from public, anon, service_role;
grant execute on function public.set_sequence_start(text, uuid, bigint) to authenticated;
