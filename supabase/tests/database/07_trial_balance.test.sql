-- M1.3: trial balance (SPEC 10.2) and ledger read access (T-31 pattern).
begin;
\ir _helpers.psql
select plan(7);

select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset

select public.post_journal('2026-02-10', 'Capital in', 'capital', null, :'br2',
  '[{"account": "1010-BR2", "debit_cents": 500000}, {"account": "3000", "credit_cents": 500000}]');
select public.post_journal('2026-02-11', 'Office supplies', 'expense', null, :'br2',
  '[{"account": "5900", "debit_cents": 4500}, {"account": "1010-BR2", "credit_cents": 4500}]');
select public.post_journal('2026-02-13', 'Bank deposit', 'transfer', null, :'br2',
  '[{"account": "1020", "debit_cents": 100000}, {"account": "1010-BR2", "credit_cents": 100000}]');

select results_eq(
  $$select code, debit_cents, credit_cents from public.trial_balance('2026-02-12') order by code$$,
  $$values ('1010-BR2'::text, 500000::bigint, 4500::bigint), ('3000'::text, 0::bigint, 500000::bigint),
           ('5900'::text, 4500::bigint, 0::bigint)$$,
  'totals per account up to the as-of date (later journals excluded)');
select is((select sum(debit_cents) - sum(credit_cents) from public.trial_balance('2026-02-28'))::bigint, 0::bigint,
  'the trial balance balances');
select is((select count(*)::int from public.trial_balance('2026-02-28')), 4, 'only accounts with entries are listed');

select is(tests.value_as('authenticated', :'accountant_id', $$select count(*) from public.trial_balance('2026-02-28')$$)::int, 4,
  'the accountant sees the trial balance');
select is(tests.value_as('authenticated', :'manager_id', $$select sum(debit_cents) from public.trial_balance('2026-02-28')$$)::bigint,
  604500::bigint, 'the manager sees the same totals');
select is(tests.value_as('authenticated', :'cashier_id', $$select count(*) from public.trial_balance('2026-02-28')$$)::int, 0,
  'a cashier sees nothing (RLS on the ledger, T-31 pattern)');
select matches(tests.try_as('anon', null, $$select * from public.trial_balance('2026-02-28')$$), '^permission denied',
  'signed-out visitors cannot call it');

select * from finish();
rollback;
