-- M9.1: opening balances (SPEC 8, R12; FR-27; A-19).
begin;
\ir _helpers.psql
select plan(7);

select tests.create_staff('Accountant OB', 'accountant') as accountant_id \gset
select tests.create_staff('Manager OB', 'manager') as manager_id \gset
update public.settings set value = '{"at": "2026-01-31T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = '"2026-02-01"' where key = 'migration.go_live_date';
delete from public.period_locks;

select matches(tests.try_as('authenticated', :'manager_id', $$select public.import_opening_balance('{"entry_date": "2026-01-31",
  "memo": "Opening", "lines": [{"account": "1020", "debit_cents": 100}]}')$$), '^FORBIDDEN', 'a manager does not enter opening balances');
select tests.value_as('authenticated', :'accountant_id', $$select public.import_opening_balance('{"entry_date": "2026-01-31",
  "memo": "Balances from the Excel book, 31 Jan 2026",
  "lines": [{"account": "1020", "debit_cents": 1500000}, {"account": "1030", "debit_cents": 250000}, {"account": "2000", "credit_cents": 40000}]}')::text$$) as ob \gset
select results_eq(format($$select a.code, l.debit_cents, l.credit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
                           where l.journal_id = (%L::jsonb ->> 'journal_id')::uuid order by l.line_no$$, :'ob'),
  $$values ('1020'::text, 1500000::bigint, 0::bigint), ('1030', 250000, 0), ('2000', 0, 40000), ('3900', 0, 1710000)$$,
  'R12: assets debit, liabilities credit, the difference to 3900');
select is((select entry_date from public.journals where id = ((:'ob'::jsonb) ->> 'journal_id')::uuid), '2026-01-31'::date,
  'dated before go-live');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.import_opening_balance('{"entry_date": "2026-01-31",
  "memo": "Loans", "lines": [{"account": "1100", "debit_cents": 100}]}')$$), '^INVALID_STATE', 'loan balances are entered as loans, not here');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.import_opening_balance('{"entry_date": "2026-01-31",
  "memo": "Income", "lines": [{"account": "4000", "credit_cents": 100}]}')$$), '^INVALID_STATE', 'only balance-sheet accounts');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.import_opening_balance('{"entry_date": "2026-02-01",
  "memo": "Too late", "lines": [{"account": "1020", "debit_cents": 100}]}')$$), '^DATE_NOT_ALLOWED', 'not dated on or after go-live');
update public.settings set value = '{"at": "2026-02-02T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.import_opening_balance('{"entry_date": "2026-01-31",
  "memo": "After go-live", "lines": [{"account": "1020", "debit_cents": 100}]}')$$), '^DATE_NOT_ALLOWED', 'nothing after go-live');

select * from finish();
rollback;
