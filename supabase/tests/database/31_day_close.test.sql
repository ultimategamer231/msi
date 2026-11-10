-- M8.3: day close and period lock (SPEC 5.10; FR-23; T-34).
begin;
\ir _helpers.psql
select plan(15);

insert into public.branches (code, name) values ('TD', 'Test Day Close');
select tests.create_staff('Officer TD', 'loan_officer', 'TD') as officer_id \gset
select tests.create_staff('Manager TD', 'manager') as manager_id \gset
select tests.create_staff('Cashier TD', 'cashier', 'TD') as cashier_id \gset
select tests.create_staff('Cashier Other', 'cashier', 'BR1') as other_cashier_id \gset
select tests.create_staff('Accountant TD', 'accountant') as accountant_id \gset
select id as branch_id from public.branches where code = 'TD' \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = 'true' where key = 'disbursement.check_funds';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.summary(p_user uuid, p_branch uuid, p_day date) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_user, format('select public.day_close_summary(%L, %L)::text', p_branch, p_day))::jsonb $$;

-- 10 Feb: opening cash 2,000.00.
select tests.set_day('2026-02-10');
select tests.value_as('authenticated', :'accountant_id', $$select public.request_capital_in('{"entry_date": "2026-02-10",
  "account": "1010-TD", "amount_cents": 200000, "memo": "Opening cash"}')::text$$) as cap \gset
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'cap'));

-- 11 Feb: a 500.00 payout and a 45.00 expense from the drawer.
select tests.set_day('2026-02-11');
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Hawa", "last_name": "Close", "phone": "0979 200 001",
  "id_type": "national_id", "id_number": "TD-200001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'TD-200001'),
  'product_id', :'product_id', 'principal_cents', 50000, 'term_months', 1)) as loan_id \gset
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
select tests.unbecome();
select tests.value_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5900",
  "amount_cents": 4500, "expense_date": "2026-02-11", "description": "Office supplies", "paid_now": true,
  "paid_from": "1010-TD", "branch_id": "%s"}')::text$$, :'branch_id'));

select tests.summary(:'cashier_id', :'branch_id', '2026-02-11') as s1 \gset
select results_eq(format($$select (%1$L::jsonb ->> 'opening_cents')::bigint, (%1$L::jsonb ->> 'out_cents')::bigint, (%1$L::jsonb ->> 'expected_cents')::bigint,
                          (select array_agg(x ->> 'category' order by ord) from jsonb_array_elements(%1$L::jsonb -> 'lines') with ordinality t(x, ord))$$, :'s1'),
  $$values (200000::bigint, 54500::bigint, 145500::bigint, '{disbursement,expense}'::text[])$$,
  'expected 1,455.00 = opening 2,000.00 − payout 500.00 − expense 45.00, from the ledger');
select matches(tests.try_as('authenticated', :'other_cashier_id', format($$select public.day_close_summary('%s', '2026-02-11')$$, :'branch_id')),
  '^FORBIDDEN', 'a cashier of another branch cannot close this branch');

-- Submit with a variance: a note is required.
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.submit_day_close('%s', '2026-02-11', 145000, '')$$, :'branch_id')),
  '^INVALID_STATE: give a reason', 'a variance needs a reason');
select tests.value_as('authenticated', :'cashier_id', format($$select public.submit_day_close('%s', '2026-02-11', 145000, 'Short change')::text$$, :'branch_id')) as close1 \gset
select results_eq(format($$select status, variance_cents from public.day_closes where id = '%s'$$, :'close1'),
  $$values ('submitted'::text, -500::bigint)$$, 'submitted with a variance of −5.00');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.submit_day_close('%s', '2026-02-11', 145000, 'Again')$$, :'branch_id')),
  '^INVALID_STATE', 'one close per branch per day');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.submit_day_close('%s', '2026-02-11', 145000, 'x')$$, :'branch_id')),
  '^FORBIDDEN', 'only the cashier submits');

-- T-34: approve, a payment that day is refused; reopen; it succeeds; a new close is needed.
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval((select id from public.approval_requests where entity_id = '%s'), 'approve', null)$$, :'close1'));
select results_eq(format($$select (select status from public.day_closes where id = '%s'), (select locked_through from public.period_locks where branch_id = '%s')$$, :'close1', :'branch_id'),
  $$values ('approved'::text, '2026-02-11'::date)$$, 'approved: the branch is locked through 11 Feb');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 20000, 'cash', null, null, 'close-key-0001')$$, :'loan_id')),
  '^PERIOD_LOCKED', 'T-34: a payment dated the closed day is refused');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.reopen_day_close('%s', 'Late payment')$$, :'close1')),
  '^FORBIDDEN', 'a cashier cannot reopen');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.reopen_day_close('%s', ' ')$$, :'close1')),
  '^INVALID_STATE', 'reopening needs a reason');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.reopen_day_close('%s', 'Payment arrived after the close')$$, :'close1')),
  null, 'the manager reopens the day');
select results_eq(format($$select (select status from public.day_closes where id = '%1$s'),
                                  (select locked_through from public.period_locks where branch_id = '%2$s'),
                                  (select count(*)::int from public.audit_log where action = 'day_close.reopened' and entity_id = '%1$s')$$, :'close1', :'branch_id'),
  $$values ('rejected'::text, null::date, 1)$$, 'T-34: the close is marked rejected, the lock is removed, and the reopen is audited');
select is(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 20000, 'cash', null, null, 'close-key-0002')$$, :'loan_id')),
  null, 'T-34: the payment now succeeds');
select is((tests.summary(:'cashier_id', :'branch_id', '2026-02-11') ->> 'expected_cents')::bigint, 165500::bigint,
  'the new count expects the payment too');
select tests.value_as('authenticated', :'cashier_id', format($$select public.submit_day_close('%s', '2026-02-11', 165500, null)::text$$, :'branch_id')) as close2 \gset
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval((select id from public.approval_requests where entity_id = '%s'), 'approve', null)$$, :'close2'));
select is((select locked_through from public.period_locks where branch_id = :'branch_id'), '2026-02-11'::date,
  'T-34: the new close locks the day again');

select * from finish();
rollback;
