-- M7.1: statements and documents (SPEC 10.1, 9 /verify; FR-14, FR-25). Every printed document
-- keeps the facts the public verification page shows (date, amount, customer) next to its number
-- and token. New kinds: statement (STM-000001, a new number each time, because the period and
-- balance change), demand notice (DN-000001, likewise), collateral receipt (CR-<item code>, one per
-- item) and collateral release letter (RL-<item code>, one per item, once released).

alter table public.issued_documents
  add column doc_date date,
  add column amount_cents bigint check (amount_cents >= 0),
  add column customer_id uuid references public.customers (id),
  add column details jsonb;

create index issued_documents_customer_idx on public.issued_documents (customer_id) where customer_id is not null;

-- Facts for the documents printed before this change.
update public.issued_documents d
   set doc_date = p.received_on, amount_cents = p.amount_cents, customer_id = p.customer_id
  from public.payments p
 where d.kind = 'receipt' and p.id = d.entity_id;
update public.issued_documents d
   set doc_date = (d.generated_at at time zone 'UTC')::date, amount_cents = l.principal_cents + coalesce(l.interest_cents, 0),
       customer_id = l.customer_id
  from public.loans l
 where d.kind = 'loan_agreement' and l.id = d.entity_id;

insert into public.settings (key, value) values ('recovery.notice_days', '7') on conflict (key) do nothing;

update public.settings
   set value = value || jsonb_build_object('demand_notice',
     '[PLACEHOLDER: to be reviewed by MSI''s lawyer before use] Our records show that loan {loan_no} was due on {due_date} and is {days_overdue} days overdue. The amount now owed is {outstanding}, including penalties of {penalties}. Please pay the full amount at {branch} by {deadline}. If it is not paid by then, {company} may proceed under the loan agreement and its recovery policy, including the sale of the collateral listed below, and the costs of recovery may be added to what is owed.')
 where key = 'templates' and not (value ? 'demand_notice');

create or replace function public.validate_setting(p_key text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_field text;
begin
  if p_value is null then
    perform setting_error(p_key, 'needs a value');
  end if;

  case p_key
    when 'currency.base' then
      -- A-01: USD only in the MVP. LRD needs the multi-currency work in phase 2.
      if p_value <> '"USD"'::jsonb then
        perform setting_error(p_key, 'must be "USD" in this release');
      end if;

    when 'accounting.basis' then
      -- A-15: accrual is the only basis the posting recipes implement.
      if p_value <> '"accrual"'::jsonb then
        perform setting_error(p_key, 'must be "accrual" in this release');
      end if;

    when 'payments.allocation_order' then
      -- A-05: any order of the three components, each exactly once.
      if jsonb_typeof(p_value) <> 'array'
         or jsonb_array_length(p_value) <> 3
         or not (p_value @> '["penalty", "interest", "principal"]'::jsonb) then
        perform setting_error(p_key, 'must list penalty, interest and principal once each');
      end if;

    when 'approvals.loan_manager_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint <= 0 then
        perform setting_error(p_key, 'must be a positive whole number of cents');
      end if;

    when 'approvals.expense_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint < 0 then
        perform setting_error(p_key, 'must be zero or a positive whole number of cents');
      end if;

    when 'loans.collateral_required', 'collateral.multi_loan', 'extension.enabled',
         'field.require_remittance', 'daycloses.enforce', 'disbursement.check_funds' then
      if jsonb_typeof(p_value) <> 'boolean' then
        perform setting_error(p_key, 'must be true or false');
      end if;

    when 'migration.go_live_date' then
      -- A-19: null until MSI sets the go-live date.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform setting_error(p_key, 'must be null or a date YYYY-MM-DD');
      end if;
      begin
        perform (p_value #>> '{}')::date;
      exception when others then
        perform setting_error(p_key, 'is not a real date');
      end;

    when 'company' then
      -- SPEC 11 Branding. Pending fields hold "[pending]" and print blank.
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field not in ('name', 'short_name', 'address', 'phone', 'email', 'logo_path', 'receipt_footer') then
          perform setting_error(p_key, format('has an unknown field "%s"', v_field));
        end if;
      end loop;
      if not jsonb_is_short_text(p_value -> 'name', 120) or length(btrim(p_value ->> 'name')) = 0 then
        perform setting_error(p_key, 'needs a name of 1 to 120 characters');
      end if;
      if not jsonb_is_short_text(p_value -> 'short_name', 20) or length(btrim(p_value ->> 'short_name')) = 0 then
        perform setting_error(p_key, 'needs a short name of 1 to 20 characters');
      end if;
      if not (jsonb_is_short_text(p_value -> 'address', 300)
              and jsonb_is_short_text(p_value -> 'phone', 60)
              and jsonb_is_short_text(p_value -> 'email', 200)
              and jsonb_is_short_text(p_value -> 'receipt_footer', 200)) then
        perform setting_error(p_key, 'address, phone, email and receipt_footer must be text (use "" or "[pending]" when unknown)');
      end if;
      if not (jsonb_typeof(p_value -> 'logo_path') = 'null' or jsonb_is_short_text(p_value -> 'logo_path', 300)) then
        perform setting_error(p_key, 'logo_path must be a storage path or null');
      end if;

    when 'due.upcoming_days' then
      -- B-07: how far ahead the due list's "due soon" tab looks (SPEC 7.7 due_7d).
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 60 then
        perform setting_error(p_key, 'must be a whole number of days from 1 to 60');
      end if;

    when 'recovery.notice_days' then
      -- M7: days a demand notice gives the borrower to pay before collateral disposal.
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 90 then
        perform setting_error(p_key, 'must be a whole number of days from 1 to 90');
      end if;

    when 'templates' then
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object of named texts');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field !~ '^[a-z_]+$' or not jsonb_is_short_text(p_value -> v_field, 10000) then
          perform setting_error(p_key, format('template "%s" must be text up to 10,000 characters', v_field));
        end if;
      end loop;

    when 'clock.override_at' then
      -- B-01: null (real time) or {"at": timestamptz, "frozen": bool}.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'object'
         or jsonb_typeof(p_value -> 'at') <> 'string'
         or (p_value ? 'frozen' and jsonb_typeof(p_value -> 'frozen') <> 'boolean')
         or exists (select 1 from jsonb_object_keys(p_value) k where k not in ('at', 'frozen', 'set_at')) then
        perform setting_error(p_key, 'must be null or {"at": "<timestamp>", "frozen": true|false}');
      end if;
      begin
        perform (p_value ->> 'at')::timestamptz;
      exception when others then
        perform setting_error(p_key, '"at" is not a valid timestamp');
      end;

    else
      perform setting_error(p_key, 'is not a known setting');
  end case;
end
$$;

create or replace function public.sequence_scope(p_kind text, p_branch uuid)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case when p_kind in ('loan', 'journal', 'customer', 'collateral', 'recovery_case', 'statement', 'demand_notice') or p_branch is null
              then global_sequence_branch() else p_branch end;
$$;

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
    when 'recovery_case' then format('RC-%s', lpad(n::text, 6, '0'))
    when 'statement' then format('STM-%s', lpad(n::text, 6, '0'))
    when 'demand_notice' then format('DN-%s', lpad(n::text, 6, '0'))
    else format('%s-%s', upper(p_kind), n)
  end;
end
$$;

-- A loan statement (SPEC 10.1): opening balance at the start of the period, every ledger movement
-- of the loan (per journal) with a running balance, totals, the balance by component at the end and
-- the dates still ahead. From the ledger only (D-01). Staff only.
create or replace function public.loan_statement(p_loan_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_from date;
  v_to date := coalesce(p_to, business_today());
  v_opening bigint;
  v_lines jsonb;
  v_end record;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_loan from loans where id = p_loan_id;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  v_from := coalesce(p_from, v_loan.disbursed_on, v_to);
  if v_from > v_to then
    raise exception 'INVALID_STATE: the period starts after it ends' using errcode = '22023';
  end if;

  select coalesce(sum(l.debit_cents - l.credit_cents), 0) into v_opening
    from journal_lines l join journals j on j.id = l.journal_id
   where l.loan_id = v_loan.id and l.component is not null and j.entry_date < v_from;

  with moves as (
    select j.id, j.entry_date, j.chain_no, j.journal_no, j.source_type, j.memo, j.reversal_of,
           sum(l.debit_cents)::bigint as debit, sum(l.credit_cents)::bigint as credit,
           jsonb_object_agg(l.component, l.debit_cents - l.credit_cents) as parts
      from journal_lines l join journals j on j.id = l.journal_id
     where l.loan_id = v_loan.id and l.component is not null and j.entry_date between v_from and v_to
     group by j.id, j.entry_date, j.chain_no, j.journal_no, j.source_type, j.memo, j.reversal_of
  ),
  ordered as (
    select m.*, v_opening + sum(m.debit - m.credit) over (order by m.entry_date, m.chain_no) as balance,
           (select p.receipt_no from payments p where p.journal_id = m.id or p.void_journal_id = m.id limit 1) as receipt_no,
           (select e.period_no from loan_penalty_events e where e.journal_id = m.id) as penalty_period
      from moves m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', entry_date, 'journal_no', journal_no, 'source_type', source_type, 'memo', memo,
           'receipt_no', receipt_no, 'penalty_period', penalty_period, 'reversal', reversal_of is not null,
           'debit_cents', debit, 'credit_cents', credit, 'balance_cents', balance, 'parts', parts)
           order by entry_date, chain_no), '[]'::jsonb)
    into v_lines from ordered;

  select coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'penalty'), 0)::bigint as penalty,
         coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'interest'), 0)::bigint as interest,
         coalesce(sum(l.debit_cents - l.credit_cents) filter (where l.component = 'principal'), 0)::bigint as principal
    into v_end
    from journal_lines l join journals j on j.id = l.journal_id
   where l.loan_id = v_loan.id and l.component is not null and j.entry_date <= v_to;

  return jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'status', v_loan.status, 'from', v_from, 'to', v_to,
    'opening_cents', v_opening,
    'debit_cents', coalesce((select sum((x ->> 'debit_cents')::bigint) from jsonb_array_elements(v_lines) x), 0),
    'credit_cents', coalesce((select sum((x ->> 'credit_cents')::bigint) from jsonb_array_elements(v_lines) x), 0),
    'closing_cents', v_end.penalty + v_end.interest + v_end.principal,
    'outstanding', jsonb_build_object('penalty', v_end.penalty, 'interest', v_end.interest, 'principal', v_end.principal),
    'due_date', v_loan.due_date,
    'next_penalty_on', (select next_penalty_on from loan_balance_rows() where loan_id = v_loan.id),
    'lines', v_lines);
end
$$;

revoke execute on function public.loan_statement(uuid, date, date) from public, anon, service_role;
grant execute on function public.loan_statement(uuid, date, date) to authenticated;

-- issue_document with options (statement period). The two-argument form delegates.
create or replace function public.issue_document(p_kind text, p_entity_id uuid, p_options jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_payment payments;
  v_item collaterals;
  v_customer customers;
  v_doc issued_documents;
  v_token text;
  v_number text;
  v_void boolean := false;
  v_reuse boolean := true;
  v_date date := business_today();
  v_amount bigint;
  v_customer_id uuid;
  v_details jsonb;
  v_from date := nullif(p_options ->> 'from', '')::date;
  v_to date := nullif(p_options ->> 'to', '')::date;
  v_role app_role := auth_role();
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if p_kind = 'loan_agreement' then
    select * into v_loan from loans where id = p_entity_id;
    if not found or v_loan.status not in ('approved', 'active', 'overdue', 'recovery', 'closed', 'written_off') then
      raise exception 'INVALID_STATE: the agreement is printed once the loan is approved' using errcode = '22023';
    end if;
    v_number := 'AGR-' || v_loan.loan_no;
    v_amount := v_loan.principal_cents + coalesce(v_loan.interest_cents, 0);
    v_customer_id := v_loan.customer_id;
    select * into v_doc from issued_documents
     where kind = p_kind and entity_id = p_entity_id and not is_void order by generated_at limit 1;
  elsif p_kind = 'receipt' then
    select * into v_payment from payments where id = p_entity_id;
    if not found then
      raise exception 'INVALID_STATE: the payment does not exist' using errcode = 'P0002';
    end if;
    v_number := v_payment.receipt_no;
    v_void := v_payment.status = 'voided';
    v_date := v_payment.received_on;
    v_amount := v_payment.amount_cents;
    v_customer_id := v_payment.customer_id;
    select * into v_doc from issued_documents where kind = p_kind and entity_id = p_entity_id;
  elsif p_kind = 'statement' then
    v_reuse := false;
    select * into v_loan from loans where id = p_entity_id;
    if found then
      if v_loan.disbursed_on is null then
        raise exception 'INVALID_STATE: a statement starts once the loan is paid out' using errcode = '22023';
      end if;
      v_details := loan_statement(v_loan.id, v_from, v_to);
      v_amount := (v_details ->> 'closing_cents')::bigint;
      v_customer_id := v_loan.customer_id;
      v_details := jsonb_build_object('scope', 'loan', 'loan_no', v_loan.loan_no,
                                      'from', v_details ->> 'from', 'to', v_details ->> 'to');
    else
      select * into v_customer from customers where id = p_entity_id;
      if not found then
        raise exception 'INVALID_STATE: no such loan or customer' using errcode = 'P0002';
      end if;
      v_amount := coalesce((select sum((loan_statement(l.id, null, v_to) ->> 'closing_cents')::bigint)
                              from loans l where l.customer_id = v_customer.id and l.disbursed_on is not null), 0);
      v_customer_id := v_customer.id;
      v_details := jsonb_build_object('scope', 'customer', 'customer_code', v_customer.code,
                                      'to', coalesce(v_to, business_today()));
    end if;
  elsif p_kind = 'demand_notice' then
    v_reuse := false;
    if v_role not in ('manager', 'ceo', 'loan_officer') then
      raise exception 'FORBIDDEN: a manager, the CEO or a loan officer prints demand notices' using errcode = '42501';
    end if;
    select * into v_loan from loans where id = p_entity_id;
    if not found or v_loan.status not in ('overdue', 'recovery') then
      raise exception 'INVALID_STATE: a demand notice is for an overdue loan' using errcode = '22023';
    end if;
    v_amount := (select penalty_cents + interest_cents + principal_cents from loan_owed(v_loan.id));
    v_customer_id := v_loan.customer_id;
    v_details := jsonb_build_object('loan_no', v_loan.loan_no, 'deadline',
      business_today() + coalesce((select (value #>> '{}')::int from settings where key = 'recovery.notice_days'), 7));
  elsif p_kind in ('collateral_receipt', 'collateral_release') then
    select * into v_item from collaterals where id = p_entity_id;
    if not found then
      raise exception 'INVALID_STATE: the item does not exist' using errcode = 'P0002';
    end if;
    if p_kind = 'collateral_release' and v_item.status <> 'released' then
      raise exception 'INVALID_STATE: the release letter is printed once the item is returned' using errcode = '22023';
    end if;
    v_number := case p_kind when 'collateral_receipt' then 'CR-' else 'RL-' end || v_item.code;
    v_amount := v_item.estimated_value_cents;
    v_customer_id := v_item.owner_customer_id;
    if p_kind = 'collateral_release' then
      v_date := (select (max(at) at time zone 'UTC')::date from collateral_events
                  where collateral_id = v_item.id and event_type = 'released');
    else
      v_date := (select (min(at) at time zone 'UTC')::date from collateral_events where collateral_id = v_item.id);
    end if;
    select * into v_doc from issued_documents where kind = p_kind and entity_id = p_entity_id;
  else
    raise exception 'INVALID_STATE: unknown document kind' using errcode = '22023';
  end if;

  if not v_reuse or v_doc.id is null then
    v_number := coalesce(v_number, next_number(p_kind));
    v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
    insert into issued_documents (kind, number, entity_id, token, generated_by, is_void, doc_date, amount_cents,
                                  customer_id, details)
    values (p_kind, v_number, p_entity_id, v_token, auth.uid(), v_void, v_date, v_amount, v_customer_id, v_details)
    returning * into v_doc;
    perform write_audit('document.issued', 'issued_document', v_doc.id::text, null,
      jsonb_build_object('kind', p_kind, 'number', v_doc.number, 'entity_id', p_entity_id, 'amount_cents', v_amount));
  end if;
  return jsonb_build_object('id', v_doc.id, 'kind', v_doc.kind, 'number', v_doc.number, 'token', v_doc.token,
                            'generated_at', v_doc.generated_at, 'generated_by', v_doc.generated_by,
                            'is_void', v_doc.is_void, 'doc_date', v_doc.doc_date, 'amount_cents', v_doc.amount_cents,
                            'details', v_doc.details);
end
$$;

create or replace function public.issue_document(p_kind text, p_entity_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$ select issue_document(p_kind, p_entity_id, '{}'::jsonb) $$;

revoke execute on function public.issue_document(text, uuid, jsonb), public.issue_document(text, uuid)
  from public, anon, service_role;
grant execute on function public.issue_document(text, uuid, jsonb), public.issue_document(text, uuid) to authenticated;

-- First letter of each word, the rest hidden: "Mariama Kollie" -> "M****** K*****".
create or replace function public.mask_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select string_agg(left(word, 1) || repeat('*', greatest(length(word) - 1, 1)), ' ' order by ord)
    from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality as w(word, ord)
   where word <> ''
$$;

-- /verify/[token] (SPEC 9; public): kind, number, date, amount, masked customer name, void. No other data.
create or replace function public.verify_document(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'kind', d.kind, 'number', d.number, 'date', coalesce(d.doc_date, (d.generated_at at time zone 'UTC')::date),
           'amount_cents', d.amount_cents, 'customer', mask_name(customer_display_name(c)), 'is_void', d.is_void)
    from issued_documents d left join customers c on c.id = d.customer_id
   where length(coalesce(p_token, '')) between 22 and 64 and d.token = p_token
$$;

revoke execute on function public.mask_name(text) from public, anon, authenticated, service_role;
revoke execute on function public.verify_document(text) from public, service_role;
grant execute on function public.verify_document(text) to anon, authenticated;
