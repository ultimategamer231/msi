-- M1.2: document numbers (SPEC 6.3, B-02, B-03), sequence starts (FR-27) and post_journal (T-22).
begin;
\ir _helpers.psql
select plan(30);

select id as br1 from public.branches where code = 'BR1' \gset
select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset

-- Numbering formats (SPEC 6.3 with B-02 and B-03).
select is(public.next_number('receipt', :'br2'), 'RCT-BR2-000001', 'receipts count per branch');
select is(public.next_number('receipt', :'br2'), 'RCT-BR2-000002', 'and are gapless');
select is(public.next_number('receipt', :'br1'), 'RCT-BR1-000001', 'each branch has its own receipt series');
select is(public.next_number('loan', :'br2'), 'LN-BR2-00001', 'loan numbers carry the branch code');
select is(public.next_number('loan', :'br1'), 'LN-BR1-00002', 'but share one global counter (B-02)');
select is(public.next_number('expense', :'br2'), 'EXP-BR2-000001', 'expense numbers have 6 digits (B-03)');
select is(public.next_number('customer'), 'CU-000001', 'customer numbers are global');
select is(public.next_number('collateral'), 'COL-000001', 'collateral numbers are global');
select matches(public.next_number('journal'), '^JV-[0-9]{7}$', 'journal numbers have 7 digits');

-- A rolled-back number is given back (gapless).
savepoint numbering;
select public.next_number('receipt', :'br2');
rollback to savepoint numbering;
select is(public.next_number('receipt', :'br2'), 'RCT-BR2-000003', 'a rolled-back number is reused, so there are no gaps');

-- Sequence start values (B-02, FR-27).
select matches(tests.try_as('authenticated', :'accountant_id',
  format($$select public.set_sequence_start('receipt', '%s', 119)$$, :'br2')), '^FORBIDDEN', 'only the admin sets starting numbers');
select is(tests.try_as('authenticated', :'admin_id',
  format($$select public.set_sequence_start('receipt', '%s', 119)$$, :'br2')), null, 'the admin continues paper numbering');
select is(public.next_number('receipt', :'br2'), 'RCT-BR2-000120', 'the next receipt follows the paper series (DEMO_DATA)');
select matches(tests.try_as('authenticated', :'admin_id',
  format($$select public.set_sequence_start('receipt', '%s', 50)$$, :'br2')), '^INVALID_STATE', 'a counter can never move back');
select is((select count(*)::int from public.audit_log where action = 'sequence.started'), 1, 'setting a start value is audited');

update public.settings set value = '"2026-01-01"' where key = 'migration.go_live_date';
select matches(tests.try_as('authenticated', :'admin_id',
  $$select public.set_sequence_start('customer', null, 500)$$), '^DATE_NOT_ALLOWED', 'after go-live numbering is fixed');
update public.settings set value = 'null' where key = 'migration.go_live_date';

-- post_journal: the only writer.
select ok(not has_function_privilege('authenticated', 'public.post_journal(date,text,text,uuid,uuid,jsonb)', 'EXECUTE'),
  'clients cannot call post_journal directly');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
select public.post_journal('2026-02-11', 'Capital in', 'capital', null, :'br2',
  '[{"account": "1010-BR2", "debit_cents": 200000}, {"account": "3000", "credit_cents": 200000}]') as journal_id \gset
select results_eq(
  format($$select a.code, l.debit_cents, l.credit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
           where l.journal_id = '%s' order by l.line_no$$, :'journal_id'),
  $$values ('1010-BR2'::text, 200000::bigint, 0::bigint), ('3000'::text, 0::bigint, 200000::bigint)$$,
  'the lines are stored in order');
select is((select posted_by from public.journals where id = :'journal_id'), :'admin_id'::uuid, 'the poster is recorded');
select is((select count(*)::int from public.audit_log where action = 'journal.posted' and entity_id = :'journal_id'), 1,
  'posting writes an audit row');
select is(public.verify_journal_chain(), null, 'posted journals keep the chain intact');

select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "1010-BR2", "debit_cents": 100}, {"account": "3000", "credit_cents": 90}]')$$,
  'JOURNAL_UNBALANCED%', 'unbalanced input is refused before anything is written');
select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "1010-BR2", "debit_cents": 100.5}, {"account": "3000", "credit_cents": 100.5}]')$$,
  'INVALID_STATE%', 'fractions of a cent are refused');
select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "9999", "debit_cents": 100}, {"account": "3000", "credit_cents": 100}]')$$,
  'INVALID_STATE%', 'unknown accounts are refused');
select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "1010-BR2", "debit_cents": 100, "currency": "LRD"}, {"account": "3000", "credit_cents": 100}]')$$,
  'INVALID_STATE%', 'lines in another currency are refused');
select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "1100", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]')$$,
  'INVALID_STATE%', 'a loan receivable line needs a loan and component');
select throws_like($$select public.post_journal('2026-02-11', 'x', 'test', null, null,
  '[{"account": "1100", "debit_cents": 100, "loan_id": "11111111-1111-1111-1111-111111111111", "component": "interest"}, {"account": "1010-BR2", "credit_cents": 100}]')$$,
  'INVALID_STATE%', 'the component must match the account');

-- T-22: posting into a locked date.
insert into public.period_locks (branch_id, locked_through) values (:'br2', '2026-02-11');
select throws_like($$select public.post_journal('2026-02-11', 'Late cash', 'test', null, null,
  '[{"account": "1010-BR2", "debit_cents": 100}, {"account": "4900", "credit_cents": 100}]')$$,
  'PERIOD_LOCKED%', 'T-22: a line for a locked branch on a locked date is refused (via its cash account)');
select throws_like($$select public.post_journal('2026-02-10', 'Back-dated', 'test', null, (select id from public.branches where code = 'BR2'),
  '[{"account": "1020", "debit_cents": 100}, {"account": "4900", "credit_cents": 100}]')$$,
  'PERIOD_LOCKED%', 'T-22: a journal for a locked branch dated before the lock is refused');
select lives_ok($$select public.post_journal('2026-02-12', 'Next day', 'test', null, null,
  '[{"account": "1010-BR2", "debit_cents": 100}, {"account": "4900", "credit_cents": 100}]')$$,
  'the day after the lock is open');

select * from finish();
rollback;
