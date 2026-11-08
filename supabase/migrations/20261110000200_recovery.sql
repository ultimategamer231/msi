-- M6.3: recovery cases and collateral disposal (SPEC 5.7; FR-17; A-08, A-14; B-04, B-05; T-14, T-15).
-- A manager or the CEO opens a case on a loan eligible for recovery (30 days past due): the loan
-- goes to status recovery (penalties stop), pledged items are seized. Stages (B-05): opened, notice
-- sent, court filed, judgment, disposal, closed. A sale (R7) allocates the proceeds in order and
-- puts any excess on 2100 Customer Surplus Payable; the surplus is paid out with R7b.

create table public.recovery_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,
  loan_id uuid not null references public.loans (id),
  stage text not null default 'opened'
    check (stage in ('opened', 'notice_sent', 'court_filed', 'judgment', 'disposal', 'closed')),
  opened_by uuid not null references public.profiles (id),
  opened_on date not null,
  court_ref text check (length(court_ref) <= 100),
  closed_on date,
  created_at timestamptz not null default public.app_now(),
  updated_at timestamptz not null default public.app_now(),
  check ((stage = 'closed') = (closed_on is not null))
);

comment on table public.recovery_cases is 'Recovery cases (SPEC 7.3); the stage moves forward only through RPCs.';

create unique index recovery_cases_one_open_idx on public.recovery_cases (loan_id) where closed_on is null;
create index recovery_cases_loan_idx on public.recovery_cases (loan_id);
create index recovery_cases_opened_by_idx on public.recovery_cases (opened_by);

create table public.recovery_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.recovery_cases (id),
  stage text not null check (stage in ('opened', 'notice_sent', 'court_filed', 'judgment', 'disposal', 'closed')),
  action_date date not null,
  note text check (length(note) <= 500),
  court_ref text check (length(court_ref) <= 100),
  attachment_id uuid references public.attachments (id),
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default public.app_now()
);

comment on table public.recovery_actions is 'Stage history of a recovery case (SPEC 7.3); append-only.';

create index recovery_actions_case_idx on public.recovery_actions (case_id, created_at);
create index recovery_actions_actor_idx on public.recovery_actions (actor_id) where actor_id is not null;
create index recovery_actions_attachment_idx on public.recovery_actions (attachment_id) where attachment_id is not null;

create trigger recovery_actions_immutable
  before update or delete on public.recovery_actions
  for each row execute function public.trg_immutable();

alter table public.recovery_cases enable row level security;
alter table public.recovery_actions enable row level security;
create policy recovery_cases_read on public.recovery_cases for select to authenticated using ((select public.is_staff()));
create policy recovery_actions_read on public.recovery_actions for select to authenticated using ((select public.is_staff()));
revoke all on public.recovery_cases, public.recovery_actions from anon;
revoke insert, update, delete, truncate, references, trigger on public.recovery_cases, public.recovery_actions
  from authenticated, service_role;

create or replace function public.recovery_stage_rank(p_stage text)
returns int
language sql
immutable
set search_path = public
as $$
  select array_position(array['opened', 'notice_sent', 'court_filed', 'judgment', 'disposal', 'closed'], p_stage)
$$;

-- What the case's loan owes, as a sale preview would allocate it (SPEC 5.7 step 2; mock-up 13).
create or replace function public.preview_collateral_sale(p_case_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_case recovery_cases;
  v_owed record;
  v_total bigint;
  v_amount bigint := greatest(coalesce(p_amount_cents, 0), 0);
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_case from recovery_cases where id = p_case_id;
  if not found then
    raise exception 'INVALID_STATE: the case does not exist' using errcode = 'P0002';
  end if;
  select * into v_owed from loan_owed(v_case.loan_id);
  v_total := v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents;
  return jsonb_build_object(
    'owed', jsonb_build_object('penalty', v_owed.penalty_cents, 'interest', v_owed.interest_cents,
                               'principal', v_owed.principal_cents, 'total', v_total),
    'allocation', allocate_amount(least(v_amount, v_total), v_owed.penalty_cents, v_owed.interest_cents,
                                  v_owed.principal_cents) - 'unallocated',
    'surplus_cents', greatest(v_amount - v_total, 0),
    'shortfall_cents', greatest(v_total - v_amount, 0));
end
$$;

revoke execute on function public.preview_collateral_sale(uuid, bigint) from public, anon, service_role;
grant execute on function public.preview_collateral_sale(uuid, bigint) to authenticated;

create or replace function public.open_recovery_case(p_loan_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_case uuid := gen_random_uuid();
  v_no text;
  v_item record;
begin
  perform require_role('manager', 'ceo');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status <> 'overdue' or not v_loan.recovery_eligible then
    raise exception 'INVALID_STATE: a case opens on an overdue loan once it is eligible for recovery (% days after the due date)',
      v_loan.recovery_after_days using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long' using errcode = '22023';
  end if;
  v_no := next_number('recovery_case');
  insert into recovery_cases (id, case_no, loan_id, stage, opened_by, opened_on)
  values (v_case, v_no, v_loan.id, 'opened', auth.uid(), business_today());
  insert into recovery_actions (case_id, stage, action_date, note, actor_id)
  values (v_case, 'opened', business_today(), v_note, auth.uid());
  update loans set status = 'recovery', updated_at = app_now() where id = v_loan.id;   -- penalties stop (A-08)
  for v_item in select lc.id as pledge_id, c.id, c.location_note
                  from loan_collaterals lc join collaterals c on c.id = lc.collateral_id
                 where lc.loan_id = v_loan.id and lc.status = 'pledged' and c.status = 'held' loop
    update loan_collaterals set status = 'seized' where id = v_item.pledge_id;
    update collaterals set status = 'in_recovery' where id = v_item.id;
    insert into collateral_events (collateral_id, event_type, from_location, note, actor_id)
    values (v_item.id, 'seized', v_item.location_note, 'Held for recovery case ' || v_no, auth.uid());
  end loop;
  perform write_audit('recovery.opened', 'recovery_case', v_case::text, jsonb_build_object('loan_status', v_loan.status),
                      jsonb_build_object('case_no', v_no, 'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'note', v_note));
  return v_case;
end
$$;

-- A stage step (notice sent, court filed, judgment, disposal) with a note, court reference and an
-- optional document. Forward only; a case closes when its loan ends (sale, payment or write-off).
create or replace function public.advance_recovery_stage(p_case_id uuid, p_stage text, p_note text,
                                                         p_court_ref text default null, p_files jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case recovery_cases;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_court_ref, '')), '');
  v_action uuid := gen_random_uuid();
  v_linked jsonb;
  v_attachment uuid;
begin
  perform require_role('manager', 'ceo');
  select * into v_case from recovery_cases where id = p_case_id for update;
  if not found then
    raise exception 'INVALID_STATE: the case does not exist' using errcode = 'P0002';
  end if;
  if v_case.stage = 'closed' then
    raise exception 'INVALID_STATE: the case is closed' using errcode = '22023';
  end if;
  if p_stage not in ('notice_sent', 'court_filed', 'judgment', 'disposal')
     or recovery_stage_rank(p_stage) <= recovery_stage_rank(v_case.stage) then
    raise exception 'INVALID_STATE: the next stage must come after %', v_case.stage using errcode = '22023';
  end if;
  if v_note is null or length(v_note) > 500 or length(v_ref) > 100 then
    raise exception 'INVALID_STATE: write what was done (up to 500 characters)' using errcode = '22023';
  end if;
  v_linked := link_attachments('recovery_action', v_action, p_files);
  if jsonb_array_length(v_linked) > 0 then
    select id into v_attachment from attachments
     where entity_type = 'recovery_action' and entity_id = v_action order by created_at limit 1;
  end if;
  insert into recovery_actions (id, case_id, stage, action_date, note, court_ref, attachment_id, actor_id)
  values (v_action, v_case.id, p_stage, business_today(), v_note, v_ref, v_attachment, auth.uid());
  update recovery_cases set stage = p_stage, court_ref = coalesce(v_ref, court_ref), updated_at = app_now()
   where id = v_case.id;
  perform write_audit('recovery.stage', 'recovery_case', v_case.id::text, jsonb_build_object('stage', v_case.stage),
                      jsonb_build_object('stage', p_stage, 'note', v_note, 'court_ref', v_ref, 'files', v_linked));
  return v_action;
end
$$;

-- The cash, bank or mobile money account for money a manager or CEO handles (B-10 default):
-- the person's branch cash, or the loan's branch when they have no branch.
create or replace function public.recovery_account(p_method text, p_loan loans)
returns accounts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account accounts;
begin
  if p_method = 'cash' then
    select * into v_account from accounts where is_cash and active and branch_id = coalesce(auth_branch(), p_loan.branch_id);
  elsif p_method = 'bank' then
    select * into v_account from accounts where code = '1020' and active;
  elsif p_method = 'mobile_money' then
    select * into v_account from accounts where code = '1030' and active;
  else
    raise exception 'INVALID_STATE: the method must be cash, mobile money or bank' using errcode = '22023';
  end if;
  if v_account.id is null then
    raise exception 'INVALID_STATE: no account is set up for this method' using errcode = '22023';
  end if;
  return v_account;
end
$$;

-- record_collateral_sale (SPEC 5.7 step 2; R7; T-14, T-15).
create or replace function public.record_collateral_sale(
  p_case_id uuid, p_collateral_id uuid, p_sale_amount_cents bigint, p_buyer_name text, p_method text,
  p_sold_on date default null, p_court_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case recovery_cases;
  v_loan loans;
  v_item collaterals;
  v_buyer text := nullif(btrim(coalesce(p_buyer_name, '')), '');
  v_ref text := nullif(btrim(coalesce(p_court_ref, '')), '');
  v_on date;
  v_owed record;
  v_total bigint;
  v_applied bigint;
  v_surplus bigint;
  v_split jsonb;
  v_account accounts;
  v_lines jsonb;
  v_component text;
  v_action uuid := gen_random_uuid();
  v_journal uuid;
  v_after bigint;
begin
  perform require_role('manager', 'ceo');
  select * into v_case from recovery_cases where id = p_case_id for update;
  if not found or v_case.stage = 'closed' then
    raise exception 'INVALID_STATE: the case is not open' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = v_case.loan_id for update;
  select * into v_item from collaterals where id = p_collateral_id for update;
  if not found or v_item.status <> 'in_recovery'
     or not exists (select 1 from loan_collaterals where loan_id = v_loan.id and collateral_id = v_item.id and status = 'seized') then
    raise exception 'INVALID_STATE: only an item seized for this case can be sold' using errcode = '22023';
  end if;
  if p_sale_amount_cents is null or p_sale_amount_cents <= 0 then
    raise exception 'INVALID_STATE: the sale amount must be more than zero' using errcode = '22023';
  end if;
  if v_buyer is null or length(v_buyer) > 120 or length(v_ref) > 100 then
    raise exception 'INVALID_STATE: give the buyer''s name' using errcode = '22023';
  end if;
  v_on := require_entry_date(p_sold_on);
  v_account := recovery_account(p_method, v_loan);

  select * into v_owed from loan_owed(v_loan.id);
  v_total := v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents;
  v_applied := least(p_sale_amount_cents, v_total);
  v_surplus := p_sale_amount_cents - v_applied;
  v_split := allocate_amount(v_applied, v_owed.penalty_cents, v_owed.interest_cents, v_owed.principal_cents);

  v_lines := jsonb_build_array(jsonb_build_object('account', v_account.code, 'debit_cents', p_sale_amount_cents,
                                                  'customer_id', v_loan.customer_id));
  foreach v_component in array array['penalty', 'interest', 'principal'] loop
    if (v_split ->> v_component)::bigint > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account', case v_component when 'penalty' then '1120' when 'interest' then '1110' else '1100' end,
        'credit_cents', (v_split ->> v_component)::bigint, 'loan_id', v_loan.id,
        'customer_id', v_loan.customer_id, 'component', v_component));
    end if;
  end loop;
  if v_surplus > 0 then                                                    -- A-14: owed to the borrower
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', '2100', 'credit_cents', v_surplus,
                                                               'loan_id', v_loan.id, 'customer_id', v_loan.customer_id));
  end if;
  v_journal := post_journal(v_on, format('Sale of %s (%s) for %s', v_item.code, v_case.case_no, v_loan.loan_no),
                            'collateral_sale', v_action, v_loan.branch_id, v_lines);       -- R7

  update loan_collaterals set status = 'sold' where loan_id = v_loan.id and collateral_id = v_item.id;
  update collaterals set status = 'sold' where id = v_item.id;
  insert into collateral_events (collateral_id, event_type, from_location, note, actor_id)
  values (v_item.id, 'sold', v_item.location_note,
          format('Sold to %s for %s cents (%s)', v_buyer, p_sale_amount_cents, v_case.case_no), auth.uid());
  insert into recovery_actions (id, case_id, stage, action_date, note, court_ref, actor_id)
  values (v_action, v_case.id, 'disposal', v_on,
          format('%s sold to %s for %s cents', v_item.code, v_buyer, p_sale_amount_cents), v_ref, auth.uid());
  if recovery_stage_rank(v_case.stage) < recovery_stage_rank('disposal') then
    update recovery_cases set stage = 'disposal', updated_at = app_now() where id = v_case.id;
  end if;

  select penalty_cents + interest_cents + principal_cents into v_after from loan_owed(v_loan.id);
  if v_after = 0 then
    update loans set status = 'closed', closed_on = v_on, updated_at = app_now() where id = v_loan.id;   -- closes the case too
    perform write_audit('loan.closed', 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
                        jsonb_build_object('status', 'closed', 'closed_on', v_on, 'sale_action_id', v_action));
  end if;
  perform write_audit('recovery.collateral_sold', 'recovery_case', v_case.id::text, null,
    jsonb_build_object('collateral', v_item.code, 'buyer', v_buyer, 'amount_cents', p_sale_amount_cents,
                       'allocation', v_split - 'unallocated', 'surplus_cents', v_surplus, 'balance_after', v_after,
                       'journal_id', v_journal, 'method', p_method));
  return jsonb_build_object('journal_id', v_journal, 'allocation', v_split - 'unallocated',
                            'surplus_cents', v_surplus, 'balance_after_cents', v_after);
end
$$;

-- What the company owes a borrower from sales (2100, per loan).
create or replace function public.loan_surplus_cents(p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(l.credit_cents - l.debit_cents), 0)::bigint
    from journal_lines l join accounts a on a.id = l.account_id
   where a.code = '2100' and l.loan_id = p_loan_id and is_staff()
$$;

-- pay_surplus (SPEC 5.7 step 3; R7b).
create or replace function public.pay_surplus(p_loan_id uuid, p_amount_cents bigint, p_method text default 'cash')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_account accounts;
  v_owed bigint;
  v_journal uuid;
begin
  perform require_role('manager', 'ceo');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  v_owed := loan_surplus_cents(v_loan.id);
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > v_owed then
    raise exception 'INVALID_STATE: pay between 1 cent and the % cents held for the borrower', v_owed using errcode = '22023';
  end if;
  v_account := recovery_account(p_method, v_loan);
  if p_method = 'cash'
     and coalesce((select (value #>> '{}')::boolean from settings where key = 'disbursement.check_funds'), true)
     and account_balance(v_account.id) < p_amount_cents then
    raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay', v_account.code using errcode = '23514';
  end if;
  v_journal := post_journal(business_today(), 'Surplus paid to the borrower of ' || v_loan.loan_no, 'surplus_payout',
                            v_loan.id, v_loan.branch_id,
    jsonb_build_array(
      jsonb_build_object('account', '2100', 'debit_cents', p_amount_cents, 'loan_id', v_loan.id, 'customer_id', v_loan.customer_id),
      jsonb_build_object('account', v_account.code, 'credit_cents', p_amount_cents)));        -- R7b
  perform write_audit('recovery.surplus_paid', 'loan', v_loan.id::text, jsonb_build_object('surplus_cents', v_owed),
                      jsonb_build_object('paid_cents', p_amount_cents, 'method', p_method, 'journal_id', v_journal));
  return v_journal;
end
$$;

-- A loan that ends (paid, sold off or written off) closes its open case; items still seized go back
-- to held, ready to return to the owner.
create or replace function public.trg_loan_ended_close_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case recovery_cases;
begin
  if new.status in ('closed', 'written_off') and old.status is distinct from new.status then
    for v_case in select * from recovery_cases where loan_id = new.id and closed_on is null for update loop
      update recovery_cases set stage = 'closed', closed_on = business_today(), updated_at = app_now() where id = v_case.id;
      insert into recovery_actions (case_id, stage, action_date, note, actor_id)
      values (v_case.id, 'closed', business_today(),
              case new.status when 'closed' then 'Loan settled' else 'Loan written off' end, auth.uid());
      perform write_audit('recovery.closed', 'recovery_case', v_case.id::text, jsonb_build_object('stage', v_case.stage),
                          jsonb_build_object('stage', 'closed', 'loan_status', new.status));
    end loop;
    update collaterals c set status = 'held'
      from loan_collaterals lc
     where lc.collateral_id = c.id and lc.loan_id = new.id and lc.status = 'seized' and c.status = 'in_recovery';
  end if;
  return new;
end
$$;

create trigger loans_ended_close_case
  after update of status on public.loans
  for each row execute function public.trg_loan_ended_close_case();

revoke execute on function public.recovery_stage_rank(text), public.recovery_account(text, loans),
  public.trg_loan_ended_close_case() from public, anon, authenticated, service_role;
revoke execute on function public.open_recovery_case(uuid, text), public.advance_recovery_stage(uuid, text, text, text, jsonb),
  public.record_collateral_sale(uuid, uuid, bigint, text, text, date, text), public.loan_surplus_cents(uuid),
  public.pay_surplus(uuid, bigint, text) from public, anon, service_role;
grant execute on function public.open_recovery_case(uuid, text), public.advance_recovery_stage(uuid, text, text, text, jsonb),
  public.record_collateral_sale(uuid, uuid, bigint, text, text, date, text), public.loan_surplus_cents(uuid),
  public.pay_surplus(uuid, bigint, text) to authenticated;
