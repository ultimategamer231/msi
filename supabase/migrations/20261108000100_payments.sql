-- M4.1: payments (SPEC 5.4, 7.3; FR-10; recipe R2): allocation in the configured order (A-05),
-- overpayment refused (T-10), reference rules (T-11), idempotency (T-12), entry dates (T-37).
-- Also: post_journal can now record which journal a new one reverses (R8, used by voids in M4.3).

-- post_journal with a reversal link (same checks; reversal_of is part of the content hash).
create or replace function public.post_journal(
  p_date date,
  p_memo text,
  p_source_type text,
  p_source_id uuid,
  p_branch uuid,
  p_lines jsonb,
  p_reversal_of uuid
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

  insert into journals (id, journal_no, entry_date, memo, source_type, source_id, branch_id, reversal_of, posted_by,
                        content_hash)
  values (v_id, v_no, p_date, btrim(p_memo), p_source_type, p_source_id, p_branch, p_reversal_of, auth.uid(),
          journal_content_digest(v_no, p_date, btrim(p_memo), p_source_type, p_source_id, p_branch, p_reversal_of,
                                 v_canonical));

  insert into journal_lines (journal_id, line_no, account_id, debit_cents, credit_cents, currency, loan_id,
                             customer_id, payee_id, staff_id, component)
  select v_id, (r ->> 'line_no')::int, (r ->> 'account_id')::uuid, (r ->> 'debit')::bigint, (r ->> 'credit')::bigint,
         r ->> 'currency', (r ->> 'loan_id')::uuid, (r ->> 'customer_id')::uuid, (r ->> 'payee_id')::uuid,
         (r ->> 'staff_id')::uuid, r ->> 'component'
    from jsonb_array_elements(v_rows) r;

  perform write_audit('journal.posted', 'journal', v_id::text, null,
    jsonb_build_object('journal_no', v_no, 'entry_date', p_date, 'memo', btrim(p_memo), 'source_type', p_source_type,
                       'source_id', p_source_id, 'total_cents', v_total_debit, 'reversal_of', p_reversal_of));
  return v_id;
end
$$;

revoke execute on function public.post_journal(date, text, text, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- The six-argument form keeps its contract and now delegates.
create or replace function public.post_journal(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_branch uuid, p_lines jsonb)
returns uuid
language sql
security definer
set search_path = public
as $$ select post_journal(p_date, p_memo, p_source_type, p_source_id, p_branch, p_lines, null::uuid) $$;

revoke execute on function public.post_journal(date, text, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  loan_id uuid not null references public.loans (id),
  customer_id uuid not null references public.customers (id),
  branch_id uuid not null references public.branches (id),
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'mobile_money', 'bank')),
  reference text check (length(reference) <= 100),
  received_on date not null,
  received_at timestamptz not null default public.app_now(),
  received_by uuid not null references public.profiles (id),
  collected_in_field boolean not null default false,
  remittance_status text not null default 'n/a' check (remittance_status in ('n/a', 'pending', 'confirmed')),
  remittance_confirmed_by uuid references public.profiles (id),
  remittance_confirmed_at timestamptz,
  remittance_journal_id uuid references public.journals (id),
  status text not null default 'posted' check (status in ('posted', 'voided')),
  source text not null default 'normal' check (source in ('normal', 'post_write_off_recovery')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  journal_id uuid not null references public.journals (id),
  voided_at timestamptz,
  void_journal_id uuid references public.journals (id),
  unique (received_by, idempotency_key),
  constraint payment_reference check (method = 'cash' or length(btrim(coalesce(reference, ''))) >= 4)
);

comment on table public.payments is 'Payments and their receipts (SPEC 7.3). Corrections are voids with a reversing journal.';

create index payments_loan_idx on public.payments (loan_id, received_on);
create index payments_customer_idx on public.payments (customer_id);
create index payments_branch_date_idx on public.payments (branch_id, received_on);
create index payments_received_by_idx on public.payments (received_by, received_on);
create index payments_remittance_idx on public.payments (remittance_status) where remittance_status = 'pending';
create index payments_journal_idx on public.payments (journal_id);
create index payments_remittance_confirmed_by_idx on public.payments (remittance_confirmed_by) where remittance_confirmed_by is not null;
create index payments_remittance_journal_idx on public.payments (remittance_journal_id) where remittance_journal_id is not null;
create index payments_void_journal_idx on public.payments (void_journal_id) where void_journal_id is not null;

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  component text not null check (component in ('penalty', 'interest', 'principal')),
  amount_cents bigint not null check (amount_cents > 0),
  unique (payment_id, component)
);

create trigger payment_allocations_immutable
  before update or delete on public.payment_allocations
  for each row execute function public.trg_immutable();

alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
create policy payments_read on public.payments for select to authenticated using ((select public.is_staff()));
create policy payment_allocations_read on public.payment_allocations for select to authenticated using ((select public.is_staff()));
revoke all on public.payments, public.payment_allocations from anon;
revoke insert, update, delete, truncate, references, trigger on public.payments, public.payment_allocations
  from authenticated, service_role;

-- What a loan owes now, by component, from the ledger.
create or replace function public.loan_owed(p_loan_id uuid)
returns table (penalty_cents bigint, interest_cents bigint, principal_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(debit_cents - credit_cents) filter (where component = 'penalty'), 0)::bigint,
         coalesce(sum(debit_cents - credit_cents) filter (where component = 'interest'), 0)::bigint,
         coalesce(sum(debit_cents - credit_cents) filter (where component = 'principal'), 0)::bigint
    from journal_lines where loan_id = p_loan_id
$$;

-- Splits an amount over the components in the configured order (A-05: penalty, interest,
-- principal). Each part is at most what that component owes; the caller refuses overpayment.
create or replace function public.allocate_amount(
  p_amount bigint, p_penalty bigint, p_interest bigint, p_principal bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order jsonb;
  v_left bigint := p_amount;
  v_owed jsonb := jsonb_build_object('penalty', p_penalty, 'interest', p_interest, 'principal', p_principal);
  v_result jsonb := jsonb_build_object('penalty', 0, 'interest', 0, 'principal', 0);
  v_component text;
  v_part bigint;
begin
  select value into v_order from settings where key = 'payments.allocation_order';
  for v_component in select jsonb_array_elements_text(coalesce(v_order, '["penalty", "interest", "principal"]')) loop
    v_part := least(v_left, greatest((v_owed ->> v_component)::bigint, 0));
    v_result := v_result || jsonb_build_object(v_component, v_part);
    v_left := v_left - v_part;
  end loop;
  return v_result || jsonb_build_object('unallocated', v_left);
end
$$;

revoke execute on function public.loan_owed(uuid), public.allocate_amount(bigint, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;

-- The common payment path for office (R2) and field (R3) payments. Returns the receipt facts.
create or replace function public.take_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_idempotency_key text, p_field boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing payments;
  v_loan loans;
  v_on date;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_owed record;
  v_split jsonb;
  v_account accounts;
  v_branch uuid;
  v_receipt text;
  v_payment uuid := gen_random_uuid();
  v_journal uuid;
  v_lines jsonb;
  v_component text;
  v_after bigint;
  v_remittance text := 'n/a';
begin
  if length(v_key) < 8 or length(v_key) > 100 then
    raise exception 'INVALID_STATE: a payment needs a request key' using errcode = '22023';
  end if;
  -- T-12: the same key from the same person returns the original receipt and posts nothing.
  select * into v_existing from payments where received_by = auth.uid() and idempotency_key = v_key;
  if found then
    return receipt_facts(v_existing.id) || jsonb_build_object('replayed', true);
  end if;

  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: payments are taken only on a paid-out, open loan' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_STATE: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'mobile_money', 'bank') then
    raise exception 'INVALID_STATE: the method must be cash, mobile money or bank' using errcode = '22023';
  end if;
  -- T-11: mobile money and bank need the transaction reference (at least 4 characters).
  if p_method <> 'cash' and (v_reference is null or length(v_reference) < 4) then
    raise exception 'REFERENCE_REQUIRED: enter the transaction reference' using errcode = '22023';
  end if;
  if length(v_reference) > 100 then
    raise exception 'INVALID_STATE: the reference is too long' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_received_on);                                  -- T-37

  select * into v_owed from loan_owed(v_loan.id);
  if p_amount_cents > v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents then
    raise exception 'OVERPAYMENT: the amount is more than the % owed',
      v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents using errcode = '22023';   -- T-10
  end if;
  v_split := allocate_amount(p_amount_cents, v_owed.penalty_cents, v_owed.interest_cents, v_owed.principal_cents);

  -- Receipt and cash follow the receiver's branch; staff without a branch use the loan's (B-10).
  v_branch := coalesce(auth_branch(), v_loan.branch_id);
  if p_field and p_method = 'cash'
     and coalesce((select (value #>> '{}')::boolean from settings where key = 'field.require_remittance'), true) then
    select * into v_account from accounts where code = '1015' and active;     -- R3: field cash until handed over (A-12)
    v_remittance := 'pending';
  elsif p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = v_branch;
  elsif p_method = 'bank' then
    select * into v_account from accounts where code = '1020' and active;
  else
    select * into v_account from accounts where code = '1030' and active;
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;

  v_receipt := next_number('receipt', v_branch);
  v_lines := jsonb_build_array(jsonb_build_object(
    'account', v_account.code, 'debit_cents', p_amount_cents, 'customer_id', v_loan.customer_id)
    || case when v_account.code = '1015' then jsonb_build_object('staff_id', auth.uid()) else '{}'::jsonb end);
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    if (v_split ->> v_component)::bigint > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', case v_component when 'penalty' then '1120' when 'interest' then '1110' else '1100' end,
        'credit_cents', (v_split ->> v_component)::bigint, 'loan_id', v_loan.id,
        'customer_id', v_loan.customer_id, 'component', v_component));
    end if;
  end loop;
  v_journal := post_journal(v_on, 'Payment ' || v_receipt || ' on ' || v_loan.loan_no,
                            case when p_field then 'field_payment' else 'payment' end, v_payment, v_branch, v_lines);

  insert into payments (id, receipt_no, loan_id, customer_id, branch_id, amount_cents, method, reference, received_on,
                        received_by, collected_in_field, remittance_status, idempotency_key, journal_id)
  values (v_payment, v_receipt, v_loan.id, v_loan.customer_id, v_branch, p_amount_cents, p_method, v_reference, v_on,
          auth.uid(), p_field, v_remittance, v_key, v_journal);
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    if (v_split ->> v_component)::bigint > 0 then
      insert into payment_allocations (payment_id, component, amount_cents)
      values (v_payment, v_component, (v_split ->> v_component)::bigint);
    end if;
  end loop;

  -- Close the loan when nothing is owed (SPEC 5.3); collateral release is prompted, not automatic.
  select penalty_cents + interest_cents + principal_cents into v_after from loan_owed(v_loan.id);
  if v_after = 0 then
    update loans set status = 'closed', closed_on = v_on, updated_at = app_now() where id = v_loan.id;
    perform write_audit('loan.closed', 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
                        jsonb_build_object('status', 'closed', 'closed_on', v_on, 'payment_id', v_payment));
  end if;

  perform write_audit('payment.received', 'payment', v_payment::text, null,
    jsonb_build_object('receipt_no', v_receipt, 'loan_no', v_loan.loan_no, 'amount_cents', p_amount_cents,
                       'method', p_method, 'reference', v_reference, 'received_on', v_on, 'field', p_field,
                       'allocation', v_split - 'unallocated', 'balance_after', v_after));
  return receipt_facts(v_payment) || jsonb_build_object('replayed', false);
end
$$;

-- The facts printed on a receipt (SPEC 10.1), from the stored payment.
create or replace function public.receipt_facts(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payment_id', p.id, 'receipt_no', p.receipt_no, 'loan_id', p.loan_id, 'amount_cents', p.amount_cents,
    'method', p.method, 'received_on', p.received_on, 'status', p.status,
    'allocation', (select coalesce(jsonb_object_agg(a.component, a.amount_cents), '{}'::jsonb)
                     from payment_allocations a where a.payment_id = p.id),
    'loan_status', (select status from loans where id = p.loan_id))
    from payments p where p.id = p_payment_id
$$;

revoke execute on function public.take_payment(uuid, bigint, text, text, date, text, boolean),
  public.receipt_facts(uuid) from public, anon, authenticated, service_role;

-- receive_payment (SPEC 5.4.1, 8): cashier or manager at the office (R2). The accountant and the
-- admin may enter a back-dated payment from paper records before go-live only (A-19, FR-27);
-- after go-live their back-dated entry is refused with DATE_NOT_ALLOWED (T-37).
create or replace function public.receive_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('cashier', 'manager', 'accountant', 'admin');
begin
  if v_role in ('accountant', 'admin') then
    perform require_entry_date(p_received_on);
    if coalesce(p_received_on, business_today()) = business_today() then
      raise exception 'FORBIDDEN: payments of the day are taken by a cashier or manager' using errcode = '42501';
    end if;
  end if;
  return take_payment(p_loan_id, p_amount_cents, p_method, p_reference, p_received_on, p_idempotency_key, false);
end
$$;

revoke execute on function public.receive_payment(uuid, bigint, text, text, date, text) from public, anon, service_role;
grant execute on function public.receive_payment(uuid, bigint, text, text, date, text) to authenticated;
