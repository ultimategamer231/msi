-- M1.1 ledger core: chart of accounts and journal invariants (SPEC 6.1, 6.3; T-20, T-21; R-02).
begin;
\ir _helpers.psql
select plan(24);

-- Test-only writer: inserts a journal and its lines as the database owner, hashing the content
-- the way post_journal does (M1.2). p_lines: [[account_code, debit_cents, credit_cents], ...].
create or replace function tests.post_raw(p_no text, p_lines jsonb, p_txid bigint default null) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_canonical jsonb := '[]'::jsonb;
  v_line jsonb;
  v_index int := 0;
begin
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_array(
      v_index, v_line ->> 0, (v_line ->> 1)::bigint, (v_line ->> 2)::bigint, 'USD', 1000000,
      null, null, null, null, null));
  end loop;
  insert into public.journals (id, journal_no, entry_date, memo, source_type, content_hash, posted_txid)
  values (v_id, p_no, '2026-02-12', 'test journal', 'test',
          public.journal_content_digest(p_no, '2026-02-12', 'test journal', 'test', null, null, null, v_canonical),
          coalesce(p_txid, txid_current()));
  v_index := 0;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_index := v_index + 1;
    insert into public.journal_lines (journal_id, line_no, account_id, debit_cents, credit_cents)
    values (v_id, v_index, (select id from public.accounts where code = v_line ->> 0),
            (v_line ->> 1)::bigint, (v_line ->> 2)::bigint);
  end loop;
  return v_id;
end $$;

-- Chart of accounts (SPEC 6.1).
select is((select count(*)::int from public.accounts where code ~ '^[0-9]{4}$'), 22, 'the 22 shared accounts are seeded');
select is((select count(*)::int from public.branches b
            where not exists (select 1 from public.accounts a where a.branch_id = b.id and a.is_cash
                                and a.code = '1010-' || b.code)), 0,
  'each branch has its cash account 1010-<code>');
select is((select type::text from public.accounts where code = '2100'), 'liability', 'customer surplus is a liability');
select is((select type::text from public.accounts where code = '5050'), 'expense', 'bad debts is an expense');

select tests.create_staff('Admin One', 'admin') as admin_id \gset
select tests.try_as('authenticated', :'admin_id', $$select public.upsert_branch('{"code": "BR9", "name": "Ganta"}')$$);
select is((select name from public.accounts where code = '1010-BR9'), 'Cash on Hand – Ganta',
  'a new branch gets its cash account automatically');

-- Balanced journals are accepted; the deferred check runs at commit (forced here).
select lives_ok($$select tests.post_raw('JV-T000001', '[["1010-BR1", 50000, 0], ["3000", 0, 50000]]')$$,
  'a balanced journal is accepted');
select lives_ok($$set constraints all immediate$$, 'and passes the balance check');
set constraints all deferred;

-- T-20: unbalanced journals fail at commit (savepoint keeps the failed check from leaking).
savepoint t20;
select tests.post_raw('JV-T000002', '[["1010-BR1", 50000, 0], ["3000", 0, 40000]]');
select throws_like($$set constraints all immediate$$, 'JOURNAL_UNBALANCED%', 'T-20: an unbalanced journal is refused (JOURNAL_UNBALANCED)');
rollback to savepoint t20;
set constraints all deferred;

-- Line shape (SPEC 6.3 invariant 2).
select throws_ok($$select tests.post_raw('JV-T000003', '[["1010-BR1", 100, 100], ["3000", 0, 0]]')$$, '23514', null,
  'a line cannot be both a debit and a credit');
select throws_ok($$select tests.post_raw('JV-T000004', '[["1010-BR1", -100, 0], ["3000", 0, -100]]')$$, '23514', null,
  'amounts cannot be negative');
select throws_ok($$select tests.post_raw('JV-T000005', '[["1010-BR1", 0, 0], ["3000", 0, 0]]')$$, '23514', null,
  'a line must carry an amount');


select tests.create_staff('Cashier One', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Officer One', 'loan_officer', 'BR2') as officer_id \gset


select tests.post_raw('JV-T000010', '[["1010-BR2", 200000, 0], ["3000", 0, 200000]]') as journal_id \gset
select tests.post_raw('JV-T000011', '[["1020", 30000, 0], ["4900", 0, 30000]]');

-- T-21: posted journals and lines cannot be changed by any role. Pending deferred checks are
-- flushed first: Postgres refuses TRUNCATE while trigger events are pending, before our trigger runs.
set constraints all immediate;
select throws_like($$update public.journals set memo = 'changed'$$, 'IMMUTABLE_RECORD%',
  'T-21: the database owner cannot update a journal (IMMUTABLE_RECORD)');
select throws_like($$delete from public.journal_lines$$, 'IMMUTABLE_RECORD%',
  'T-21: the database owner cannot delete journal lines (IMMUTABLE_RECORD)');
select throws_like($$truncate public.journals cascade$$, 'IMMUTABLE_RECORD%', 'T-21: truncate is refused');
select matches(tests.try_as('service_role', null, $$update public.journal_lines set debit_cents = 1$$),
  '^permission denied', 'T-21: the service role is refused (no write privilege at all)');
select matches(tests.try_as('authenticated', :'accountant_id', $$delete from public.journals$$),
  '^permission denied', 'T-21: an accountant is refused');

-- Lines cannot be added to a journal posted in an earlier transaction (posted_txid 1 stands in
-- for a long-committed transaction).
set constraints all deferred;
savepoint late_line;
insert into public.journals (id, journal_no, entry_date, memo, source_type, content_hash, posted_txid)
values ('33333333-3333-3333-3333-333333333333', 'JV-T000012', '2026-02-12', 'old journal', 'test', '\x00', 1);
select throws_like(
  $$insert into public.journal_lines (journal_id, line_no, account_id, debit_cents)
    values ('33333333-3333-3333-3333-333333333333', 1, (select id from public.accounts where code = '1020'), 1)$$,
  'IMMUTABLE_RECORD%', 'lines cannot be added to an already posted journal');
rollback to savepoint late_line;

-- Direct inserts by clients are refused.
select matches(tests.try_as('authenticated', :'accountant_id',
  $$insert into public.journals (journal_no, entry_date, memo, source_type, content_hash) values ('X', '2026-01-01', 'x', 'x', '\x00')$$),
  '^permission denied', 'clients cannot insert journals directly');

-- RLS: the ledger is for ceo, manager, accountant, admin; the chart is for all staff.
select ok(tests.value_as('authenticated', :'accountant_id', 'select count(*) from public.journals')::int >= 2,
  'the accountant reads journals');
select is(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.journals')::int, 0,
  'a cashier reads no journals (T-31 pattern)');
select is(tests.value_as('authenticated', :'officer_id', 'select count(*) from public.journal_lines')::int, 0,
  'a loan officer reads no journal lines (T-31 pattern)');
select ok(tests.value_as('authenticated', :'cashier_id', 'select count(*) from public.accounts')::int >= 25,
  'staff read the chart of accounts');

-- Hash chain (R-02).
select is(public.verify_journal_chain(), null, 'the journal chain verifies');
set constraints all immediate;
alter table public.journal_lines disable trigger journal_lines_immutable;
update public.journal_lines set debit_cents = 200001 where journal_id = :'journal_id' and line_no = 1;
update public.journal_lines set credit_cents = 200001 where journal_id = :'journal_id' and line_no = 2;
alter table public.journal_lines enable trigger journal_lines_immutable;
select is(public.verify_journal_chain(), (select chain_no from public.journals where id = :'journal_id'),
  'a changed amount, even a balanced one, breaks the chain at that journal');

select * from finish();
rollback;
