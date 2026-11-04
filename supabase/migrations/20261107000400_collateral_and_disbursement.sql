-- M3.4: the part of collateral that loans need now (SPEC 5.9, 7.4: register, pledge) and
-- disbursement (SPEC 5.3, 5.4, 8: disburse_loan; recipe R1; T-23, T-35). Custody moves, photos,
-- release and recovery come in M6.

create table public.collaterals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_customer_id uuid not null references public.customers (id),
  type text not null check (type in ('vehicle', 'land_document', 'electronics', 'goods', 'savings_lien', 'other')),
  description text not null check (length(btrim(description)) between 1 and 200),
  serial_no text check (length(serial_no) <= 80),
  plate_no text check (length(plate_no) <= 40),
  chassis_no text check (length(chassis_no) <= 80),
  document_no text check (length(document_no) <= 80),
  estimated_value_cents bigint not null check (estimated_value_cents > 0),
  currency text not null default 'USD',
  location_note text check (length(location_note) <= 200),
  status text not null default 'held' check (status in ('held', 'released', 'in_recovery', 'sold', 'lost')),
  branch_id uuid not null references public.branches (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now()
);

comment on table public.collaterals is 'Collateral register (SPEC 7.4). Status changes only through RPCs.';

create index collaterals_owner_idx on public.collaterals (owner_customer_id);
create index collaterals_branch_idx on public.collaterals (branch_id);
create index collaterals_created_by_idx on public.collaterals (created_by);
create index collaterals_status_idx on public.collaterals (status);

create table public.loan_collaterals (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id),
  collateral_id uuid not null references public.collaterals (id),
  status text not null default 'pledged' check (status in ('pledged', 'released', 'seized', 'sold')),
  pledged_on date not null,
  released_on date,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now(),
  unique (loan_id, collateral_id)
);

create index loan_collaterals_collateral_idx on public.loan_collaterals (collateral_id, status);
create index loan_collaterals_created_by_idx on public.loan_collaterals (created_by);

-- Custody log (SPEC 7.4 †): append-only. M3 writes "received"; M6 adds the other events.
create table public.collateral_events (
  id uuid primary key default gen_random_uuid(),
  collateral_id uuid not null references public.collaterals (id),
  event_type text not null check (event_type in ('received', 'moved', 'valued', 'released', 'seized', 'sold', 'lost', 'note')),
  from_location text,
  to_location text,
  note text check (length(note) <= 500),
  witness_name text check (length(witness_name) <= 120),
  photo_path text,
  actor_id uuid not null references public.profiles (id),
  at timestamptz not null default public.app_now()
);

create index collateral_events_collateral_idx on public.collateral_events (collateral_id, at);
create index collateral_events_actor_idx on public.collateral_events (actor_id);

create trigger collateral_events_immutable
  before update or delete on public.collateral_events
  for each row execute function public.trg_immutable();

alter table public.collaterals enable row level security;
alter table public.loan_collaterals enable row level security;
alter table public.collateral_events enable row level security;
create policy collaterals_read on public.collaterals for select to authenticated using ((select public.is_staff()));
create policy loan_collaterals_read on public.loan_collaterals for select to authenticated using ((select public.is_staff()));
create policy collateral_events_read on public.collateral_events for select to authenticated using ((select public.is_staff()));
revoke all on public.collaterals, public.loan_collaterals, public.collateral_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.collaterals, public.loan_collaterals, public.collateral_events from authenticated, service_role;

-- register_collateral (SPEC 8; SPEC 4: loan officer, cashier, manager). Input: {"owner_customer_id",
-- "type", "description", "serial_no", "plate_no", "chassis_no", "document_no",
-- "estimated_value_cents", "location_note"}. The item is held at the registering user's branch
-- (the owner's branch for staff without one). Returns the id.
create or replace function public.register_collateral(p_item jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer customers;
  v_id uuid := gen_random_uuid();
  v_code text;
  v_value bigint;
  v_text jsonb := '{}'::jsonb;
  v_key text;
begin
  perform require_role('loan_officer', 'cashier', 'manager');
  select * into v_customer from customers where id = nullif(p_item ->> 'owner_customer_id', '')::uuid;
  if not found then
    raise exception 'INVALID_STATE: choose the owner' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item -> 'estimated_value_cents') <> 'number' or (p_item ->> 'estimated_value_cents') !~ '^[0-9]+$'
     or (p_item ->> 'estimated_value_cents')::numeric <= 0 then
    raise exception 'INVALID_STATE: the estimated value must be a positive whole number of cents' using errcode = '22023';
  end if;
  v_value := (p_item ->> 'estimated_value_cents')::bigint;
  foreach v_key in array array['description', 'serial_no', 'plate_no', 'chassis_no', 'document_no', 'location_note'] loop
    v_text := v_text || jsonb_build_object(v_key, nullif(btrim(coalesce(p_item ->> v_key, '')), ''));
  end loop;
  v_code := next_number('collateral', null);
  begin
    insert into collaterals (id, code, owner_customer_id, type, description, serial_no, plate_no, chassis_no,
                             document_no, estimated_value_cents, location_note, branch_id, created_by)
    values (v_id, v_code, v_customer.id, p_item ->> 'type', v_text ->> 'description', v_text ->> 'serial_no',
            v_text ->> 'plate_no', v_text ->> 'chassis_no', v_text ->> 'document_no', v_value,
            v_text ->> 'location_note', coalesce(auth_branch(), v_customer.branch_id), auth.uid());
  exception when check_violation or not_null_violation then
    raise exception 'INVALID_STATE: check the item type, description and identifiers' using errcode = '22023';
  end;
  insert into collateral_events (collateral_id, event_type, to_location, note, actor_id)
  values (v_id, 'received', v_text ->> 'location_note', 'Received from ' || customer_display_name(v_customer), auth.uid());
  perform write_audit('collateral.registered', 'collateral', v_id::text, null,
    (select to_jsonb(c) from collaterals c where c.id = v_id));
  return v_id;
end
$$;

revoke execute on function public.register_collateral(jsonb) from public, anon, service_role;
grant execute on function public.register_collateral(jsonb) to authenticated;

-- link_collateral (SPEC 8): pledges an item to a loan that is not yet paid out. The item must
-- belong to the borrower and be held; with collateral.multi_loan = false it may not already secure
-- another open loan (A-10; T-24 in M6).
create or replace function public.link_collateral(p_loan_id uuid, p_collateral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_item collaterals;
  v_multi boolean;
begin
  perform require_role('loan_officer', 'cashier', 'manager');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found or v_loan.status not in ('draft', 'pending_approval', 'approved') then
    raise exception 'INVALID_STATE: collateral can be added only before the loan is paid out' using errcode = '22023';
  end if;
  select * into v_item from collaterals where id = p_collateral_id for update;
  if not found or v_item.owner_customer_id <> v_loan.customer_id then
    raise exception 'INVALID_STATE: the item must belong to the borrower' using errcode = '22023';
  end if;
  if v_item.status <> 'held' then
    raise exception 'INVALID_STATE: the item is % and cannot be pledged', v_item.status using errcode = '22023';
  end if;
  if exists (select 1 from loan_collaterals where loan_id = v_loan.id and collateral_id = v_item.id) then
    raise exception 'INVALID_STATE: the item already secures this loan' using errcode = '22023';
  end if;
  select coalesce((value #>> '{}')::boolean, false) into v_multi from settings where key = 'collateral.multi_loan';
  if not coalesce(v_multi, false) and exists (
       select 1 from loan_collaterals lc join loans l on l.id = lc.loan_id
        where lc.collateral_id = v_item.id and lc.status in ('pledged', 'seized')
          and l.status not in ('closed', 'written_off', 'cancelled', 'rejected')) then
    raise exception 'COLLATERAL_ALREADY_PLEDGED: the item already secures another open loan' using errcode = '23505';
  end if;
  insert into loan_collaterals (loan_id, collateral_id, status, pledged_on, created_by)
  values (v_loan.id, v_item.id, 'pledged', business_today(), auth.uid());
  perform write_audit('collateral.pledged', 'loan', v_loan.id::text, null,
    jsonb_build_object('collateral_id', v_item.id, 'code', v_item.code, 'loan_no', v_loan.loan_no));
end
$$;

revoke execute on function public.link_collateral(uuid, uuid) from public, anon, service_role;
grant execute on function public.link_collateral(uuid, uuid) to authenticated;

-- Entry date rule for money events (SPEC 5.4.6, A-19): today; another past date only for admin or
-- accountant and only before go-live; never in the future.
create or replace function public.require_entry_date(p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_go_live date;
  v_date date := coalesce(p_date, business_today());
begin
  if v_date = business_today() then
    return v_date;
  end if;
  select (value #>> '{}')::date into v_go_live from settings where key = 'migration.go_live_date';
  if v_date > business_today() or auth_role() not in ('admin', 'accountant')
     or (v_go_live is not null and business_today() >= v_go_live) then
    raise exception 'DATE_NOT_ALLOWED: only today''s date can be used' using errcode = '42501';
  end if;
  return v_date;
end
$$;

revoke execute on function public.require_entry_date(date) from public, anon, authenticated, service_role;

-- Balance of one account from the ledger (debits minus credits).
create or replace function public.account_balance(p_account_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$ select coalesce(sum(debit_cents - credit_cents), 0)::bigint from journal_lines where account_id = p_account_id $$;

revoke execute on function public.account_balance(uuid) from public, anon, authenticated, service_role;

-- disburse_loan (SPEC 8; FR-08; recipe R1). Cashier only (SPEC 4). Cash leaves the cashier's own
-- branch cash account (B-10); bank 1020; mobile money 1030. Checks: approved, pledged collateral
-- when required (T-23), funds when disbursement.check_funds (T-35), today's date, open day (post_journal
-- refuses a locked period). Sets the due date (A-02) and returns the journal number and due date.
create or replace function public.disburse_loan(p_loan_id uuid, p_method text, p_account_id uuid, p_disbursed_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_account accounts;
  v_on date;
  v_due date;
  v_check boolean;
  v_journal uuid;
  v_branch uuid;
begin
  perform require_role('cashier');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status <> 'approved' then
    raise exception 'INVALID_STATE: only an approved loan can be paid out' using errcode = '22023';
  end if;
  if (select status from customers where id = v_loan.customer_id) <> 'active' then
    raise exception 'INVALID_STATE: the customer is no longer active' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_disbursed_on);

  if p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = auth_branch();
  elsif p_method = 'bank' then
    select * into v_account from accounts where code = '1020' and active;
  elsif p_method = 'mobile_money' then
    select * into v_account from accounts where code = '1030' and active;
  else
    raise exception 'INVALID_STATE: the method must be cash, bank or mobile money' using errcode = '22023';
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;
  if p_account_id is not null and p_account_id <> v_account.id then
    raise exception 'INVALID_STATE: cash is paid from your branch cash account, bank from 1020, mobile money from 1030'
      using errcode = '22023';
  end if;

  if v_loan.collateral_required and not exists (
       select 1 from loan_collaterals where loan_id = v_loan.id and status = 'pledged') then
    raise exception 'COLLATERAL_REQUIRED: add collateral before paying out this loan' using errcode = '23514';
  end if;
  select coalesce((value #>> '{}')::boolean, true) into v_check from settings where key = 'disbursement.check_funds';
  if coalesce(v_check, true) and account_balance(v_account.id) < v_loan.principal_cents then
    raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay out', v_account.code using errcode = '23514';
  end if;

  v_due := add_months_clamped(v_on, v_loan.term_months);
  v_branch := coalesce(v_account.branch_id, v_loan.branch_id);
  v_journal := post_journal(v_on, 'Loan ' || v_loan.loan_no || ' paid out', 'disbursement', v_loan.id, v_branch,
    jsonb_build_array(
      jsonb_build_object('account', '1100', 'debit_cents', v_loan.principal_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id, 'component', 'principal'),
      jsonb_build_object('account', '1110', 'debit_cents', v_loan.interest_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id, 'component', 'interest'),
      jsonb_build_object('account', v_account.code, 'credit_cents', v_loan.principal_cents,
                         'customer_id', v_loan.customer_id),
      jsonb_build_object('account', '4000', 'credit_cents', v_loan.interest_cents, 'loan_id', v_loan.id,
                         'customer_id', v_loan.customer_id)));

  update loans set status = 'active', disbursed_on = v_on, due_date = v_due, disbursed_by = auth.uid(),
                   disbursement_method = p_method, disbursement_account_id = v_account.id, updated_at = app_now()
   where id = v_loan.id;
  perform write_audit('loan.disbursed', 'loan', v_loan.id::text, jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'active', 'disbursed_on', v_on, 'due_date', v_due, 'method', p_method,
                       'account', v_account.code, 'journal_id', v_journal));
  return jsonb_build_object('journal_id', v_journal, 'journal_no', (select journal_no from journals where id = v_journal),
                            'due_date', v_due);
end
$$;

revoke execute on function public.disburse_loan(uuid, text, uuid, date) from public, anon, service_role;
grant execute on function public.disburse_loan(uuid, text, uuid, date) to authenticated;
