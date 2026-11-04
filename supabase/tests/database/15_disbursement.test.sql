-- M3.4: collateral pledge and disbursement (SPEC 5.3, 5.4, 5.9; R1; T-23, T-35).
begin;
\ir _helpers.psql
select plan(23);

select id as br2 from public.branches where code = 'BR2' \gset
select id as br3 from public.branches where code = 'BR3' \gset
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
-- A fresh branch whose cash account starts empty, whatever else the database holds.
insert into public.branches (code, name) values ('TF', 'Test Funds');
select tests.create_staff('Cashier Two', 'cashier', 'TF') as cashier_id \gset
select tests.create_staff('Cashier Three', 'cashier', 'BR3') as cashier3_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-01-05T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'true' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = 'false' where key = 'collateral.multi_loan';
delete from public.period_locks;

-- Customer and two approved loans (500000 and 100000).
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Pay", "last_name": "Test", "phone": "0994 100 001",
  "id_type": "national_id", "id_number": "T5-100001"}')$$);
select id as customer_id from public.customers where id_number = 'T5-100001' \gset
create function tests.approved_loan(p_officer uuid, p_manager uuid, p_customer uuid, p_product uuid, p_amount bigint)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform tests.become('authenticated', p_officer);
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', p_customer, 'product_id', p_product,
                                                      'principal_cents', p_amount, 'term_months', 1));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.unbecome();
  return v_id;
end $$;
select tests.approved_loan(:'officer_id', :'manager_id', :'customer_id', :'product_id', 100000) as loan_a \gset
update public.settings set value = '600000' where key = 'approvals.loan_manager_limit_cents';
select tests.approved_loan(:'officer_id', :'manager_id', :'customer_id', :'product_id', 500000) as loan_big \gset

-- Collateral.
select matches(tests.try_as('authenticated', :'accountant_id', format($$select public.register_collateral('{
  "owner_customer_id": "%s", "type": "electronics", "description": "Generator", "estimated_value_cents": 140000}')$$, :'customer_id')),
  '^FORBIDDEN', 'an accountant cannot register collateral');
select is(tests.try_as('authenticated', :'officer_id', format($$select public.register_collateral('{
  "owner_customer_id": "%s", "type": "electronics", "description": "Honda generator", "serial_no": "GA-T5-1",
  "estimated_value_cents": 140000, "location_note": "Branch 2 safe"}')$$, :'customer_id')), null,
  'a loan officer registers an item');
select id as item_id from public.collaterals where serial_no = 'GA-T5-1' \gset
select matches((select code from public.collaterals where id = :'item_id'), '^COL-[0-9]{6}$', 'the item gets a COL number');
select is((select count(*)::int from public.collateral_events where collateral_id = :'item_id' and event_type = 'received'), 1,
  'receiving the item starts its custody log');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.register_collateral('{
  "owner_customer_id": "%s", "type": "electronics", "description": "Phone", "estimated_value_cents": 99.5}')$$, :'customer_id')),
  '^INVALID_STATE', 'the value is whole cents');

-- Disbursement checks.
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), '^FORBIDDEN', 'only a cashier pays out');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), '^COLLATERAL_REQUIRED',
  'T-23: no pledged collateral, no payout');
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.link_collateral('%s', '%s')$$, :'loan_a', :'item_id')), null, 'the officer pledges the item');
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.link_collateral('%s', '%s')$$, :'loan_big', :'item_id')), '^COLLATERAL_ALREADY_PLEDGED',
  'an item secures one open loan at a time (A-10)');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), '^INSUFFICIENT_FUNDS',
  'an empty cash account cannot pay out');

-- Fund the test branch cash with 300000 (capital in, approved).
select tests.become('authenticated', :'accountant_id');
select public.request_capital_in('{"entry_date": "2026-01-05", "account": "1010-TF", "amount_cents": 300000, "memo": "T5 opening cash"}');
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where type = 'capital_in' and payload ->> 'memo' = 'T5 opening cash'),
  'approve', null);
select tests.unbecome();

select tests.try_as('authenticated', :'officer_id', format($$select public.register_collateral('{
  "owner_customer_id": "%s", "type": "vehicle", "description": "Car", "plate_no": "T5-CAR", "estimated_value_cents": 600000}')$$, :'customer_id'));
select tests.try_as('authenticated', :'officer_id', format($$select public.link_collateral('%s', (select id from public.collaterals where plate_no = 'T5-CAR'))$$, :'loan_big'));
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_big')), '^INSUFFICIENT_FUNDS',
  'T-35: 500000 from a cash account holding 300000');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, '2026-01-04')$$, :'loan_a')), '^DATE_NOT_ALLOWED',
  'a cashier cannot back-date a payout (A-19)');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', (select id from public.accounts where code = '1010-BR2'), null)$$, :'loan_a')),
  '^INVALID_STATE', 'cash leaves the cashier''s own branch account');

insert into public.period_locks (branch_id, locked_through, locked_by)
values ((select id from public.branches where code = 'TF'), '2026-01-05', :'manager_id');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), '^PERIOD_LOCKED',
  'no payout on a closed day (SPEC 5.3)');
delete from public.period_locks where branch_id = (select id from public.branches where code = 'TF');

select is(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), null, 'the cashier pays out the loan');
select results_eq(format($$select status, disbursed_on, due_date, disbursement_method from public.loans where id = '%s'$$, :'loan_a'),
  $$values ('active'::text, '2026-01-05'::date, '2026-02-05'::date, 'cash'::text)$$,
  'the loan is active and due one calendar month later (T-02)');
select results_eq(
  format($$select a.code, l.debit_cents, l.credit_cents, l.component from public.journal_lines l
             join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
            where j.source_type = 'disbursement' and j.source_id = '%s' order by l.line_no$$, :'loan_a'),
  $$values ('1100'::text, 100000::bigint, 0::bigint, 'principal'::text), ('1110', 20000, 0, 'interest'),
           ('1010-TF', 0, 100000, null), ('4000', 0, 20000, null)$$,
  'R1: Dr 1100 principal, Dr 1110 interest, Cr branch cash, Cr 4000 interest income');
select tests.become('authenticated', :'officer_id');
select results_eq(format($$select principal_out, interest_out, total_out from public.loan_balances where loan_id = '%s'$$, :'loan_a'),
  $$values (100000::bigint, 20000::bigint, 120000::bigint)$$, 'the borrower owes 120000 (T-01)');
select tests.unbecome();
select is((select count(*)::int from public.audit_log where action = 'loan.disbursed' and entity_id = :'loan_a'), 1, 'the payout is audited');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.disburse_loan('%s', 'cash', null, null)$$, :'loan_a')), '^INVALID_STATE', 'a loan is paid out only once');

-- With the funds check switched off, mobile money can go negative (setting, SPEC 5.4.8).
update public.settings set value = 'false' where key = 'disbursement.check_funds';
select is(tests.try_as('authenticated', :'cashier3_id', format(
  $$select public.disburse_loan('%s', 'mobile_money', null, null)$$, :'loan_big')), null,
  'a cashier of another branch may pay out (B-10); the funds check follows the setting');
select is((select a.code from public.loans l join public.accounts a on a.id = l.disbursement_account_id where l.id = :'loan_big'),
  '1030', 'mobile money leaves account 1030');
select matches(tests.try_as('authenticated', :'cashier_id',
  $$insert into public.loan_collaterals (loan_id, collateral_id, pledged_on, created_by) values (gen_random_uuid(), gen_random_uuid(), current_date, auth.uid())$$),
  '^permission denied', 'pledges are written only through the RPC');

select * from finish();
rollback;
