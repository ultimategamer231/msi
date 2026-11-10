-- M9.2: role-aware dashboard (SPEC 9 /dashboard; FR-29; mock-up 05). One read for the signed-in
-- staff member; the figures come from the ledger, payments and the same report functions.

-- What a manager, the CEO or the accountant should look at now (mock-up 05 "Needs attention").
create or replace function public.dashboard_attention()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(item order by ord, sort_key), '[]'::jsonb) from (
    -- Open recovery cases with their last step.
    select 1 as ord, rc.case_no as sort_key,
           jsonb_build_object('kind', 'recovery', 'case_id', rc.id, 'case_no', rc.case_no, 'stage', rc.stage,
                              'loan_no', ln.loan_no, 'borrower', customer_display_name(c),
                              'last_on', (select max(action_date) from recovery_actions a where a.case_id = rc.id)) as item
      from recovery_cases rc join loans ln on ln.id = rc.loan_id join customers c on c.id = ln.customer_id
     where rc.closed_on is null
    union all
    -- Loans above the manager limit waiting for the CEO.
    select 2, r.requested_at::text,
           jsonb_build_object('kind', 'ceo_loan', 'request_id', r.id, 'borrower', r.payload ->> 'customer_name',
                              'loan_no', r.payload ->> 'loan_no', 'amount_cents', (r.payload ->> 'principal_cents')::bigint,
                              'requested_by', p.full_name,
                              'limit_cents', (select (value #>> '{}')::bigint from settings where key = 'approvals.loan_manager_limit_cents'))
      from approval_requests r join profiles p on p.id = r.requested_by
     where r.type = 'loan_approval' and r.status = 'pending' and r.required_role = 'ceo'
    union all
    -- Day closes waiting for review.
    select 3, d.close_date::text,
           jsonb_build_object('kind', 'day_close_review', 'branch', b.name, 'branch_id', b.id, 'date', d.close_date,
                              'variance_cents', d.variance_cents)
      from day_closes d join branches b on b.id = d.branch_id
     where d.status = 'submitted'
    union all
    -- Yesterday's cash day not closed in a branch whose drawer moved.
    select 3, b.code,
           jsonb_build_object('kind', 'day_not_closed', 'branch', b.name, 'branch_id', b.id, 'date', business_today() - 1)
      from branches b join accounts a on a.branch_id = b.id and a.is_cash
     where b.active
       and exists (select 1 from journal_lines l join journals j on j.id = l.journal_id
                    where l.account_id = a.id and j.entry_date = business_today() - 1)
       and not exists (select 1 from day_closes d where d.branch_id = b.id and d.close_date = business_today() - 1
                                                    and d.status in ('submitted', 'approved'))
    union all
    -- Field cash still with an officer.
    select 4, pr.full_name,
           jsonb_build_object('kind', 'field_cash', 'officer', pr.full_name, 'amount_cents', sum(p.amount_cents),
                              'since', min(p.received_on), 'receipts', count(*))
      from payments p join profiles pr on pr.id = p.received_by
     where p.collected_in_field and p.remittance_status = 'pending' and p.status = 'posted'
     group by pr.full_name
  ) items
$$;
revoke execute on function public.dashboard_attention() from public, anon, authenticated, service_role;

-- Loans due today or past due, recovery included (mock-up 05 "Due and overdue now").
create or replace function public.dashboard_due_now(p_officer uuid default null, p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_data order by days, loan_no), '[]'::jsonb) from (
    select b.days_overdue as days, ln.loan_no,
           jsonb_build_object('loan_id', ln.id, 'loan_no', ln.loan_no, 'borrower', customer_display_name(c),
                              'branch', br.name, 'due_date', ln.due_date, 'owes_cents', b.total_out,
                              'days', b.days_overdue, 'status', ln.status) as row_data
      from loan_balance_rows() b join loans ln on ln.id = b.loan_id
      join customers c on c.id = ln.customer_id join branches br on br.id = ln.branch_id
     where ln.status in ('active', 'overdue', 'recovery') and ln.due_date <= business_today() and b.total_out > 0
       and (p_officer is null or ln.officer_id = p_officer)
     order by b.days_overdue, ln.loan_no
     limit p_limit
  ) rows_data
$$;
revoke execute on function public.dashboard_due_now(uuid, int) from public, anon, authenticated, service_role;

create or replace function public.dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('admin', 'ceo', 'manager', 'accountant', 'cashier', 'loan_officer');
  v_me uuid := auth.uid();
  v_branch uuid := auth_branch();
  v_today date := business_today();
  v_result jsonb := jsonb_build_object('role', v_role, 'today', v_today);
  v_collected_on date;
begin
  if v_role = 'loan_officer' then
    return v_result || jsonb_build_object(
      'due_today', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(b.total_out), 0))
                      from loan_balance_rows() b join loans ln on ln.id = b.loan_id
                     where ln.officer_id = v_me and ln.status = 'active' and ln.due_date = v_today and b.total_out > 0),
      'overdue', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(b.total_out), 0))
                    from loan_balance_rows() b join loans ln on ln.id = b.loan_id
                   where ln.officer_id = v_me and ln.status in ('overdue', 'recovery') and b.total_out > 0),
      'pending_remittance', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                               from payments where received_by = v_me and collected_in_field
                                and remittance_status = 'pending' and status = 'posted'),
      'due_now', dashboard_due_now(v_me, 10));
  end if;

  if v_role = 'cashier' then
    return v_result || jsonb_build_object(
      'collections_today', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                              from payments where branch_id = v_branch and received_on = v_today and status = 'posted'),
      'drawer', (select jsonb_build_object('expected_cents', (s ->> 'expected_cents')::bigint, 'close', s -> 'close')
                   from (select day_close_summary(v_branch, v_today) as s) x
                  where v_branch is not null),
      'field_unconfirmed', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                              from payments where branch_id = v_branch and collected_in_field
                               and remittance_status = 'pending' and status = 'posted'),
      'yesterday_closed', exists (select 1 from day_closes where branch_id = v_branch and close_date = v_today - 1
                                                          and status in ('submitted', 'approved')));
  end if;

  if v_role in ('manager', 'ceo') then
    select max(received_on) into v_collected_on from payments
     where status = 'posted' and received_on between v_today - 7 and v_today;
    return v_result || jsonb_build_object(
      'portfolio', (select jsonb_build_object('cents', coalesce(sum(b.total_out), 0), 'loans', count(*),
                                              'branches', count(distinct ln.branch_id))
                      from loan_balance_rows() b join loans ln on ln.id = b.loan_id
                     where ln.status in ('active', 'overdue', 'recovery') and b.total_out > 0),
      'overdue', report_overdue(null) - 'rows',
      'collected', case when v_collected_on is null then null else
                     report_collections(v_collected_on, v_collected_on, null) - 'rows'
                     || jsonb_build_object('date', v_collected_on,
                          'count', (select count(*) from payments where status = 'posted' and received_on = v_collected_on)) end,
      'approvals', (select jsonb_build_object('count', count(*), 'oldest', min(requested_at))
                      from approval_requests r
                     where r.status = 'pending' and r.requested_by <> v_me
                       and (r.required_role = 'manager' or v_role = 'ceo')),
      'attention', dashboard_attention(),
      'due_now', dashboard_due_now(null, 10));
  end if;

  if v_role = 'accountant' then
    return v_result || jsonb_build_object(
      'cash', report_cash_position(v_today),
      'income_month', report_profit_loss(date_trunc('month', v_today)::date, v_today, null) - 'income' - 'expenses',
      'expenses_waiting', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                             from expenses where status = 'pending_approval'),
      'owed_to_payees', (select coalesce(sum(owed_cents), 0) from payee_balances),
      'attention', dashboard_attention());
  end if;

  -- admin
  return v_result || jsonb_build_object(
    'go_live', (select value #>> '{}' from settings where key = 'migration.go_live_date'),
    'last_run', (select jsonb_build_object('run_date', run_date, 'finished_at', finished_at, 'source', source)
                   from accrual_runs order by started_at desc limit 1),
    'users', (select count(*) from profiles where active),
    'branches', (select count(*) from branches where active));
end
$$;
revoke execute on function public.dashboard_data() from public, anon, service_role;
grant execute on function public.dashboard_data() to authenticated;
