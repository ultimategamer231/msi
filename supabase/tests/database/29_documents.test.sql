-- M7.1: statements and documents (SPEC 10.1, 9 /verify; FR-14, FR-25).
begin;
\ir _helpers.psql
select plan(17);

insert into public.branches (code, name) values ('TS', 'Test Statements');
select tests.create_staff('Officer TS', 'loan_officer', 'TS') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TS', 'cashier', 'TS') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = '7' where key = 'recovery.notice_days';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.stmt(p_user uuid, p_loan uuid, p_from date, p_to date) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_user,
    format('select public.loan_statement(%L, %L, %L)::text', p_loan, p_from, p_to))::jsonb $$;

-- A loan of 100000 paid out 05 Jan 2026, a 24000 penalty on 12 Feb, 50000 paid on 14 Feb.
select tests.set_day('2026-01-05');
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Mariama", "last_name": "Statement", "phone": "0979 100 001",
  "id_type": "national_id", "id_number": "TS-100001"}')$$);
select id as customer_id from public.customers where id_number = 'TS-100001' \gset
select tests.become('authenticated', :'officer_id');
select public.register_collateral(jsonb_build_object('owner_customer_id', :'customer_id', 'type', 'electronics',
  'description', 'Generator', 'serial_no', 'TS-GEN-1', 'estimated_value_cents', 140000, 'location_note', 'Safe')) as item_id \gset
select public.create_loan_draft(jsonb_build_object('customer_id', :'customer_id', 'product_id', :'product_id',
  'principal_cents', 100000, 'term_months', 1)) as loan_id \gset
select public.link_collateral(:'loan_id', :'item_id');
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
select tests.unbecome();
select tests.set_day('2026-02-12');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select tests.set_day('2026-02-14');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 50000, 'cash', null, null, 'stmt-key-0001')$$, :'loan_id'));

-- The whole life of the loan.
select tests.stmt(:'manager_id', :'loan_id', null, null) as full_stmt \gset
select is((:'full_stmt'::jsonb ->> 'opening_cents')::bigint, 0::bigint, 'from the payout the opening balance is 0');
select is((select array_agg((x ->> 'balance_cents')::bigint order by ord) from jsonb_array_elements(:'full_stmt'::jsonb -> 'lines') with ordinality as t(x, ord)),
  '{120000,144000,94000}'::bigint[], 'running balance: payout 120000, penalty 144000, payment 94000');
select is((select array_agg(x ->> 'source_type' order by ord) from jsonb_array_elements(:'full_stmt'::jsonb -> 'lines') with ordinality as t(x, ord)),
  '{disbursement,penalty,payment}'::text[], 'every movement is listed in order');
select results_eq(format($$select (%L::jsonb ->> 'closing_cents')::bigint, (select penalty_cents + interest_cents + principal_cents from public.loan_owed('%s'))$$,
                         :'full_stmt', :'loan_id'),
  $$values (94000::bigint, 94000::bigint)$$, 'the closing balance equals the ledger');
select is(:'full_stmt'::jsonb -> 'outstanding', '{"penalty": 0, "interest": 0, "principal": 94000}'::jsonb, 'outstanding by component');
select results_eq(format($$select (%1$L::jsonb ->> 'debit_cents')::bigint, (%1$L::jsonb ->> 'credit_cents')::bigint$$, :'full_stmt'),
  $$values (144000::bigint, 50000::bigint)$$, 'totals of debits and credits');

-- A period: the opening balance carries what came before.
select tests.stmt(:'manager_id', :'loan_id', '2026-02-13', '2026-02-28') as part_stmt \gset
select results_eq(format($$select (%1$L::jsonb ->> 'opening_cents')::bigint, jsonb_array_length(%1$L::jsonb -> 'lines'), (%1$L::jsonb ->> 'closing_cents')::bigint$$, :'part_stmt'),
  $$values (144000::bigint, 1, 94000::bigint)$$, 'from 13 Feb: opening 144000, one payment, closing 94000');
select matches(tests.try_as('anon', null, format($$select public.loan_statement('%s')$$, :'loan_id')), '^permission denied', 'not public');

-- Every loan in the database: statement closing = ledger balance (SPEC 13, M7).
select is(tests.value_as('authenticated', :'manager_id', $$select count(*)::text from public.loans l
  where l.disbursed_on <= public.business_today()   -- rows from other runs may be paid out after the test clock
    and (public.loan_statement(l.id) ->> 'closing_cents')::bigint
        <> (select b.total_out from public.loan_balances b where b.loan_id = l.id)$$),
  '0', 'for every paid-out loan the statement closing balance equals the ledger');

-- Documents: a statement gets a new number each time, with the amount for verification.
select tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('statement', '%s')::text$$, :'loan_id')) as doc1 \gset
select tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('statement', '%s')::text$$, :'loan_id')) as doc2 \gset
select results_eq(format($$select %1$L::jsonb ->> 'number' ~ '^STM-[0-9]{6}$', %1$L::jsonb ->> 'number' <> %2$L::jsonb ->> 'number', (%1$L::jsonb ->> 'amount_cents')::bigint$$, :'doc1', :'doc2'),
  $$values (true, true, 94000::bigint)$$, 'STM-… numbers, a new one per print, amount = closing balance');

-- Demand notice: overdue loans only, officers, managers and the CEO.
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.issue_document('demand_notice', '%s')$$, :'loan_id')),
  '^FORBIDDEN', 'a cashier does not issue demand notices');
select tests.value_as('authenticated', :'officer_id', format($$select public.issue_document('demand_notice', '%s')::text$$, :'loan_id')) as notice \gset
select results_eq(format($$select %1$L::jsonb ->> 'number' ~ '^DN-[0-9]{6}$', (%1$L::jsonb ->> 'amount_cents')::bigint, %1$L::jsonb -> 'details' ->> 'deadline'$$, :'notice'),
  $$values (true, 94000::bigint, '2026-02-21'::text)$$, 'DN-…, what is owed, deadline today + recovery.notice_days');

-- Collateral receipt: one per item; release letter only once returned.
select is((tests.value_as('authenticated', :'cashier_id', format($$select public.issue_document('collateral_receipt', '%s')::text$$, :'item_id'))::jsonb) ->> 'token',
          (tests.value_as('authenticated', :'officer_id', format($$select public.issue_document('collateral_receipt', '%s')::text$$, :'item_id'))::jsonb) ->> 'token',
  'a reprinted collateral receipt keeps its number and token');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.issue_document('collateral_release', '%s')$$, :'item_id')),
  '^INVALID_STATE', 'no release letter while the item is held');

-- Public verification: only number, date, amount, masked name and void.
select is(tests.value_as('anon', null, format($$select public.verify_document(%L)::text$$, (:'doc1'::jsonb) ->> 'token'))::jsonb,
  jsonb_build_object('kind', 'statement', 'number', (:'doc1'::jsonb) ->> 'number', 'date', '2026-02-14', 'amount_cents', 94000,
                     'customer', 'M****** S********', 'is_void', false),
  'anyone with the QR code sees the number, date, amount and a masked name');
select is(tests.value_as('anon', null, $$select public.verify_document('not-a-real-token-at-all-000')::text$$), null,
  'an unknown token shows nothing');
select is(tests.value_as('anon', null, $$select coalesce(public.verify_document('x')::text, 'none')$$), 'none',
  'a short token is not even looked up');

select * from finish();
rollback;
