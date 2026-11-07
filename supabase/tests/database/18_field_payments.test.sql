-- M4.2: field collection and remittance (SPEC 5.4.2–3, 5.4.8; R3, R3b; T-28, T-36).
begin;
\ir _helpers.psql
select plan(16);

insert into public.branches (code, name) values ('TF2', 'Test Field');
select tests.create_staff('Officer TF', 'loan_officer', 'TF2') as officer_id \gset
select tests.create_staff('Officer Other', 'loan_officer', 'BR3') as officer3_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TF', 'cashier', 'TF2') as cashier_id \gset
select tests.create_staff('Cashier BR3', 'cashier', 'BR3') as cashier3_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-02-12T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = 'true' where key = 'field.require_remittance';
delete from public.period_locks;

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Field", "last_name": "Test", "phone": "0988 100 001",
  "id_type": "national_id", "id_number": "T8-100001"}')$$);
select tests.become('authenticated', :'officer_id');
select public.create_loan_draft(jsonb_build_object('customer_id', (select id from public.customers where id_number = 'T8-100001'),
  'product_id', :'product_id', 'principal_cents', 100000, 'term_months', 1)) as loan_id \gset
select public.submit_loan(:'loan_id');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_id'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_id', 'cash', null, null);
select tests.unbecome();

create function tests.balance(p_code text) returns bigint language sql as $$
  select coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint from public.journal_lines l
    join public.accounts a on a.id = l.account_id where a.code = p_code $$;
select tests.balance('1015') as field_before \gset
select tests.balance('1010-TF2') as cash_before \gset

select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.record_field_payment('%s', 1000, 'cash', null, null, 'field-key-0001')$$, :'loan_id')),
  '^FORBIDDEN', 'only loan officers record field payments');
select matches(tests.try_as('authenticated', :'officer3_id', format(
  $$select public.record_field_payment('%s', 1000, 'cash', null, null, 'field-key-0002')$$, :'loan_id')),
  '^FORBIDDEN', 'a loan officer collects only for loans of their branch');

-- T-28: before confirmation the cash sits in 1015 (Field Cash) under the collector.
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.record_field_payment('%s', 30000, 'cash', null, null, 'field-key-0003')$$, :'loan_id')), null,
  'the officer records 30000 in cash');
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.record_field_payment('%s', 20000, 'cash', null, null, 'field-key-0004')$$, :'loan_id')), null,
  'and 20000 more');
select results_eq(
  format($$select remittance_status, collected_in_field from public.payments where loan_id = '%s' order by amount_cents$$, :'loan_id'),
  $$values ('pending'::text, true), ('pending', true)$$, 'both receipts are issued and wait for handover');
select is(tests.balance('1015') - :field_before, 50000::bigint, 'T-28: before confirmation 1015 holds the 50000');
select is((select count(*)::int from public.journal_lines l join public.accounts a on a.id = l.account_id
            where a.code = '1015' and l.staff_id = :'officer_id'), 2, 'field cash lines name the collector');

-- T-36: a counted total that does not match posts nothing.
select matches(tests.try_as('authenticated', :'cashier_id',
  format($$select public.confirm_remittance(array(select id from public.payments where loan_id = '%s'), 49000)$$, :'loan_id')),
  '^REMITTANCE_MISMATCH', 'T-36: counted 49000 against 50000 selected');
select is(tests.balance('1015') - :field_before, 50000::bigint, 'T-36: nothing posted');
select matches(tests.try_as('authenticated', :'cashier3_id',
  format($$select public.confirm_remittance(array(select id from public.payments where loan_id = '%s'), 50000)$$, :'loan_id')),
  '^FORBIDDEN', 'a cashier confirms field cash of their own branch only');

-- T-28: after confirmation the branch cash has it and 1015 is back to where it was.
select is(tests.try_as('authenticated', :'cashier_id',
  format($$select public.confirm_remittance(array(select id from public.payments where loan_id = '%s'), 50000)$$, :'loan_id')),
  null, 'the cashier confirms the 50000 handed over');
select is(tests.balance('1015') - :field_before, 0::bigint, 'T-28: after confirmation 1015 is zero for these collections');
select is(tests.balance('1010-TF2') - :cash_before, 50000::bigint, 'T-28: the branch cash account has the 50000');
select matches(tests.try_as('authenticated', :'cashier_id',
  format($$select public.confirm_remittance(array(select id from public.payments where loan_id = '%s'), 50000)$$, :'loan_id')),
  '^INVALID_STATE', 'a handover cannot be confirmed twice');

-- B-09 default: mobile money in the field goes straight to 1030 with a reference, no handover.
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.record_field_payment('%s', 5000, 'mobile_money', 'MP-1234567', null, 'field-key-0005')$$, :'loan_id')), null,
  'the officer records a mobile money payment with its reference');
select results_eq($$select remittance_status, (select a.code from public.journal_lines l join public.accounts a on a.id = l.account_id
                                                where l.journal_id = p.journal_id and l.debit_cents > 0)
                     from public.payments p where reference = 'MP-1234567'$$,
  $$values ('n/a'::text, '1030'::text)$$, 'it goes to 1030 and needs no handover');

select * from finish();
rollback;
