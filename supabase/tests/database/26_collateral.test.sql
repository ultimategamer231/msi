-- M6.1: collateral register (SPEC 5.9; FR-15, FR-16; T-24; B-04 numbering).
begin;
\ir _helpers.psql
select plan(16);

insert into public.branches (code, name) values ('TC', 'Test Collateral');
select tests.create_staff('Officer TC', 'loan_officer', 'TC') as officer_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Cashier TC', 'cashier', 'TC') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = '{"at": "2026-02-12T10:00:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'true' where key = 'loans.collateral_required';
update public.settings set value = 'false' where key = 'collateral.multi_loan';
delete from public.period_locks;

select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Item", "last_name": "Owner", "phone": "0981 100 001",
  "id_type": "national_id", "id_number": "TC-100001"}')$$);
select id as customer_id from public.customers where id_number = 'TC-100001' \gset
select tests.become('authenticated', :'officer_id');
select public.register_collateral(jsonb_build_object('owner_customer_id', :'customer_id', 'type', 'vehicle',
  'description', 'Toyota Corolla 2008', 'plate_no', 'TC9 4821', 'estimated_value_cents', 420000,
  'location_note', 'Branch yard')) as item_id \gset
select public.create_loan_draft(jsonb_build_object('customer_id', :'customer_id', 'product_id', :'product_id',
  'principal_cents', 50000, 'term_months', 1)) as loan_a \gset
select public.link_collateral(:'loan_a', :'item_id');
select public.submit_loan(:'loan_a');
select public.create_loan_draft(jsonb_build_object('customer_id', :'customer_id', 'product_id', :'product_id',
  'principal_cents', 30000, 'term_months', 1)) as loan_b \gset
select tests.become('authenticated', :'manager_id');
select public.decide_approval((select id from public.approval_requests where entity_id = :'loan_a'), 'approve', null);
select tests.become('authenticated', :'cashier_id');
select public.disburse_loan(:'loan_a', 'cash', null, null);
select tests.unbecome();

-- T-24: one open loan per item.
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.link_collateral('%s', '%s')$$, :'loan_b', :'item_id')),
  '^COLLATERAL_ALREADY_PLEDGED', 'T-24: an item already securing an active loan cannot be pledged again');

-- Duplicate identifiers (SPEC 5.9): case and spaces do not hide a match.
select is(tests.value_as('authenticated', :'officer_id',
  $$select string_agg(matched, ',') from public.find_duplicate_collateral(null, ' tc9 4821 ', null, null)$$),
  'plate_no', 'the same plate on another active item is found');
select is(tests.value_as('authenticated', :'officer_id',
  format($$select count(*)::text from public.find_duplicate_collateral(null, 'TC9 4821', null, null, '%s')$$, :'item_id')),
  '0', 'the item itself is not its own duplicate');

-- Custody events.
select is(tests.try_as('authenticated', :'cashier_id', format($$select public.log_collateral_event('%s',
  '{"event_type": "moved", "to_location": "Branch 3 yard, bay 2", "witness_name": "Yard guard"}')$$, :'item_id')), null,
  'the cashier records a move');
select results_eq(format($$select location_note from public.collaterals where id = '%s'$$, :'item_id'),
  $$values ('Branch 3 yard, bay 2'::text)$$, 'the location follows the move');
select results_eq(format($$select from_location, to_location, witness_name from public.collateral_events
                           where collateral_id = '%s' and event_type = 'moved'$$, :'item_id'),
  $$values ('Branch yard'::text, 'Branch 3 yard, bay 2'::text, 'Yard guard'::text)$$, 'the custody log keeps from, to and witness');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.log_collateral_event('%s',
  '{"event_type": "valued", "value_cents": 380000}')$$, :'item_id')), '^FORBIDDEN', 'only a manager values an item');
select is(tests.try_as('authenticated', :'manager_id', format($$select public.log_collateral_event('%s',
  '{"event_type": "valued", "value_cents": 380000, "note": "Dent on the rear door"}')$$, :'item_id')), null, 'the manager revalues it');
select results_eq(format($$select estimated_value_cents from public.collaterals where id = '%s'$$, :'item_id'),
  $$values (380000::bigint)$$, 'the new estimate is kept');
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.log_collateral_event('%s',
  '{"event_type": "sold"}')$$, :'item_id')), '^INVALID_STATE', 'a sale is not a free custody event');
select throws_ok(format($$update public.collateral_events set note = 'x' where collateral_id = '%s'$$, :'item_id'),
  '42501', 'IMMUTABLE_RECORD: UPDATE on collateral_events is not allowed', 'custody entries cannot be edited');

-- Release (FR-16): not while the loan is open; yes once it is closed.
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.release_collateral('%s', 'Collected', 'Item Owner')$$, :'item_id')),
  '^INVALID_STATE', 'no release while the loan is open');
select tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 60000, 'cash', null, null, 'coll-key-00001')$$, :'loan_a'));
select matches(tests.try_as('authenticated', :'officer_id', format($$select public.release_collateral('%s', 'Collected', null)$$, :'item_id')),
  '^FORBIDDEN', 'a loan officer does not release');
select is(tests.try_as('authenticated', :'cashier_id', format($$select public.release_collateral('%s', 'Collected by the owner', 'Item Owner')$$, :'item_id')),
  null, 'after the loan closes the cashier releases it');
select results_eq(format($$select c.status, lc.status, lc.released_on from public.collaterals c join public.loan_collaterals lc on lc.collateral_id = c.id
                           where c.id = '%s'$$, :'item_id'),
  $$values ('released'::text, 'released'::text, '2026-02-12'::date)$$, 'item and pledge are released, dated today');

-- B-04: recovery cases are numbered RC-000001 and up.
select matches(public.next_number('recovery_case'), '^RC-[0-9]{6}$', 'B-04: RC numbers have six digits');

select * from finish();
rollback;
