-- M1.4: approval_requests and the manual journal request (SPEC 4, 7.5; R11; A-19).
begin;
\ir _helpers.psql
select plan(16);

select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset

update public.settings set value = '{"at": "2026-02-12T09:10:00Z", "frozen": true}' where key = 'clock.override_at';

select count(*) as journals_before from public.journals \gset
select coalesce(max(last_value), 0) as journal_counter_before from public.document_sequences where kind = 'journal' \gset

select is(tests.try_as('authenticated', :'accountant_id', format($$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "Rent for February", "branch_id": "%s",
  "lines": [{"account": "5010", "debit_cents": 30000}, {"account": "1010-BR2", "credit_cents": 30000}]}')$$, :'br2')),
  null, 'the accountant requests a manual journal');

select results_eq(
  format($$select type, status, required_role::text, payload ->> 'memo' from public.approval_requests where requested_by = '%s'$$, :'accountant_id'),
  $$values ('manual_journal'::text, 'pending'::text, 'manager'::text, 'Rent for February'::text)$$,
  'a pending request for a manager is stored');
select is((select count(*) from public.journals), :'journals_before'::bigint, 'nothing is posted until it is approved');
select is((select coalesce(max(last_value), 0) from public.document_sequences where kind = 'journal'),
  :'journal_counter_before'::bigint, 'the check does not use up a journal number');
select is((select count(*)::int from public.audit_log where action = 'approval.requested' and actor_id = :'accountant_id'), 1,
  'the request is audited');
select is(public.verify_journal_chain(), null, 'the dry run leaves the journal chain untouched');

select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "Unbalanced",
  "lines": [{"account": "5010", "debit_cents": 30000}, {"account": "1010-BR2", "credit_cents": 20000}]}')$$),
  '^JOURNAL_UNBALANCED', 'an unbalanced journal is refused at request time');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "  ",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]}')$$),
  '^INVALID_STATE', 'a memo is required (R11)');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_manual_journal('{
  "entry_date": "2026-03-01", "memo": "Future",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]}')$$),
  '^DATE_NOT_ALLOWED', 'a journal cannot be dated in the future');
select matches(tests.try_as('authenticated', :'cashier_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "x",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]}')$$),
  '^FORBIDDEN', 'a cashier cannot request a manual journal');
select matches(tests.try_as('authenticated', :'manager_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "x",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]}')$$),
  '^FORBIDDEN', 'a manager approves manual journals but does not request them (SPEC 4)');

insert into public.period_locks (branch_id, locked_through) values (:'br2', '2026-02-11');
select matches(tests.try_as('authenticated', :'admin_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-11", "memo": "Into a closed day",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1010-BR2", "credit_cents": 100}]}')$$),
  '^PERIOD_LOCKED', 'a closed day is refused at request time');

update public.settings set value = '"2026-02-01"' where key = 'migration.go_live_date';
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_manual_journal('{
  "entry_date": "2026-02-10", "memo": "Back-dated",
  "lines": [{"account": "5010", "debit_cents": 100}, {"account": "1020", "credit_cents": 100}]}')$$),
  '^DATE_NOT_ALLOWED', 'after go-live only today''s date is allowed (A-19)');

-- Who sees requests.
select is(tests.value_as('authenticated', :'manager_id', format($$select count(*) from public.approval_requests where requested_by = '%s'$$, :'accountant_id'))::int, 1,
  'a manager sees requests to decide');
select is(tests.value_as('authenticated', :'accountant_id', 'select count(*) from public.approval_requests')::int, 1,
  'the requester sees their own request');
select is(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.approval_requests')::int, 0,
  'other staff do not');

select * from finish();
rollback;
