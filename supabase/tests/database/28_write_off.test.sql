-- M6.4: write-off (SPEC 5.8; FR-19; A-13; T-16).
begin;
\ir _helpers.psql
select plan(16);

insert into public.branches (code, name) values ('TW', 'Test Write-off');
select tests.create_staff('Officer TW', 'loan_officer', 'TW') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('CEO One', 'ceo') as ceo_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Cashier TW', 'cashier', 'TW') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T10:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
-- A loan of 100000 paid out 05 Jan 2026 (due 05 Feb), secured by one item; returns the loan id.
create function tests.secured_loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid, p_item text)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid; v_item uuid;
begin
  perform tests.set_day('2026-01-05');
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Recovery', 'last_name', p_id_number,
    'phone', '0980 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_item := public.register_collateral(jsonb_build_object('owner_customer_id', v_customer, 'type', 'vehicle',
    'description', p_item, 'plate_no', p_id_number, 'estimated_value_cents', 420000, 'location_note', 'Yard'));
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

select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TW-100001', :'product_id', 'Toyota Corolla') as loan_a \gset
select tests.secured_loan(:'officer_id', :'manager_id', :'cashier_id', 'TW-100002', :'product_id', 'Nissan Sunny') as loan_b \gset
select collateral_id as item_a from public.loan_collaterals where loan_id = :'loan_a' \gset
select tests.set_day('2026-03-07');
select tests.value_as('authenticated', :'manager_id', 'select public.run_daily_accruals()::text');
select tests.value_as('authenticated', :'manager_id', format($$select public.open_recovery_case('%s', 'No reply')::text$$, :'loan_a')) as case_a \gset

-- Before any sale: only a manager, with a reason of 20 characters or more, may ask (override).
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.request_write_off('%s', 'Customer left the country for good')$$, :'loan_a')),
  '^FORBIDDEN', 'a cashier cannot ask for a write-off');
select matches(tests.try_as('authenticated', :'accountant_id', format($$select public.request_write_off('%s', 'Customer left the country for good')$$, :'loan_a')),
  '^INVALID_STATE', 'the accountant needs a case at disposal');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.request_write_off('%s', 'Gone')$$, :'loan_b')),
  '^INVALID_STATE', 'a short override reason is refused');

-- T-14 then T-16: sale 200000 leaves 48832 principal; the accountant asks; the CEO approves.
select tests.try_as('authenticated', :'manager_id', format($$select public.record_collateral_sale('%s', '%s', 200000, 'Moses Doe', 'cash')$$, :'case_a', :'item_a'));
select is(tests.try_as('authenticated', :'accountant_id', format($$select public.request_write_off('%s', 'Sale did not cover the balance')$$, :'loan_a')),
  null, 'with the case at disposal the accountant asks for the write-off');
select results_eq(format($$select required_role::text, (payload ->> 'total_cents')::bigint, (payload ->> 'override')::boolean
                           from public.approval_requests where type = 'write_off' and entity_id = '%s'$$, :'loan_a'),
  $$values ('ceo'::text, 48832::bigint, false)$$, 'it goes to the CEO for 48832');
select matches(tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval(
  (select id from public.approval_requests where type = 'write_off' and entity_id = '%s'), 'approve', 'Board 2026/03')$$, :'loan_a')),
  '^FORBIDDEN', 'a manager cannot approve a write-off');
select matches(tests.try_as('authenticated', :'ceo_id', format($$select public.decide_approval(
  (select id from public.approval_requests where type = 'write_off' and entity_id = '%s'), 'approve', null)$$, :'loan_a')),
  '^INVALID_STATE', 'the CEO must give the board reference');
select is(tests.try_as('authenticated', :'ceo_id', format($$select public.decide_approval(
  (select id from public.approval_requests where type = 'write_off' and entity_id = '%s'), 'approve', 'Board minute 2026/03-4')$$, :'loan_a')),
  null, 'the CEO approves with the board reference');
select results_eq(
  format($$select a.code, l.debit_cents, l.credit_cents from public.journal_lines l join public.accounts a on a.id = l.account_id
            join public.journals j on j.id = l.journal_id where j.source_type = 'write_off' and l.loan_id = '%s' order by l.line_no$$, :'loan_a'),
  $$values ('5050'::text, 48832::bigint, 0::bigint), ('1100', 0, 48832)$$, 'T-16: Dr 5050 48832, Cr 1100 48832');
select results_eq(format($$select l.status, (select penalty_cents + interest_cents + principal_cents from public.loan_owed(l.id)),
                                  rc.stage from public.loans l join public.recovery_cases rc on rc.loan_id = l.id where l.id = '%s'$$, :'loan_a'),
  $$values ('written_off'::text, 0::bigint, 'closed'::text)$$, 'T-16: written off, balance 0, case closed');
select is((select count(*)::int from public.audit_log where action = 'loan.written_off' and entity_id = :'loan_a'
            and after ->> 'board_reference' = 'Board minute 2026/03-4'), 1, 'the board reference is audited');

-- A later recovery goes to 4100 and cannot exceed what was written off.
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 48833, 'cash', null, null, 'wo-key-000001')$$, :'loan_a')),
  '^OVERPAYMENT', 'not more than the 48832 written off');
select is(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 10000, 'cash', null, null, 'wo-key-000002')$$, :'loan_a')),
  null, 'the cashier takes 10000 on the written-off loan');
select results_eq(
  format($$select p.source, a.code, l.credit_cents from public.payments p join public.journal_lines l on l.journal_id = p.journal_id and l.credit_cents > 0
            join public.accounts a on a.id = l.account_id where p.loan_id = '%s' and p.idempotency_key = 'wo-key-000002'$$, :'loan_a'),
  $$values ('post_write_off_recovery'::text, '4100'::text, 10000::bigint)$$, 'recorded as a recovery: Cr 4100');
select is((select status from public.loans where id = :'loan_a'), 'written_off', 'the loan stays written off');

-- Manager override without a case at disposal (loan B, still overdue, no case).
select is(tests.try_as('authenticated', :'manager_id', format($$select public.request_write_off('%s', 'Borrower died; no estate to claim against')$$, :'loan_b')),
  null, 'a manager may ask without a case, with a full reason');

select * from finish();
rollback;
