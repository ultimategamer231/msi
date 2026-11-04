-- M2.3: customer edit requests (T-29), decide_approval, manual journal and capital-in decisions
-- (SPEC 4, 5.11, 8; FR-04, FR-21, FR-28; R10, R11; R-14).
begin;
\ir _helpers.psql
select plan(39);

select id as br2 from public.branches where code = 'BR2' \gset
select tests.create_staff('Officer Two', 'loan_officer', 'BR2') as officer_id \gset
select tests.create_staff('Cashier Two', 'cashier', 'BR2') as cashier_id \gset
select tests.create_staff('Manager One', 'manager') as manager_id \gset
select tests.create_staff('Manager Two', 'manager') as manager2_id \gset
select tests.create_staff('Chief Exec', 'ceo') as ceo_id \gset
select tests.create_staff('Accountant One', 'accountant') as accountant_id \gset
select tests.create_staff('Admin One', 'admin') as admin_id \gset

update public.settings set value = '{"at": "2026-02-12T07:10:00Z", "frozen": true}' where key = 'clock.override_at';
update public.settings set value = 'null' where key = 'migration.go_live_date';

-- Two customers created by the officer (test-only phone range).
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Mariama", "last_name": "Test", "phone": "0998 555 010",
  "id_type": "national_id", "id_number": "T2-0012345", "occupation": "Market trader"}')$$);
select tests.try_as('authenticated', :'officer_id', $$select public.create_customer('{
  "type": "individual", "first_name": "Esther", "last_name": "Test", "phone": "0998 555 021",
  "id_type": "national_id", "id_number": "T2-0012346"}')$$);
select id as mariama from public.customers where id_number = 'T2-0012345' \gset
select id as esther from public.customers where id_number = 'T2-0012346' \gset

-- Who may request an edit (SPEC 4: officer, cashier, manager, admin; not accountant or CEO).
select matches(tests.try_as('authenticated', :'accountant_id', format(
  $$select public.request_customer_edit('%s', '{"phone": "0998 555 011"}', null)$$, :'mariama')),
  '^FORBIDDEN', 'an accountant cannot request a customer edit');
select matches(tests.try_as('authenticated', :'ceo_id', format(
  $$select public.request_customer_edit('%s', '{"phone": "0998 555 011"}', null)$$, :'mariama')),
  '^FORBIDDEN', 'the CEO cannot request a customer edit');

-- T-29: the officer's edit changes nothing until approved.
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.request_customer_edit('%s', '{"phone": "0998 555 011", "occupation": "Market trader"}', 'New SIM card')$$,
  :'mariama')), null, 'T-29: a loan officer requests a phone change');
select id as edit_request from public.approval_requests where entity_id = :'mariama' and status = 'pending' \gset
select is((select phone from public.customers where id = :'mariama'), '0998 555 010',
  'T-29: the record is unchanged while the request waits');
select results_eq(
  format($$select type, required_role::text, payload -> 'changes' from public.approval_requests where id = '%s'$$, :'edit_request'),
  $$values ('customer_edit'::text, 'manager'::text, '{"phone": {"before": "0998 555 010", "after": "0998 555 011"}}'::jsonb)$$,
  'only changed fields are stored, with the value before and after');
select is((select count(*)::int from public.audit_log where action = 'approval.requested' and entity_id = :'edit_request'), 1,
  'the request is audited');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"city": "Monrovia"}', null)$$, :'mariama')),
  '^INVALID_STATE', 'a second change waits until the first is decided');

-- Request validation.
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"code": "CU-999999"}', null)$$, :'esther')),
  '^INVALID_STATE', 'the code cannot be edited');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"phone": "0998 555 021"}', null)$$, :'esther')),
  '^INVALID_STATE', 'a request that changes nothing is refused');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"last_name": ""}', null)$$, :'esther')),
  '^INVALID_STATE', 'an edit must leave a valid record');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"phone": "+231 998 555 010"}', null)$$, :'esther')),
  '^DUPLICATE_CUSTOMER', 'an edit to another customer''s phone is a duplicate');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"status": "blacklisted"}', null)$$, :'esther')),
  '^INVALID_STATE', 'a status change needs a reason');
select matches(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"status": "blacklisted", "city": "x"}', 'Fraud')$$, :'esther')),
  '^INVALID_STATE', 'a status change is requested on its own');

-- Deciding.
select matches(tests.try_as('authenticated', :'officer_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'edit_request')), '^FORBIDDEN', 'a loan officer cannot decide');
select matches(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'reject', '  ')$$, :'edit_request')), '^INVALID_STATE', 'a rejection needs a reason');
select matches(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'maybe', null)$$, :'edit_request')), '^INVALID_STATE', 'the decision is approve or reject');
select is(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'edit_request')), null, 'T-29: a manager approves');
select is((select phone from public.customers where id = :'mariama'), '0998 555 011', 'T-29: the change is applied on approval');
select results_eq(
  format($$select before, after - 'approval_request_id' - 'requested_by', actor_id from public.audit_log
           where action = 'customer.updated' and entity_id = '%s'$$, :'mariama'),
  format($$values ('{"phone": "0998 555 010"}'::jsonb, '{"phone": "0998 555 011"}'::jsonb, '%s'::uuid)$$, :'manager_id'),
  'T-29: the audit row has before and after and names the approver');
select results_eq(
  format($$select status, decided_by from public.approval_requests where id = '%s'$$, :'edit_request'),
  format($$values ('approved'::text, '%s'::uuid)$$, :'manager_id'), 'the request records the decision');
select matches(tests.try_as('authenticated', :'manager2_id', format(
  $$select public.decide_approval('%s', 'reject', 'late')$$, :'edit_request')), '^INVALID_STATE', 'a decided request cannot be decided again');

-- Self-approval and stale requests.
select tests.try_as('authenticated', :'manager_id', format(
  $$select public.request_customer_edit('%s', '{"city": "Gbarnga"}', null)$$, :'esther'));
select id as own_request from public.approval_requests where entity_id = :'esther' and status = 'pending' \gset
select matches(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'own_request')), '^SELF_APPROVAL', 'a manager cannot approve their own request');
update public.customers set city = 'Kakata' where id = :'esther';
select matches(tests.try_as('authenticated', :'manager2_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'own_request')), '^INVALID_STATE',
  'a request is refused if the record changed after it was made');
select is(tests.try_as('authenticated', :'ceo_id', format(
  $$select public.decide_approval('%s', 'reject', 'Record changed; ask again')$$, :'own_request')), null,
  'the CEO can decide anything a manager can (reject)');
select is((select city from public.customers where id = :'esther'), 'Kakata', 'a rejection changes nothing');

-- Blacklisting is an approved edit of its own type.
select is(tests.try_as('authenticated', :'officer_id', format(
  $$select public.request_customer_edit('%s', '{"status": "blacklisted"}', 'Gave false ID details')$$, :'esther')),
  null, 'an officer requests blacklisting with a reason');
select id as blacklist_request from public.approval_requests where entity_id = :'esther' and status = 'pending' \gset
select is((select type from public.approval_requests where id = :'blacklist_request'), 'customer_blacklist',
  'the request has the blacklist type');
select is(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'approve', 'Confirmed with branch')$$, :'blacklist_request')), null, 'a manager approves');
select is((select status from public.customers where id = :'esther'), 'blacklisted', 'the customer is blacklisted');

-- A new photo through an edit: linked to the requester's upload on approval.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('documents', :'cashier_id' || '/new-photo.jpg', :'cashier_id', '{"mimetype": "image/jpeg", "size": 1500}');
select is(tests.try_as('authenticated', :'cashier_id', format(
  $$select public.request_customer_edit('%s', '{"photo": {"storage_path": "%s/new-photo.jpg", "file_name": "face.jpg"}}', null)$$,
  :'mariama', :'cashier_id')), null, 'a cashier requests a new photo');
select tests.try_as('authenticated', :'manager_id', format($$select public.decide_approval(
  (select id from public.approval_requests where entity_id = '%s' and status = 'pending'), 'approve', null)$$, :'mariama'));
select results_eq(
  format($$select c.photo_path, a.created_by from public.customers c join public.attachments a
             on a.entity_id = c.id and a.kind = 'photo' where c.id = '%s'$$, :'mariama'),
  format($$values ('%s/new-photo.jpg'::text, '%s'::uuid)$$, :'cashier_id', :'cashier_id'),
  'the photo is linked on approval and credited to the requester');

-- Manual journals and capital in are posted when approved, by the approver.
select tests.try_as('authenticated', :'accountant_id', format($$select public.request_manual_journal('{
  "entry_date": "2026-02-12", "memo": "Approval test rent", "branch_id": "%s",
  "lines": [{"account": "5010", "debit_cents": 12300}, {"account": "1010-BR2", "credit_cents": 12300}]}')$$, :'br2'));
select id as journal_request from public.approval_requests where type = 'manual_journal' and payload ->> 'memo' = 'Approval test rent' \gset
select matches(tests.try_as('authenticated', :'accountant_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'journal_request')), '^FORBIDDEN', 'the accountant cannot decide');
select is(tests.try_as('authenticated', :'manager_id', format(
  $$select public.decide_approval('%s', 'approve', null)$$, :'journal_request')), null, 'a manager approves the manual journal');
select results_eq(
  format($$select j.source_type, j.posted_by, sum(l.debit_cents)::bigint from public.journals j
           join public.journal_lines l on l.journal_id = j.id where j.source_id = '%s' group by 1, 2$$, :'journal_request'),
  format($$values ('manual_journal'::text, '%s'::uuid, 12300::bigint)$$, :'manager_id'),
  'the manual journal is posted, linked to the request');

select matches(tests.try_as('authenticated', :'officer_id', $$select public.request_capital_in('{
  "entry_date": "2026-02-12", "account": "1010-BR2", "amount_cents": 200000, "memo": "Owner top-up"}')$$),
  '^FORBIDDEN', 'a loan officer cannot request capital in');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_capital_in('{
  "entry_date": "2026-02-12", "account": "5010", "amount_cents": 200000, "memo": "Owner top-up"}')$$),
  '^INVALID_STATE', 'capital goes into a cash, bank or mobile money account');
select matches(tests.try_as('authenticated', :'accountant_id', $$select public.request_capital_in('{
  "entry_date": "2026-02-12", "account": "1010-BR2", "amount_cents": 2000.5, "memo": "Owner top-up"}')$$),
  '^INVALID_STATE', 'the amount is whole cents (no floats)');
select is(tests.try_as('authenticated', :'accountant_id', $$select public.request_capital_in('{
  "entry_date": "2026-02-12", "account": "1010-BR2", "amount_cents": 200000, "memo": "Owner capital for Branch 2",
  "reference": "Deposit slip 4411"}')$$), null, 'the accountant requests capital in');
select tests.try_as('authenticated', :'manager_id', $$select public.decide_approval(
  (select id from public.approval_requests where type = 'capital_in' and payload ->> 'memo' = 'Owner capital for Branch 2'),
  'approve', null)$$);
select results_eq(
  $$select a.code, l.debit_cents, l.credit_cents from public.journals j
      join public.journal_lines l on l.journal_id = j.id join public.accounts a on a.id = l.account_id
     where j.source_type = 'capital_in' and j.memo = 'Owner capital for Branch 2' order by l.line_no$$,
  $$values ('1010-BR2'::text, 200000::bigint, 0::bigint), ('3000', 0, 200000)$$,
  'R10: Dr branch cash, Cr 3000 Owner''s Capital');

select * from finish();
rollback;
