-- M8.4: reports (SPEC 10.2; FR-24; T-26, T-27). Every figure comes from the ledger or the payment
-- records; pages only render. CEO, manager, accountant and admin (SPEC 4).

create or replace function public.require_report_role()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform require_role('ceo', 'manager', 'accountant', 'admin');
end
$$;
revoke execute on function public.require_report_role() from public, anon, authenticated, service_role;

-- Daily collections: posted payments received in the range, with branch, officer, method and the
-- field-cash handover status.
create or replace function public.report_collections(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object(
           'received_on', p.received_on, 'at', p.received_at, 'receipt_no', p.receipt_no, 'branch', b.name,
           'officer', pr.full_name, 'method', p.method, 'field', p.collected_in_field,
           'remittance_status', p.remittance_status, 'customer', customer_display_name(c), 'loan_no', ln.loan_no,
           'amount_cents', p.amount_cents, 'source', p.source)
         order by p.received_on, p.received_at), '[]'::jsonb)
    into v_rows
    from payments p
    join branches b on b.id = p.branch_id
    join profiles pr on pr.id = p.received_by
    join loans ln on ln.id = p.loan_id
    join customers c on c.id = ln.customer_id
   where p.status = 'posted' and p.received_on between p_from and p_to
     and (p_branch_id is null or p.branch_id = p_branch_id);
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows,
    'total_cents', (select coalesce(sum((r ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'field_pending_cents', (select coalesce(sum((r ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(v_rows) r
                             where r ->> 'remittance_status' = 'pending'));
end
$$;

-- Daily payments (money out): every credit to a cash, bank or mobile money account from payouts,
-- expenses paid, payees settled and surplus paid out (R1, R9, R9c, R7b), and voids/reversals of those.
create or replace function public.report_money_out(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', j.entry_date, 'at', j.posted_at, 'journal_no', j.journal_no,
           'type', case j.source_type when 'disbursement' then 'disbursement' when 'expense' then 'expense'
                                      when 'expense_settlement' then 'payee' when 'surplus_payout' then 'surplus'
                                      else 'other' end,
           'reference', coalesce(e.expense_no, ln.loan_no, j.journal_no),
           'description', coalesce(e.description, case when ln.id is not null then customer_display_name(c) end, j.memo),
           'branch', b.name, 'account', a.code, 'amount_cents', l.credit_cents)
         order by j.entry_date, j.posted_at), '[]'::jsonb)
    into v_rows
    from journal_lines l
    join journals j on j.id = l.journal_id
    join accounts a on a.id = l.account_id
    left join branches b on b.id = j.branch_id
    left join expenses e on e.id = j.source_id and j.source_type in ('expense', 'expense_settlement')
    left join loans ln on ln.id = j.source_id and j.source_type in ('disbursement', 'surplus_payout')
    left join customers c on c.id = ln.customer_id
   where l.credit_cents > 0 and (a.is_cash or a.code in ('1020', '1030'))
     and j.source_type in ('disbursement', 'expense', 'expense_settlement', 'surplus_payout')
     and j.entry_date between p_from and p_to
     and (p_branch_id is null or j.branch_id = p_branch_id);
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows,
    'total_cents', (select coalesce(sum((r ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(v_rows) r));
end
$$;

-- Overdue balances (mock-up 15): open loans past their due date, including loans in recovery, with
-- what is owed by component, age buckets 1–7, 8–30, 31+ (PAR) and the portfolio total.
create or replace function public.report_overdue(p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_portfolio bigint;
begin
  perform require_report_role();
  select coalesce(sum(b.total_out), 0) into v_portfolio
    from loan_balance_rows() b join loans ln on ln.id = b.loan_id
   where ln.status in ('active', 'overdue', 'recovery') and (p_branch_id is null or ln.branch_id = p_branch_id);
  select coalesce(jsonb_agg(row_data order by (row_data ->> 'days')::int desc, row_data ->> 'loan_no'), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'loan_id', ln.id, 'loan_no', ln.loan_no, 'borrower', customer_display_name(c), 'branch', br.name,
               'status', ln.status, 'days', b.days_overdue,
               'bucket', case when b.days_overdue <= 7 then '1_7' when b.days_overdue <= 30 then '8_30' else '31_plus' end,
               'principal_cents', b.principal_out, 'interest_cents', b.interest_out, 'penalty_cents', b.penalty_out,
               'total_cents', b.total_out, 'next_penalty_on', b.next_penalty_on, 'recovery_eligible', ln.recovery_eligible,
               'penalties_charged', (select count(*) from loan_penalty_events e
                                      where e.loan_id = ln.id and e.due_date_version = ln.due_date_version),
               'collateral', (select string_agg(co.description, ', ' order by co.code) from loan_collaterals lc
                                join collaterals co on co.id = lc.collateral_id
                               where lc.loan_id = ln.id and lc.status in ('pledged', 'seized')),
               'collateral_value_cents', (select coalesce(sum(co.estimated_value_cents), 0) from loan_collaterals lc
                                            join collaterals co on co.id = lc.collateral_id
                                           where lc.loan_id = ln.id and lc.status in ('pledged', 'seized'))) as row_data
        from loan_balance_rows() b
        join loans ln on ln.id = b.loan_id
        join customers c on c.id = ln.customer_id
        join branches br on br.id = ln.branch_id
       where ln.status in ('overdue', 'recovery') and b.days_overdue > 0 and b.total_out > 0
         and (p_branch_id is null or ln.branch_id = p_branch_id)
    ) rows_data;
  return jsonb_build_object('as_of', business_today(), 'rows', v_rows, 'portfolio_cents', v_portfolio,
    'total_cents', (select coalesce(sum((r ->> 'total_cents')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'buckets', (select coalesce(jsonb_object_agg(bucket, totals), '{}'::jsonb) from (
       select r ->> 'bucket' as bucket,
              jsonb_build_object('loans', count(*), 'principal_cents', sum((r ->> 'principal_cents')::bigint),
                                 'interest_cents', sum((r ->> 'interest_cents')::bigint),
                                 'penalty_cents', sum((r ->> 'penalty_cents')::bigint),
                                 'total_cents', sum((r ->> 'total_cents')::bigint)) as totals
         from jsonb_array_elements(v_rows) r group by 1) grouped));
end
$$;

-- Account balances over a period (income/expense) or to a date (balance sheet), from the ledger.
create or replace function public.account_movements(p_from date, p_to date, p_branch_id uuid default null)
returns table (code text, name text, type account_type, debit_cents bigint, credit_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.code, a.name, a.type, coalesce(sum(l.debit_cents), 0)::bigint, coalesce(sum(l.credit_cents), 0)::bigint
    from accounts a
    join journal_lines l on l.account_id = a.id
    join journals j on j.id = l.journal_id
   where j.entry_date <= p_to and (p_from is null or j.entry_date >= p_from)
     and (p_branch_id is null or j.branch_id = p_branch_id)
   group by a.code, a.name, a.type
$$;
revoke execute on function public.account_movements(date, date, uuid) from public, anon, authenticated, service_role;

-- Profit and loss (accrual basis): income and expense accounts for the period, net profit.
create or replace function public.report_profit_loss(p_from date, p_to date, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_income jsonb;
  v_expense jsonb;
  v_income_total bigint;
  v_expense_total bigint;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount_cents', credit_cents - debit_cents) order by code), '[]'::jsonb),
         coalesce(sum(credit_cents - debit_cents), 0)
    into v_income, v_income_total
    from account_movements(p_from, p_to, p_branch_id) where type = 'income';
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount_cents', debit_cents - credit_cents) order by code), '[]'::jsonb),
         coalesce(sum(debit_cents - credit_cents), 0)
    into v_expense, v_expense_total
    from account_movements(p_from, p_to, p_branch_id) where type = 'expense';
  return jsonb_build_object('from', p_from, 'to', p_to, 'income', v_income, 'income_cents', v_income_total,
                            'expenses', v_expense, 'expense_cents', v_expense_total,
                            'net_cents', v_income_total - v_expense_total);
end
$$;

-- Balance sheet as at a date (company-wide): assets, liabilities, equity with retained earnings
-- computed as income less expenses to date (SPEC 6.1); the check is Assets = Liabilities + Equity.
create or replace function public.report_balance_sheet(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assets jsonb;
  v_liabilities jsonb;
  v_equity jsonb;
  v_asset_total bigint;
  v_liability_total bigint;
  v_equity_total bigint;
  v_retained bigint;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount_cents', debit_cents - credit_cents) order by code)
                    filter (where debit_cents <> credit_cents), '[]'::jsonb),
         coalesce(sum(debit_cents - credit_cents), 0)
    into v_assets, v_asset_total from account_movements(null, p_as_of) where type = 'asset';
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount_cents', credit_cents - debit_cents) order by code)
                    filter (where debit_cents <> credit_cents), '[]'::jsonb),
         coalesce(sum(credit_cents - debit_cents), 0)
    into v_liabilities, v_liability_total from account_movements(null, p_as_of) where type = 'liability';
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount_cents', credit_cents - debit_cents) order by code)
                    filter (where debit_cents <> credit_cents), '[]'::jsonb),
         coalesce(sum(credit_cents - debit_cents), 0)
    into v_equity, v_equity_total from account_movements(null, p_as_of) where type = 'equity';
  select coalesce(sum(credit_cents - debit_cents), 0)                    -- income less expenses
    into v_retained from account_movements(null, p_as_of) where type in ('income', 'expense');
  return jsonb_build_object('as_of', p_as_of, 'assets', v_assets, 'asset_cents', v_asset_total,
                            'liabilities', v_liabilities, 'liability_cents', v_liability_total,
                            'equity', v_equity, 'retained_cents', v_retained,
                            'equity_cents', v_equity_total + v_retained,
                            'balanced', v_asset_total = v_liability_total + v_equity_total + v_retained);
end
$$;

-- Trial balance as at a date: every account's debit and credit totals and the check.
create or replace function public.report_trial_balance(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_debit bigint;
  v_credit bigint;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'type', type,
                                               'debit_cents', debit_cents, 'credit_cents', credit_cents) order by code), '[]'::jsonb),
         coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    into v_rows, v_debit, v_credit
    from account_movements(null, p_as_of);
  return jsonb_build_object('as_of', p_as_of, 'rows', v_rows, 'debit_cents', v_debit, 'credit_cents', v_credit,
                            'balanced', v_debit = v_credit);
end
$$;

-- Cash position as at a date: each branch cash drawer, field cash per officer, bank, mobile money.
create or replace function public.report_cash_position(p_as_of date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_accounts jsonb;
  v_field jsonb;
begin
  perform require_report_role();
  select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'branch', b.name,
                                               'balance_cents', coalesce(m.balance, 0)) order by a.code), '[]'::jsonb)
    into v_accounts
    from accounts a
    left join branches b on b.id = a.branch_id
    left join lateral (select sum(l.debit_cents - l.credit_cents) as balance from journal_lines l
                         join journals j on j.id = l.journal_id
                        where l.account_id = a.id and j.entry_date <= p_as_of) m on true
   where a.active and (a.is_cash or a.code in ('1015', '1020', '1030'));
  select coalesce(jsonb_agg(jsonb_build_object('officer', pr.full_name, 'balance_cents', f.balance) order by pr.full_name), '[]'::jsonb)
    into v_field
    from (select l.staff_id, sum(l.debit_cents - l.credit_cents) as balance from journal_lines l
            join journals j on j.id = l.journal_id join accounts a on a.id = l.account_id
           where a.code = '1015' and j.entry_date <= p_as_of group by l.staff_id
          having sum(l.debit_cents - l.credit_cents) <> 0) f
    join profiles pr on pr.id = f.staff_id;
  return jsonb_build_object('as_of', p_as_of, 'accounts', v_accounts, 'field', v_field,
    'total_cents', (select coalesce(sum((r ->> 'balance_cents')::bigint), 0) from jsonb_array_elements(v_accounts) r));
end
$$;

do $$
declare f text;
begin
  foreach f in array array['report_collections(date, date, uuid)', 'report_money_out(date, date, uuid)',
                           'report_overdue(uuid)', 'report_profit_loss(date, date, uuid)',
                           'report_balance_sheet(date)', 'report_trial_balance(date)', 'report_cash_position(date)'] loop
    execute format('revoke execute on function public.%s from public, anon, service_role', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
