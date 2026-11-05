-- M3.3: loan application workflow (SPEC 5.3, 8; FR-07): draft, submit with approval routing by
-- amount (A-07: approvals.loan_manager_limit_cents), decision through decide_approval with
-- creator ≠ approver (T-17, T-18, T-19), cancel. Status changes happen only here and are audited.

-- Document kinds per record type (customer from M2; loan documents now).
create or replace function public.link_attachments(p_entity_type text, p_entity_id uuid, p_files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file jsonb;
  v_claim jsonb;
  v_kind text;
  v_name text;
  v_linked jsonb := '[]'::jsonb;
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return v_linked;
  end if;
  if jsonb_array_length(p_files) > 10 then
    raise exception 'INVALID_STATE: at most 10 files at a time' using errcode = '22023';
  end if;
  for v_file in select value from jsonb_array_elements(p_files) loop
    v_kind := v_file ->> 'kind';
    v_name := left(btrim(coalesce(v_file ->> 'file_name', '')), 200);
    if (p_entity_type = 'customer' and v_kind not in ('photo', 'id_document', 'proof_of_address', 'other'))
       or (p_entity_type = 'loan' and v_kind not in ('guarantor_id', 'signed_agreement', 'other'))
       or p_entity_type not in ('customer', 'loan') then
      raise exception 'INVALID_STATE: unknown document kind' using errcode = '22023';
    end if;
    if v_name = '' then
      raise exception 'INVALID_STATE: a file needs a name' using errcode = '22023';
    end if;
    v_claim := claim_upload(v_file ->> 'storage_path', v_kind = 'photo');
    insert into attachments (entity_type, entity_id, kind, storage_path, file_name, mime, size_bytes, created_by)
    values (p_entity_type, p_entity_id, v_kind, v_claim ->> 'storage_path', v_name, v_claim ->> 'mime',
            (v_claim ->> 'size_bytes')::bigint, auth.uid());
    v_linked := v_linked || jsonb_build_object('kind', v_kind, 'storage_path', v_claim ->> 'storage_path',
                                               'file_name', v_name);
  end loop;
  return v_linked;
end
$$;

revoke execute on function public.link_attachments(text, uuid, jsonb) from public, anon, authenticated, service_role;

-- Checks the parts of a loan application shared by create and update. Returns the cleaned values
-- {customer, product, principal_cents, term_months, purpose, branch_id, officer_id}.
create or replace function public.check_loan_application(p_loan jsonb, p_role app_role)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer customers;
  v_product loan_products;
  v_principal bigint;
  v_term int;
  v_purpose text := nullif(btrim(coalesce(p_loan ->> 'purpose', '')), '');
  v_officer uuid;
begin
  select * into v_customer from customers where id = nullif(p_loan ->> 'customer_id', '')::uuid;
  if not found then
    raise exception 'INVALID_STATE: choose a customer' using errcode = '22023';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'INVALID_STATE: the customer is % and cannot get a new loan', v_customer.status using errcode = '22023';
  end if;
  if p_role = 'loan_officer' and v_customer.branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a loan officer applies for customers of their own branch' using errcode = '42501';
  end if;
  select * into v_product from loan_products where id = nullif(p_loan ->> 'product_id', '')::uuid and active;
  if not found then
    raise exception 'INVALID_STATE: choose an active loan product' using errcode = '22023';
  end if;
  if jsonb_typeof(p_loan -> 'principal_cents') <> 'number' or (p_loan ->> 'principal_cents') !~ '^[0-9]+$'
     or (p_loan ->> 'principal_cents')::numeric <= 0 or (p_loan ->> 'principal_cents')::numeric > 100000000000 then
    raise exception 'INVALID_STATE: the amount must be a positive whole number of cents' using errcode = '22023';
  end if;
  v_principal := (p_loan ->> 'principal_cents')::bigint;
  if jsonb_typeof(p_loan -> 'term_months') <> 'number' or (p_loan ->> 'term_months') !~ '^[0-9]+$' then
    raise exception 'INVALID_STATE: the term must be a whole number of months' using errcode = '22023';
  end if;
  v_term := (p_loan ->> 'term_months')::int;
  if v_term < 1 or v_term > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term must be 1 to % months', v_product.max_term_months using errcode = '22023';
  end if;
  if length(v_purpose) > 300 then
    raise exception 'INVALID_STATE: the purpose is too long (300 characters at most)' using errcode = '22023';
  end if;
  v_officer := case when p_role = 'loan_officer' then auth.uid()
                    else coalesce(nullif(p_loan ->> 'officer_id', '')::uuid, v_customer.assigned_officer_id) end;
  if v_officer is not null and not exists (
       select 1 from profiles where id = v_officer and active and role = 'loan_officer' and branch_id = v_customer.branch_id) then
    raise exception 'INVALID_STATE: the loan officer must be active and work at the customer''s branch' using errcode = '22023';
  end if;
  return jsonb_build_object('customer_id', v_customer.id, 'product_id', v_product.id, 'principal_cents', v_principal,
                            'term_months', v_term, 'purpose', v_purpose, 'branch_id', v_customer.branch_id,
                            'officer_id', v_officer);
end
$$;

revoke execute on function public.check_loan_application(jsonb, app_role) from public, anon, authenticated, service_role;

-- Replaces the guarantors of a draft (clean_guarantors rules); a guarantor's ID scan is linked
-- as a loan document and kept in doc_path.
create or replace function public.store_guarantors(p_loan_id uuid, p_guarantors jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_doc jsonb;
  v_count int := 0;
begin
  delete from guarantors where loan_id = p_loan_id;
  for v_item in select value from jsonb_array_elements(clean_guarantors(p_guarantors)) loop
    v_doc := null;
    if v_item ? 'doc' and v_item -> 'doc' <> 'null'::jsonb then
      v_doc := link_attachments('loan', p_loan_id, jsonb_build_array(
        jsonb_build_object('kind', 'guarantor_id', 'storage_path', v_item #>> '{doc,storage_path}',
                           'file_name', v_item #>> '{doc,file_name}'))) -> 0;
    end if;
    insert into guarantors (loan_id, full_name, phone, address, id_type, id_number, relationship, doc_path, created_by)
    values (p_loan_id, v_item ->> 'full_name', v_item ->> 'phone', v_item ->> 'address', v_item ->> 'id_type',
            v_item ->> 'id_number', v_item ->> 'relationship', v_doc ->> 'storage_path', auth.uid());
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

revoke execute on function public.store_guarantors(uuid, jsonb) from public, anon, authenticated, service_role;

-- create_loan_draft (SPEC 8; SPEC 4: loan officer or manager). Input:
-- {"customer_id", "product_id", "principal_cents", "term_months", "purpose", "officer_id" (manager),
--  "guarantors": [{"full_name", "phone", ..., "doc": {"storage_path", "file_name"}}]}
-- The loan gets its number now (B-02); returns the loan id.
create or replace function public.create_loan_draft(p_loan jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager');
  v_app jsonb := check_loan_application(p_loan, v_role);
  v_id uuid := gen_random_uuid();
  v_no text;
  v_guarantors int;
begin
  v_no := next_number('loan', (v_app ->> 'branch_id')::uuid);
  insert into loans (id, loan_no, customer_id, product_id, branch_id, officer_id, created_by, principal_cents,
                     term_months, purpose, status)
  values (v_id, v_no, (v_app ->> 'customer_id')::uuid, (v_app ->> 'product_id')::uuid, (v_app ->> 'branch_id')::uuid,
          (v_app ->> 'officer_id')::uuid, auth.uid(), (v_app ->> 'principal_cents')::bigint,
          (v_app ->> 'term_months')::int, v_app ->> 'purpose', 'draft');
  v_guarantors := store_guarantors(v_id, p_loan -> 'guarantors');
  perform write_audit('loan.created', 'loan', v_id::text, null,
    v_app || jsonb_build_object('loan_no', v_no, 'status', 'draft', 'guarantors', v_guarantors));
  return v_id;
end
$$;

revoke execute on function public.create_loan_draft(jsonb) from public, anon, service_role;
grant execute on function public.create_loan_draft(jsonb) to authenticated;

-- update_loan_draft (SPEC 5.3: only a draft, only by its creator).
create or replace function public.update_loan_draft(p_loan_id uuid, p_loan jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager');
  v_loan loans;
  v_app jsonb;
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.created_by <> auth.uid() then
    raise exception 'FORBIDDEN: only the person who created the draft can change it' using errcode = '42501';
  end if;
  if v_loan.status <> 'draft' then
    raise exception 'INVALID_STATE: only a draft can be changed' using errcode = '22023';
  end if;
  v_app := check_loan_application(p_loan, v_role);
  if (v_app ->> 'customer_id')::uuid <> v_loan.customer_id then
    raise exception 'INVALID_STATE: the customer of a draft cannot change; cancel it and start again' using errcode = '22023';
  end if;
  update loans set product_id = (v_app ->> 'product_id')::uuid, officer_id = (v_app ->> 'officer_id')::uuid,
                   principal_cents = (v_app ->> 'principal_cents')::bigint, term_months = (v_app ->> 'term_months')::int,
                   purpose = v_app ->> 'purpose', updated_at = app_now()
   where id = v_loan.id;
  if p_loan ? 'guarantors' then
    perform store_guarantors(v_loan.id, p_loan -> 'guarantors');
  end if;
  perform write_audit('loan.updated', 'loan', v_loan.id::text,
    jsonb_build_object('product_id', v_loan.product_id, 'principal_cents', v_loan.principal_cents,
                       'term_months', v_loan.term_months, 'purpose', v_loan.purpose, 'officer_id', v_loan.officer_id),
    v_app - 'customer_id' - 'branch_id');
end
$$;

revoke execute on function public.update_loan_draft(uuid, jsonb) from public, anon, service_role;
grant execute on function public.update_loan_draft(uuid, jsonb) to authenticated;

-- submit_loan (SPEC 8): snapshot of the product rules and the collateral rule, interest computed
-- with the same helpers as the preview, approval routed by amount (A-07): above the manager limit
-- the CEO decides (T-18), up to it a manager (T-19).
create or replace function public.submit_loan(p_loan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_product loan_products;
  v_customer customers;
  v_limit bigint;
  v_role app_role;
  v_interest bigint;
  v_request uuid;
  v_payload jsonb;
begin
  perform require_role('loan_officer', 'manager');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.created_by <> auth.uid() then
    raise exception 'FORBIDDEN: only the person who created the draft can submit it' using errcode = '42501';
  end if;
  if v_loan.status <> 'draft' then
    raise exception 'INVALID_STATE: only a draft can be submitted' using errcode = '22023';
  end if;
  select * into v_customer from customers where id = v_loan.customer_id;
  if v_customer.status <> 'active' then
    raise exception 'INVALID_STATE: the customer is % and cannot get a new loan', v_customer.status using errcode = '22023';
  end if;
  select * into v_product from loan_products where id = v_loan.product_id and active;
  if not found then
    raise exception 'INVALID_STATE: the loan product is no longer offered; choose another' using errcode = '22023';
  end if;
  if v_loan.term_months > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term is longer than the product allows' using errcode = '22023';
  end if;

  select (value #>> '{}')::bigint into v_limit from settings where key = 'approvals.loan_manager_limit_cents';
  v_role := (case when v_loan.principal_cents > v_limit then 'ceo' else 'manager' end)::app_role;
  v_interest := flat_interest(v_loan.principal_cents, v_product.interest_rate_bps, v_loan.term_months);

  update loans set
    status = 'pending_approval', submitted_at = app_now(), updated_at = app_now(),
    interest_rate_bps = v_product.interest_rate_bps, interest_cents = v_interest,
    penalty_rate_bps = v_product.penalty_rate_bps, penalty_period_days = v_product.penalty_period_days,
    penalty_base = v_product.penalty_base, penalty_max_periods = v_product.penalty_max_periods,
    recovery_after_days = v_product.recovery_after_days,
    collateral_required = coalesce((select (value #>> '{}')::boolean from settings where key = 'loans.collateral_required'), true)
  where id = v_loan.id;

  v_payload := jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'customer_id', v_customer.id, 'customer_code', v_customer.code,
    'customer_name', customer_display_name(v_customer), 'product', v_product.name,
    'principal_cents', v_loan.principal_cents, 'interest_cents', v_interest,
    'total_due_cents', v_loan.principal_cents + v_interest, 'term_months', v_loan.term_months,
    'interest_rate_bps', v_product.interest_rate_bps, 'limit_cents', v_limit, 'purpose', v_loan.purpose);
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('loan_approval', 'loan', v_loan.id, v_payload, v_role, v_loan.purpose, auth.uid())
  returning id into v_request;

  perform write_audit('loan.submitted', 'loan', v_loan.id::text, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'pending_approval', 'required_role', v_role, 'interest_cents', v_interest,
                       'approval_request_id', v_request));
  perform write_audit('approval.requested', 'approval_request', v_request::text, null,
    jsonb_build_object('type', 'loan_approval', 'required_role', v_role, 'payload', v_payload));
  return v_request;
end
$$;

revoke execute on function public.submit_loan(uuid) from public, anon, service_role;
grant execute on function public.submit_loan(uuid) to authenticated;

-- cancel_loan: a draft by its creator; an approved loan (not yet paid out) by its creator or a
-- manager. A reason is required for an approved loan.
create or replace function public.cancel_loan(p_loan_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager', 'ceo');
  v_loan loans;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.status = 'draft' then
    if v_loan.created_by <> auth.uid() then
      raise exception 'FORBIDDEN: only the person who created the draft can cancel it' using errcode = '42501';
    end if;
  elsif v_loan.status = 'approved' then
    if v_loan.created_by <> auth.uid() and v_role not in ('manager', 'ceo') then
      raise exception 'FORBIDDEN: only the creator or a manager can cancel an approved loan' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'INVALID_STATE: give a reason for cancelling an approved loan' using errcode = '22023';
    end if;
  else
    raise exception 'INVALID_STATE: only a draft or an approved loan that is not paid out can be cancelled'
      using errcode = '22023';
  end if;
  update loans set status = 'cancelled', updated_at = app_now() where id = v_loan.id;
  perform write_audit('loan.cancelled', 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
                      jsonb_build_object('status', 'cancelled', 'reason', v_reason));
end
$$;

revoke execute on function public.cancel_loan(uuid, text) from public, anon, service_role;
grant execute on function public.cancel_loan(uuid, text) to authenticated;

-- Applies a decision on a loan application (SPEC 5.3): the loan's creator never approves it (T-17).
create or replace function public.apply_loan_decision(p_request public.approval_requests, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_status text := case when p_decision = 'approve' then 'approved' else 'rejected' end;
begin
  select * into v_loan from loans where id = p_request.entity_id for update;
  if not found or v_loan.status <> 'pending_approval' then
    raise exception 'INVALID_STATE: the loan is not waiting for approval' using errcode = '22023';
  end if;
  if v_loan.created_by = auth.uid() then
    raise exception 'SELF_APPROVAL: you cannot approve a loan you created' using errcode = '42501';
  end if;
  if p_decision = 'approve'
     and (select status from customers where id = v_loan.customer_id) <> 'active' then
    raise exception 'INVALID_STATE: the customer is no longer active; reject the loan' using errcode = '22023';
  end if;
  update loans set status = v_status, updated_at = app_now(),
                   approved_by = case when p_decision = 'approve' then auth.uid() end,
                   approved_at = case when p_decision = 'approve' then app_now() end
   where id = v_loan.id;
  perform write_audit('loan.' || v_status, 'loan', v_loan.id::text, jsonb_build_object('status', v_loan.status),
                      jsonb_build_object('status', v_status, 'approval_request_id', p_request.id, 'note', p_note));
  return jsonb_build_object('loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'status', v_status);
end
$$;

revoke execute on function public.apply_loan_decision(public.approval_requests, text, text)
  from public, anon, authenticated, service_role;

-- decide_approval, now also for loan applications (approve and reject both change the loan).
create or replace function public.decide_approval(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('manager', 'ceo');
  v_request approval_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_result jsonb := '{}'::jsonb;
  v_journal uuid;
begin
  select * into v_request from approval_requests where id = p_id for update;
  if not found then
    raise exception 'INVALID_STATE: the request does not exist' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'INVALID_STATE: this request was already decided' using errcode = '22023';
  end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'SELF_APPROVAL: you cannot decide a request you made' using errcode = '42501';
  end if;
  if v_request.required_role = 'ceo' and v_role <> 'ceo' then
    raise exception 'FORBIDDEN: only the CEO can decide this request' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_STATE: the decision must be approve or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_note is null then
    raise exception 'INVALID_STATE: give a reason for the rejection' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'INVALID_STATE: the note is too long (500 characters at most)' using errcode = '22023';
  end if;

  if v_request.type = 'loan_approval' then
    v_result := apply_loan_decision(v_request, p_decision, v_note);
  elsif p_decision = 'approve' then
    case v_request.type
      when 'customer_edit', 'customer_blacklist' then
        v_result := apply_customer_edit(v_request);
      when 'manual_journal', 'capital_in' then
        perform require_posting_date((v_request.payload ->> 'entry_date')::date);
        v_journal := post_journal((v_request.payload ->> 'entry_date')::date, v_request.payload ->> 'memo',
                                  v_request.type, v_request.id, nullif(v_request.payload ->> 'branch_id', '')::uuid,
                                  v_request.payload -> 'lines');
        v_result := jsonb_build_object('journal_id', v_journal,
                                       'journal_no', (select journal_no from journals where id = v_journal));
      else
        raise exception 'INVALID_STATE: requests of this type cannot be decided yet' using errcode = '22023';
    end case;
  end if;

  update approval_requests
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = app_now(), decision_note = v_note
   where id = v_request.id;

  perform write_audit(case when p_decision = 'approve' then 'approval.approved' else 'approval.rejected' end,
    'approval_request', v_request.id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
                       'type', v_request.type, 'note', v_note, 'result', v_result));
  return v_result;
end
$$;

revoke execute on function public.decide_approval(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;
