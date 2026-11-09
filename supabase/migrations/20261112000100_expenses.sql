-- M8.1: payees and expenses (SPEC 7.6, 4, 6.2 R9/R9b/R9c; FR-22).
-- An expense at or below approvals.expense_limit_cents posts at once; above it a manager (not the
-- requester) or the CEO approves first. Paid now: Dr expense, Cr cash/bank/MoMo (R9). On credit:
-- Dr expense, Cr 2000 with the payee (R9b), settled later with settle_expense (R9c).

create table public.payees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  type text not null default 'other' check (type in ('supplier', 'landlord', 'utility', 'other')),
  phone text check (length(phone) <= 30),
  notes text check (length(notes) <= 500),
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default public.app_now()
);
create unique index payees_name_key on public.payees (lower(btrim(name)));
alter table public.journal_lines
  add constraint journal_lines_payee_fk foreign key (payee_id) references public.payees (id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text not null unique,
  payee_id uuid references public.payees (id),
  account_id uuid not null references public.accounts (id),
  amount_cents bigint not null check (amount_cents > 0),
  expense_date date not null,
  description text not null check (length(btrim(description)) between 3 and 300),
  paid_now boolean not null,
  paid_from_account_id uuid references public.accounts (id),
  status text not null check (status in ('pending_approval', 'approved', 'paid', 'rejected')),
  receipt_attachment_id uuid references public.attachments (id),
  branch_id uuid not null references public.branches (id),
  journal_id uuid references public.journals (id),
  settled_journal_id uuid references public.journals (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default public.app_now(),
  constraint expense_paid_from check (not paid_now or paid_from_account_id is not null),
  constraint expense_credit_payee check (paid_now or payee_id is not null)
);
create index expenses_status_idx on public.expenses (status, expense_date desc);
create index expenses_branch_idx on public.expenses (branch_id, expense_date desc);

alter table public.payees enable row level security;
alter table public.expenses enable row level security;
create policy payees_read on public.payees for select to authenticated using ((select public.is_staff()));
create policy expenses_read on public.expenses for select to authenticated
  using ((select public.auth_role()) in ('manager', 'accountant', 'ceo', 'admin', 'cashier'));
revoke all on public.payees, public.expenses from anon;
revoke insert, update, delete, truncate, references, trigger on public.payees, public.expenses
  from authenticated, service_role;

-- What each payee is owed on 2000 (R9b less R9c), from the ledger.
create or replace view public.payee_balances
with (security_invoker = true)
as
select p.id as payee_id,
       coalesce((select sum(l.credit_cents - l.debit_cents) from journal_lines l
                   join accounts a on a.id = l.account_id
                  where a.code = '2000' and l.payee_id = p.id), 0)::bigint as owed_cents
  from payees p;
grant select on public.payee_balances to authenticated;

-- save_payee: create (p_id null) or update; manager or accountant.
create or replace function public.save_payee(p_id uuid, p_payee jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_payee ->> 'name', ''));
  v_type text := coalesce(nullif(p_payee ->> 'type', ''), 'other');
  v_phone text := nullif(btrim(coalesce(p_payee ->> 'phone', '')), '');
  v_notes text := nullif(btrim(coalesce(p_payee ->> 'notes', '')), '');
  v_active boolean := coalesce((p_payee ->> 'active')::boolean, true);
  v_before payees;
  v_id uuid := p_id;
begin
  perform require_role('manager', 'accountant');
  if length(v_name) not between 2 and 120 or v_type not in ('supplier', 'landlord', 'utility', 'other')
     or length(v_phone) > 30 or length(v_notes) > 500 then
    raise exception 'INVALID_STATE: check the payee name, type, phone and notes' using errcode = '22023';
  end if;
  if exists (select 1 from payees where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'INVALID_STATE: a payee with this name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into payees (name, type, phone, notes, active, created_by)
    values (v_name, v_type, v_phone, v_notes, v_active, auth.uid()) returning id into v_id;
  else
    select * into v_before from payees where id = p_id for update;
    if not found then
      raise exception 'INVALID_STATE: the payee does not exist' using errcode = 'P0002';
    end if;
    update payees set name = v_name, type = v_type, phone = v_phone, notes = v_notes, active = v_active where id = p_id;
  end if;
  perform write_audit(case when p_id is null then 'payee.created' else 'payee.updated' end, 'payee', v_id::text,
    case when p_id is null then null else to_jsonb(v_before) end,
    jsonb_build_object('name', v_name, 'type', v_type, 'phone', v_phone, 'notes', v_notes, 'active', v_active));
  return v_id;
end
$$;
revoke execute on function public.save_payee(uuid, jsonb) from public, anon, service_role;
grant execute on function public.save_payee(uuid, jsonb) to authenticated;

-- The money account an expense or settlement is paid from: the branch's cash, 1020 or 1030.
create or replace function public.expense_pay_account(p_code text, p_branch uuid)
returns accounts
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account accounts;
begin
  select * into v_account from accounts
   where code = p_code and active and ((is_cash and branch_id = p_branch) or code in ('1020', '1030'));
  if not found then
    raise exception 'INVALID_STATE: pay from the branch cash account, the bank (1020) or mobile money (1030)'
      using errcode = '22023';
  end if;
  return v_account;
end
$$;
revoke execute on function public.expense_pay_account(text, uuid) from public, anon, authenticated, service_role;

-- Posts an approved expense: R9 when paid now, R9b on credit. Dated the expense date when that is
-- still allowed, otherwise today (after go-live).
create or replace function public.post_expense(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp expenses;
  v_expense_account accounts;
  v_pay accounts;
  v_date date;
  v_journal uuid;
begin
  select * into v_exp from expenses where id = p_id for update;
  select * into v_expense_account from accounts where id = v_exp.account_id;
  v_date := v_exp.expense_date;
  begin
    perform require_posting_date(v_date);
  exception when others then
    v_date := business_today();
  end;
  if v_exp.paid_now then
    select * into v_pay from accounts where id = v_exp.paid_from_account_id;
    if v_pay.is_cash
       and coalesce((select (value #>> '{}')::boolean from settings where key = 'disbursement.check_funds'), true)
       and account_balance(v_pay.id) < v_exp.amount_cents then
      raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay', v_pay.code using errcode = '23514';
    end if;
  end if;
  v_journal := post_journal(v_date, v_exp.expense_no || ' ' || v_exp.description, 'expense', v_exp.id, v_exp.branch_id,
    jsonb_build_array(
      jsonb_build_object('account', v_expense_account.code, 'debit_cents', v_exp.amount_cents, 'payee_id', v_exp.payee_id),
      case when v_exp.paid_now
           then jsonb_build_object('account', v_pay.code, 'credit_cents', v_exp.amount_cents)
           else jsonb_build_object('account', '2000', 'credit_cents', v_exp.amount_cents, 'payee_id', v_exp.payee_id) end));
  update expenses set journal_id = v_journal, status = case when paid_now then 'paid' else 'approved' end where id = p_id;
  return jsonb_build_object('expense_id', p_id, 'journal_id', v_journal,
                            'status', case when v_exp.paid_now then 'paid' else 'approved' end);
end
$$;
revoke execute on function public.post_expense(uuid) from public, anon, authenticated, service_role;

-- create_expense (SPEC 8; FR-22). Manager or accountant. Input:
-- {"account": "5010", "amount_cents": 4500, "expense_date": "YYYY-MM-DD", "description": "...",
--  "payee_id": uuid|null, "branch_id": uuid|null (default: your branch), "paid_now": true,
--  "paid_from": "1010-BR2"|"1020"|"1030" (when paid now), "receipt": {"storage_path", "file_name"}|null}
create or replace function public.create_expense(p_expense jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account accounts;
  v_pay accounts;
  v_amount bigint;
  v_date date;
  v_description text := btrim(coalesce(p_expense ->> 'description', ''));
  v_paid_now boolean := coalesce((p_expense ->> 'paid_now')::boolean, true);
  v_payee payees;
  v_branch uuid := coalesce(nullif(p_expense ->> 'branch_id', '')::uuid, auth_branch());
  v_limit bigint;
  v_id uuid;
  v_no text;
  v_request uuid;
  v_result jsonb;
begin
  perform require_role('manager', 'accountant');
  if jsonb_typeof(p_expense -> 'amount_cents') <> 'number' or (p_expense ->> 'amount_cents') !~ '^[0-9]+$'
     or (p_expense ->> 'amount_cents')::numeric <= 0 then
    raise exception 'INVALID_STATE: the amount must be a positive whole number of cents' using errcode = '22023';
  end if;
  v_amount := (p_expense ->> 'amount_cents')::bigint;
  begin
    v_date := (p_expense ->> 'expense_date')::date;
  exception when others then
    v_date := null;
  end;
  perform require_posting_date(v_date);
  select * into v_account from accounts where code = p_expense ->> 'account' and type = 'expense' and active
     and code <> '5050';                                                  -- bad debts only through write-off
  if not found then
    raise exception 'INVALID_STATE: choose an expense account' using errcode = '22023';
  end if;
  if length(v_description) not between 3 and 300 then
    raise exception 'INVALID_STATE: describe the expense (3 to 300 characters)' using errcode = '22023';
  end if;
  if v_branch is null or not exists (select 1 from branches where id = v_branch) then
    raise exception 'INVALID_STATE: choose the branch the expense belongs to' using errcode = '22023';
  end if;
  if nullif(p_expense ->> 'payee_id', '') is not null then
    select * into v_payee from payees where id = (p_expense ->> 'payee_id')::uuid and active;
    if not found then
      raise exception 'INVALID_STATE: the payee does not exist or is inactive' using errcode = '22023';
    end if;
  elsif not v_paid_now then
    raise exception 'INVALID_STATE: an expense on credit needs a payee' using errcode = '22023';
  end if;
  if v_paid_now then
    v_pay := expense_pay_account(p_expense ->> 'paid_from', v_branch);
    if v_pay.is_cash
       and coalesce((select (value #>> '{}')::boolean from settings where key = 'disbursement.check_funds'), true)
       and account_balance(v_pay.id) < v_amount then
      raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay', v_pay.code using errcode = '23514';
    end if;
  end if;

  v_no := next_number('expense', v_branch);
  insert into expenses (expense_no, payee_id, account_id, amount_cents, expense_date, description, paid_now,
                        paid_from_account_id, status, branch_id, created_by)
  values (v_no, v_payee.id, v_account.id, v_amount, v_date, v_description, v_paid_now, v_pay.id,
          'pending_approval', v_branch, auth.uid())
  returning id into v_id;
  if p_expense -> 'receipt' is not null and jsonb_typeof(p_expense -> 'receipt') = 'object' then
    perform link_attachments('expense', v_id,
                 jsonb_build_array((p_expense -> 'receipt') || jsonb_build_object('kind', 'receipt')));
    update expenses set receipt_attachment_id = (
      select id from attachments where entity_type = 'expense' and entity_id = v_id order by created_at desc limit 1)
     where id = v_id;
  end if;

  select (value #>> '{}')::bigint into v_limit from settings where key = 'approvals.expense_limit_cents';
  if v_amount > coalesce(v_limit, 0) then
    insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
    values ('expense', 'expense', v_id,
            jsonb_build_object('expense_no', v_no, 'amount_cents', v_amount, 'account', v_account.code,
                               'account_name', v_account.name, 'description', v_description,
                               'payee', v_payee.name, 'paid_from', v_pay.code, 'expense_date', v_date,
                               'branch_id', v_branch),
            'manager', v_description, auth.uid())
    returning id into v_request;
    v_result := jsonb_build_object('expense_id', v_id, 'expense_no', v_no, 'status', 'pending_approval',
                                   'request_id', v_request);
  else
    v_result := post_expense(v_id) || jsonb_build_object('expense_no', v_no);
  end if;
  perform write_audit('expense.created', 'expense', v_id::text, null,
    jsonb_build_object('expense_no', v_no, 'amount_cents', v_amount, 'account', v_account.code, 'paid_now', v_paid_now,
                       'paid_from', v_pay.code, 'payee_id', v_payee.id, 'status', v_result ->> 'status'));
  return v_result;
end
$$;
revoke execute on function public.create_expense(jsonb) from public, anon, service_role;
grant execute on function public.create_expense(jsonb) to authenticated;

-- settle_expense (R9c): pays a payee for an expense taken on credit. Manager or accountant.
create or replace function public.settle_expense(p_id uuid, p_account text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp expenses;
  v_pay accounts;
  v_journal uuid;
begin
  perform require_role('manager', 'accountant');
  select * into v_exp from expenses where id = p_id for update;
  if not found then
    raise exception 'INVALID_STATE: the expense does not exist' using errcode = 'P0002';
  end if;
  if v_exp.status <> 'approved' or v_exp.paid_now then
    raise exception 'INVALID_STATE: only an approved expense on credit can be settled' using errcode = '22023';
  end if;
  v_pay := expense_pay_account(p_account, v_exp.branch_id);
  if v_pay.is_cash
     and coalesce((select (value #>> '{}')::boolean from settings where key = 'disbursement.check_funds'), true)
     and account_balance(v_pay.id) < v_exp.amount_cents then
    raise exception 'INSUFFICIENT_FUNDS: % holds less than the amount to pay', v_pay.code using errcode = '23514';
  end if;
  v_journal := post_journal(business_today(), v_exp.expense_no || ' settled', 'expense_settlement', v_exp.id,
                            v_exp.branch_id,
    jsonb_build_array(
      jsonb_build_object('account', '2000', 'debit_cents', v_exp.amount_cents, 'payee_id', v_exp.payee_id),
      jsonb_build_object('account', v_pay.code, 'credit_cents', v_exp.amount_cents)));
  update expenses set status = 'paid', settled_journal_id = v_journal, paid_from_account_id = v_pay.id where id = p_id;
  perform write_audit('expense.settled', 'expense', p_id::text, jsonb_build_object('status', 'approved'),
                      jsonb_build_object('status', 'paid', 'paid_from', v_pay.code, 'journal_id', v_journal));
  return v_journal;
end
$$;
revoke execute on function public.settle_expense(uuid, text) from public, anon, service_role;
grant execute on function public.settle_expense(uuid, text) to authenticated;

-- link_attachments again, with expense receipts.
create or replace function public.link_attachments(p_entity_type text, p_entity_id uuid, p_files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_claim jsonb;
  v_kind text;
  v_name text;
  v_linked jsonb := '[]'::jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return v_linked;
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'INVALID_STATE: at most 10 files at a time' using errcode = '22023';
  end if;
  for v_file in select value from jsonb_array_elements(p_files) loop
    v_kind := v_file ->> 'kind';
    v_name := left(btrim(coalesce(v_file ->> 'file_name', '')), 200);
    if (p_entity_type = 'customer' and v_kind not in ('photo', 'id_document', 'proof_of_address', 'other'))
       or (p_entity_type = 'loan' and v_kind not in ('guarantor_id', 'signed_agreement', 'other'))
       or (p_entity_type = 'collateral' and v_kind not in ('photo', 'document', 'other'))
       or (p_entity_type = 'recovery_action' and v_kind not in ('court_document', 'notice', 'other'))
       or (p_entity_type = 'expense' and v_kind not in ('receipt', 'other'))
       or p_entity_type not in ('customer', 'loan', 'collateral', 'recovery_action', 'expense') then
      raise exception 'INVALID_STATE: unknown document kind' using errcode = '22023';
    end if;
    if v_name = '' then
      raise exception 'INVALID_STATE: a file needs a name' using errcode = '22023';
    end if;
    v_claim := claim_upload(v_file ->> 'storage_path', v_kind = 'photo');
    insert into attachments (entity_type, entity_id, kind, storage_path, file_name, mime, size_bytes, created_by)
    values (p_entity_type, p_entity_id, v_kind, v_claim ->> 'storage_path', v_name, v_claim ->> 'mime',
            (v_claim ->> 'size_bytes')::bigint, auth.uid());
    v_linked := v_linked || jsonb_build_object('kind', v_kind, 'storage_path', v_claim ->> 'storage_path',
                                               'file_name', v_name);
  end loop;
  return v_linked;
end
$$;

revoke execute on function public.link_attachments(text, uuid, jsonb) from public, anon, authenticated, service_role;

-- decide_approval again: expenses (post on approval, mark rejected on rejection).
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('manager', 'ceo');
  v_request approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb := '{}'::jsonb;
  v_journal uuid;
begin
  select * into v_request from approval_requests where id = p_id for update;
  if not found then
    raise exception 'INVALID_STATE: the request does not exist' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'INVALID_STATE: this request was already decided' using errcode = '22023';
  end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'SELF_APPROVAL: you cannot decide a request you made' using errcode = '42501';
  end if;
  if v_request.required_role = 'ceo' and v_role <> 'ceo' then
    raise exception 'FORBIDDEN: only the CEO can decide this request' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_STATE: the decision must be approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'INVALID_STATE: give a reason for the rejection' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long (500 characters at most)' using errcode = '22023';
  end if;

  if v_request.type = 'loan_approval' then
    v_result := apply_loan_decision(v_request, p_decision, v_note);
  elsif v_request.type = 'expense' and p_decision = 'reject' then
    update expenses set status = 'rejected' where id = v_request.entity_id and status = 'pending_approval';
  elsif p_decision = 'approve' then
    case v_request.type
      when 'customer_edit', 'customer_blacklist' then
        v_result := apply_customer_edit(v_request);
      when 'payment_void' then
        v_result := apply_payment_void(v_request);
      when 'journal_reversal' then
        v_result := apply_journal_reversal(v_request);
      when 'loan_extension' then
        v_result := apply_loan_extension(v_request);
      when 'expense' then
        if not exists (select 1 from expenses where id = v_request.entity_id and status = 'pending_approval') then
          raise exception 'INVALID_STATE: the expense is no longer waiting' using errcode = '22023';
        end if;
        v_result := post_expense(v_request.entity_id);
      when 'write_off' then
        v_result := apply_write_off(v_request, v_note);
      when 'manual_journal', 'capital_in' then
        perform require_posting_date((v_request.payload ->> 'entry_date')::date);
        v_journal := post_journal((v_request.payload ->> 'entry_date')::date, v_request.payload ->> 'memo',
                                  v_request.type, v_request.id, nullif(v_request.payload ->> 'branch_id', '')::uuid,
                                  v_request.payload -> 'lines');
        v_result := jsonb_build_object('journal_id', v_journal,
                                       'journal_no', (select journal_no from journals where id = v_journal));
      else
        raise exception 'INVALID_STATE: requests of this type cannot be decided yet' using errcode = '22023';
    end case;
  end if;

  update approval_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = app_now(), decision_note = v_note
   where id = v_request.id;

  perform write_audit(case when p_decision = 'approve' then 'approval.approved' else 'approval.rejected' end,
    'approval_request', v_request.id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
                       'type', v_request.type, 'note', v_note, 'result', v_result));
  return v_result;
end
$$;

-- The accountant records expenses (SPEC 4) and may upload their receipts to their own folder.
drop policy documents_insert_own_folder on storage.objects;
create policy documents_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.auth_role()) in ('loan_officer', 'cashier', 'manager', 'accountant', 'admin')
    and (storage.foldername(name))[1] = (select auth.uid())::text);
