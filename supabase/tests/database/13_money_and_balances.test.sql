-- M3.2: money helpers (T-01, T-02, T-09; tools/vectors.py), preview_loan_terms, loan balances
-- derived from the ledger (SPEC 5.2, 6.2, 7.7).
begin;
\ir _helpers.psql
select plan(19);

-- T-09 rounding, round half up on integers.
select is(public.pct(3333, 2000), 667::bigint, 'T-09: pct(3333, 2000) = 667');
select is(public.pct(25, 2000), 5::bigint, 'T-09: pct(25, 2000) = 5 (half up)');
select is(public.round_half_up(5, 2), 3::bigint, 'round_half_up rounds .5 up');
select is(public.round_half_up(4, 3), 1::bigint, 'round_half_up rounds below .5 down');
select throws_ok($$select public.round_half_up(-1, 2)$$, '22023', null, 'negative amounts are refused');

-- T-01 interest and total.
select is(public.flat_interest(100000, 2000, 1), 20000::bigint, 'T-01: interest on 100000 at 2000 bps for 1 month is 20000');
select is(public.flat_interest(100000, 2000, 3), 60000::bigint, 'flat interest multiplies by the term');

-- T-02 due dates (calendar months, clamped).
select is(public.add_months_clamped('2026-01-05', 1), '2026-02-05'::date, 'T-02: 05 Jan + 1 month = 05 Feb');
select is(public.add_months_clamped('2026-01-31', 1), '2026-02-28'::date, 'T-02: 31 Jan + 1 month = 28 Feb');
select is(public.add_months_clamped('2028-01-31', 1), '2028-02-29'::date, 'leap years clamp to 29 Feb');

-- preview_loan_terms uses the same helpers.
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
select is(
  (tests.value_as('authenticated', :'officer_id', format(
     $$select public.preview_loan_terms(100000, '%s', 1, '2026-01-05')::text$$, :'product_id'))::jsonb
   - 'penalty_period_days' - 'penalty_base' - 'penalty_max_periods' - 'recovery_after_days' - 'penalty_rate_bps'),
  '{"principal_cents": 100000, "interest_rate_bps": 2000, "term_months": 1, "interest_cents": 20000,
    "total_due_cents": 120000, "disbursed_on": "2026-01-05", "due_date": "2026-02-05",
    "first_penalty_on": "2026-02-12", "first_penalty_cents": 24000}'::jsonb,
  'the preview shows interest, total, due date and the first penalty (T-01, T-02, T-03 week 1)');
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.preview_loan_terms(100000, '%s', 4, null)$$, :'product_id')), '^INVALID_STATE',
  'the term cannot exceed the product maximum');
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.preview_loan_terms(0, '%s', 1, null)$$, :'product_id')), '^INVALID_STATE',
  'the amount must be positive');
select matches(tests.try_as('anon', null, format(
  $$select public.preview_loan_terms(100000, '%s', 1, null)$$, :'product_id')), '^permission denied',
  'anonymous users cannot preview');

-- Balances come from journal lines only.
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Bal", "last_name": "Test", "phone": "0996 100 001",
  "id_type": "national_id", "id_number": "T3-100001"}')$$);
select id as customer_id from public.customers where id_number = 'T3-100001' \gset
select id as br2 from public.branches where code = 'BR2' \gset
insert into public.loans (loan_no, customer_id, product_id, branch_id, officer_id, created_by, principal_cents, term_months,
                          interest_rate_bps, interest_cents, penalty_rate_bps, penalty_period_days, penalty_base,
                          penalty_max_periods, recovery_after_days, collateral_required, status, disbursed_on, due_date,
                          disbursed_by, disbursement_method, disbursement_account_id)
values ('LN-TEST-00001', :'customer_id', :'product_id', :'br2', :'officer_id', :'officer_id', 100000, 1,
        2000, 20000, 2000, 7, 'outstanding_total', 4, 30, true, 'active', '2000-01-05', '2000-02-05',
        :'officer_id', 'cash', (select id from public.accounts where code = '1010-BR2'))
returning id as loan_id \gset
select is(tests.value_as('authenticated', :'officer_id', format(
  $$select total_out from public.loan_balances where loan_id = '%s'$$, :'loan_id'))::bigint, 0::bigint,
  'a loan with no journal lines owes nothing');

select tests.become('authenticated', :'officer_id');
select set_config('role', 'postgres', true);
select public.post_journal('2000-01-05', 'Test disbursement', 'test', null, :'br2', format($$[
  {"account": "1100", "debit_cents": 100000, "loan_id": "%1$s", "component": "principal"},
  {"account": "1110", "debit_cents": 20000, "loan_id": "%1$s", "component": "interest"},
  {"account": "1010-BR2", "credit_cents": 100000},
  {"account": "4000", "credit_cents": 20000}]$$, :'loan_id')::jsonb);
select tests.unbecome();

select tests.become('authenticated', :'officer_id');
select results_eq(
  format($$select principal_out, interest_out, penalty_out, total_out from public.loan_balances where loan_id = '%s'$$, :'loan_id'),
  $$values (100000::bigint, 20000::bigint, 0::bigint, 120000::bigint)$$,
  'loan_balances sums the receivable lines by component (SPEC 6.2)');
select tests.unbecome();
select is(tests.value_as('authenticated', :'officer_id', format(
  $$select total_out from public.customer_balances where customer_id = '%s'$$, :'customer_id'))::bigint, 120000::bigint,
  'a loan officer sees customer balances');
select ok(tests.value_as('authenticated', :'officer_id', format(
  $$select days_overdue from public.loan_balances where loan_id = '%s'$$, :'loan_id'))::int > 0,
  'days overdue counts from the due date');
select is(tests.value_as('authenticated', :'officer_id', 'select count(*) from public.journal_lines')::int, 0,
  'the officer still cannot read journal lines (T-31)');

select * from finish();
rollback;
