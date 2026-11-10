-- M8.4: reports (SPEC 10.2; FR-24; T-26, T-27).
begin;
\ir _helpers.psql
select plan(12);

insert into public.branches (code, name) values ('TR', 'Test Reports');
select tests.create_staff('Officer TR', 'loan_officer', 'TR') as officer_id \gset
select tests.create_staff('Manager TR', 'manager') as manager_id \gset
select tests.create_staff('CEO TR', 'ceo') as ceo_id \gset
select tests.create_staff('Accountant TR', 'accountant') as accountant_id \gset
select tests.create_staff('Cashier TR', 'cashier', 'TR') as cashier_id \gset
select id as branch_id from public.branches where code = 'TR' \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.report(p_user uuid, p_sql text) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_user, format('select (%s)::text', p_sql))::jsonb $$;
create function tests.secured_loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid; v_item uuid;
begin
  perform tests.set_day('2026-01-05');
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Report', 'last_name', p_id_number,
    'phone', '0981 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_item := public.register_collateral(jsonb_build_object('owner_customer_id', v_customer, 'type', 'vehicle',
    'description', 'Car ' || p_id_number, 'plate_no', p_id_number, 'estimated_value_cents', 420000, 'location_note', 'Yard'));
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', 100000, 'term_months', 1));
  perform public.link_collateral(v_id, v_item);
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;

-- A full run: payouts, penalties, a payment, an expense, a collateral sale and a write-off.
select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TR-100001', :'product_id') as loan_a \gset
select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TR-100002', :'product_id') as loan_b \gset
select collateral_id as item_a from public.loan_collaterals where loan_id = :'loan_a' \gset
select tests.set_day('2026-02-14');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 50000, 'cash', null, null, 'report-key-0001')$$, :'loan_b'));
select tests.value_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5900",
  "amount_cents": 4500, "expense_date": "2026-02-14", "description": "Office supplies", "paid_now": true,
  "paid_from": "1010-TR", "branch_id": "%s"}')::text$$, :'branch_id'));
select tests.set_day('2026-03-07');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select tests.value_as('authenticated', :'manager_id', format($$select public.open_recovery_case('%s', 'No reply')::text$$, :'loan_a')) as case_a \gset
select tests.try_as('authenticated', :'manager_id', format($$select public.record_collateral_sale('%s', '%s', 200000, 'Moses Doe', 'cash')$$, :'case_a', :'item_a'));
select tests.try_as('authenticated', :'accountant_id', format($$select public.request_write_off('%s', 'Sale did not cover the balance')$$, :'loan_a'));
select tests.try_as('authenticated', :'ceo_id', format($$select public.decide_approval(
  (select id from public.approval_requests where type = 'write_off' and entity_id = '%s'), 'approve', 'Board minute 2026/03-4')$$, :'loan_a'));

-- T-26 and T-27 on the whole ledger.
select tests.report(:'accountant_id', $$public.report_trial_balance('2026-03-07')$$) as tb \gset
select results_eq(format($$select (%1$L::jsonb ->> 'balanced')::boolean, (%1$L::jsonb ->> 'debit_cents') = (%1$L::jsonb ->> 'credit_cents')$$, :'tb'),
  $$values (true, true)$$, 'T-26: the trial balance debits equal credits');
select tests.report(:'ceo_id', $$public.report_balance_sheet('2026-03-07')$$) as bs \gset
select results_eq(format($$select (%1$L::jsonb ->> 'balanced')::boolean,
                                  (%1$L::jsonb ->> 'asset_cents')::bigint - (%1$L::jsonb ->> 'liability_cents')::bigint - (%1$L::jsonb ->> 'equity_cents')::bigint$$, :'bs'),
  $$values (true, 0::bigint)$$, 'T-27: assets = liabilities + equity with computed retained earnings');
select is((:'bs'::jsonb ->> 'retained_cents')::bigint,
          (tests.report(:'manager_id', $$public.report_profit_loss(null, '2026-03-07')$$) ->> 'net_cents')::bigint,
  'retained earnings equal the profit to date');

-- Profit and loss for this branch: interest, penalties, write-off and the expense.
select tests.report(:'manager_id', format($$public.report_profit_loss('2026-01-01', '2026-03-07', %L)$$, :'branch_id')) as pl \gset
select results_eq(format($$select (select (x ->> 'amount_cents')::bigint from jsonb_array_elements(%1$L::jsonb -> 'income') x where x ->> 'code' = '4000'),
                                  (select (x ->> 'amount_cents')::bigint from jsonb_array_elements(%1$L::jsonb -> 'expenses') x where x ->> 'code' = '5050'),
                                  (select (x ->> 'amount_cents')::bigint from jsonb_array_elements(%1$L::jsonb -> 'expenses') x where x ->> 'code' = '5900')$$, :'pl'),
  $$values (40000::bigint, 48832::bigint, 4500::bigint)$$, 'P&L: interest 400.00, bad debts 488.32, other expenses 45.00');

-- Collections and money out for the branch.
select tests.report(:'accountant_id', format($$public.report_collections('2026-02-14', '2026-02-14', %L)$$, :'branch_id')) as col \gset
select results_eq(format($$select (%1$L::jsonb ->> 'total_cents')::bigint, jsonb_array_length(%1$L::jsonb -> 'rows'),
                                  %1$L::jsonb -> 'rows' -> 0 ->> 'method'$$, :'col'),
  $$values (50000::bigint, 1, 'cash'::text)$$, 'collections on 14 Feb: one cash payment of 500.00');
select tests.report(:'accountant_id', format($$public.report_money_out('2026-01-01', '2026-03-07', %L)$$, :'branch_id')) as out \gset
select results_eq(format($$select (%1$L::jsonb ->> 'total_cents')::bigint,
                                  (select array_agg(x ->> 'type' order by ord) from jsonb_array_elements(%1$L::jsonb -> 'rows') with ordinality t(x, ord))$$, :'out'),
  $$values (204500::bigint, '{disbursement,disbursement,expense}'::text[])$$, 'money out: two payouts and the expense');

-- Overdue: loan B is overdue with penalties; loan A is written off and gone.
select tests.report(:'manager_id', format($$public.report_overdue(%L)$$, :'branch_id')) as od \gset
select results_eq(format($$select jsonb_array_length(%1$L::jsonb -> 'rows'), %1$L::jsonb -> 'rows' -> 0 ->> 'bucket',
                                  (%1$L::jsonb -> 'rows' -> 0 ->> 'total_cents')::bigint = (%1$L::jsonb ->> 'portfolio_cents')::bigint$$, :'od'),
  $$values (1, '8_30'::text, true)$$, 'overdue: one loan, 30 days (8–30 bucket, B-18), the whole open portfolio of the branch');
select is((:'od'::jsonb -> 'buckets' -> '8_30' ->> 'total_cents')::bigint, (:'od'::jsonb ->> 'total_cents')::bigint,
  'the bucket totals add up to the overdue total');
select is((:'od'::jsonb -> 'rows' -> 0 ->> 'total_cents')::bigint,
          tests.value_as('authenticated', :'manager_id', format($$select total_out::text from public.loan_balance_rows() where loan_id = '%s'$$, :'loan_b'))::bigint,
  'the overdue amount is the ledger balance');

-- Cash position: the branch drawer equals its ledger balance.
select tests.report(:'accountant_id', $$public.report_cash_position('2026-03-07')$$) as cash \gset
select is((select (x ->> 'balance_cents')::bigint from jsonb_array_elements(:'cash'::jsonb -> 'accounts') x where x ->> 'code' = '1010-TR'),
          -204500::bigint + 50000 + 200000, 'cash position: drawer = payouts out, payment and sale in');

select matches(tests.try_as('authenticated', :'cashier_id', $$select public.report_trial_balance('2026-03-07')$$),
  '^FORBIDDEN', 'a cashier cannot read the financial reports');
select matches(tests.try_as('authenticated', :'officer_id', $$select public.report_overdue(null)$$),
  '^FORBIDDEN', 'nor can a loan officer');

select * from finish();
rollback;
