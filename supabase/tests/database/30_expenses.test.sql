-- M8.1: payees and expenses (SPEC 7.6, 4; R9, R9b, R9c; FR-22).
begin;
\ir _helpers.psql
select plan(15);

insert into public.branches (code, name) values ('TE', 'Test Expenses');
select tests.create_staff('Manager TE', 'manager', 'TE') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Accountant TE', 'accountant') as accountant_id \gset
select tests.create_staff('Cashier TE', 'cashier', 'TE') as cashier_id \gset
select id as branch_id from public.branches where code = 'TE' \gset
update public.settings set value = '{"at": "2026-02-11T13:40:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = '10000' where key = 'approvals.expense_limit_cents';
update public.settings set value = 'true' where key = 'disbursement.check_funds';
delete from public.period_locks;

create function tests.cash() returns bigint language sql as $$
  select coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.code = '1010-TE' $$;

-- Opening cash through an approved capital entry.
select tests.value_as('authenticated', :'accountant_id', $$select public.request_capital_in('{"entry_date": "2026-02-10",
  "account": "1010-TE", "amount_cents": 100000, "memo": "Opening cash"}')::text$$) as cap \gset
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, :'cap'));

-- Payees.
select matches(tests.try_as('authenticated', :'cashier_id', $$select public.save_payee(null, '{"name": "Kpelle Stationers"}')$$),
  '^FORBIDDEN', 'a cashier does not manage payees');
select tests.value_as('authenticated', :'accountant_id',
  $$select public.save_payee(null, '{"name": "Kpelle Stationers", "type": "supplier", "phone": "0770 100 200"}')::text$$) as payee_id \gset
select matches(tests.try_as('authenticated', :'manager_id', $$select public.save_payee(null, '{"name": " kpelle stationers "}')$$),
  'already exists', 'payee names are unique ignoring case and spaces');

-- R9: at or below the limit, paid now, posts at once.
select tests.value_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5900",
  "amount_cents": 4500, "expense_date": "2026-02-11", "description": "Office supplies", "paid_now": true,
  "paid_from": "1010-TE", "branch_id": "%s"}')::text$$, :'branch_id')) as small \gset
select results_eq(format($$select %1$L::jsonb ->> 'status', %1$L::jsonb ->> 'expense_no' ~ '^EXP-TE-[0-9]{6}$'$$, :'small'),
  $$values ('paid'::text, true)$$, 'R9: a $45.00 expense is paid at once with an EXP-<branch> number');
select results_eq(format($$select a.code, l.debit_cents, l.credit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
                           where l.journal_id = (select journal_id from public.expenses where id = '%s') order by l.line_no$$, (:'small'::jsonb) ->> 'expense_id'),
  $$values ('5900'::text, 4500::bigint, 0::bigint), ('1010-TE', 0, 4500)$$, 'Dr expense, Cr branch cash');
select is(tests.cash(), 95500::bigint, 'the drawer is down $45.00');

-- Above the limit: waits for a manager who did not request it.
select tests.value_as('authenticated', :'accountant_id', format($$select public.create_expense('{"account": "5040",
  "amount_cents": 24000, "expense_date": "2026-02-11", "description": "Court filing fee, LN-BR3-00004", "paid_now": true,
  "paid_from": "1010-TE", "branch_id": "%s"}')::text$$, :'branch_id')) as big \gset
select is((:'big'::jsonb) ->> 'status', 'pending_approval', 'a $240.00 expense waits for approval');
select is(tests.cash(), 95500::bigint, 'nothing is posted while it waits');
select is((select required_role::text from public.approval_requests where id = ((:'big'::jsonb) ->> 'request_id')::uuid), 'manager',
  'a manager decides it');
select tests.value_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5010",
  "amount_cents": 50000, "expense_date": "2026-02-11", "description": "February rent", "paid_now": true,
  "paid_from": "1010-TE", "branch_id": "%s"}')::text$$, :'branch_id')) as rent \gset
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, (:'rent'::jsonb) ->> 'request_id')),
  '^SELF_APPROVAL', 'the manager who recorded it cannot approve it');
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval('%s', 'approve', null)$$, (:'big'::jsonb) ->> 'request_id'));
select results_eq(format($$select status from public.expenses where id = '%s'$$, (:'big'::jsonb) ->> 'expense_id'),
  $$values ('paid'::text)$$, 'approved, it is paid');
select tests.try_as('authenticated', :'manager2_id', format($$select public.decide_approval('%s', 'reject', 'Rent is paid by the head office')$$, (:'rent'::jsonb) ->> 'request_id'));
select results_eq(format($$select status from public.expenses where id = '%s'$$, (:'rent'::jsonb) ->> 'expense_id'),
  $$values ('rejected'::text)$$, 'a rejected expense is never posted');

-- R9b and R9c: on credit, then settled.
select tests.value_as('authenticated', :'accountant_id', format($$select public.create_expense('{"account": "5020",
  "amount_cents": 8000, "expense_date": "2026-02-11", "description": "Internet, February", "paid_now": false,
  "payee_id": "%s", "branch_id": "%s"}')::text$$, :'payee_id', :'branch_id')) as credit \gset
select is(tests.value_as('authenticated', :'manager_id', format($$select owed_cents::text from public.payee_balances where payee_id = '%s'$$, :'payee_id')),
  '8000', 'R9b: the payee is owed $80.00 on 2000');
select tests.try_as('authenticated', :'manager_id', format($$select public.settle_expense('%s', '1010-TE')$$, (:'credit'::jsonb) ->> 'expense_id'));
select results_eq(format($$select status, (select owed_cents from public.payee_balances where payee_id = '%s') from public.expenses where id = '%s'$$,
                         :'payee_id', (:'credit'::jsonb) ->> 'expense_id'),
  $$values ('paid'::text, 0::bigint)$$, 'R9c: settled, nothing owed');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5900",
  "amount_cents": 90000, "expense_date": "2026-02-11", "description": "Too much", "paid_now": true,
  "paid_from": "1010-TE", "branch_id": "%s"}')$$, :'branch_id')), '^INSUFFICIENT_FUNDS', 'the drawer cannot go below zero');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.create_expense('{"account": "5050",
  "amount_cents": 100, "expense_date": "2026-02-11", "description": "Bad debt", "paid_now": true,
  "paid_from": "1010-TE", "branch_id": "%s"}')$$, :'branch_id')), '^INVALID_STATE', 'bad debts go through write-off, not expenses');

select * from finish();
rollback;
