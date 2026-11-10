-- M4.2: field collection (SPEC 5.4.2–3, 5.4.8; FR-11; recipes R3, R3b; T-28, T-36).
-- B-09 default (answer pending): field cash goes to 1015 Field Cash until the cashier confirms the
-- handover; mobile money and bank collected in the field go straight to 1030/1020 with a reference
-- and need no handover.

-- record_field_payment (SPEC 8): a loan officer, for loans of their own branch, dated today.
create or replace function public.record_field_payment(
  p_loan_id uuid, p_amount_cents bigint, p_method text, p_reference text, p_received_on date,
  p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_role('loan_officer');
  if not exists (select 1 from payments where received_by = auth.uid() and idempotency_key = btrim(coalesce(p_idempotency_key, '')))
     and (select branch_id from loans where id = p_loan_id) is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a loan officer collects for loans of their own branch' using errcode = '42501';
  end if;
  return take_payment(p_loan_id, p_amount_cents, p_method, p_reference, p_received_on, p_idempotency_key, true);
end
$$;

revoke execute on function public.record_field_payment(uuid, bigint, text, text, date, text) from public, anon, service_role;
grant execute on function public.record_field_payment(uuid, bigint, text, text, date, text) to authenticated;

-- confirm_remittance (SPEC 5.4.3, 5.4.8): the cashier counts the cash an officer hands over. The
-- counted total must equal the selected collections exactly (T-36: REMITTANCE_MISMATCH, nothing
-- posted). Posts R3b: Dr the branch cash account, Cr 1015 per collector (T-28).
create or replace function public.confirm_remittance(p_payment_ids uuid[], p_counted_total_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('cashier', 'manager');
  v_count int;
  v_found int;
  v_total bigint;
  v_branches uuid[];
  v_branch uuid;
  v_cash accounts;
  v_lines jsonb;
  v_journal uuid;
  v_collector record;
begin
  v_count := coalesce(cardinality(p_payment_ids), 0);
  if v_count = 0 then
    raise exception 'INVALID_STATE: choose the collections being handed over' using errcode = '22023';
  end if;
  if p_counted_total_cents is null or p_counted_total_cents < 0 then
    raise exception 'INVALID_STATE: enter the counted total' using errcode = '22023';
  end if;

  perform 1 from payments where id = any (p_payment_ids) order by id for update;
  select count(*), coalesce(sum(amount_cents), 0), array_agg(distinct branch_id)
    into v_found, v_total, v_branches
    from payments
   where id = any (p_payment_ids) and status = 'posted' and collected_in_field and remittance_status = 'pending';
  if v_found <> v_count then
    raise exception 'INVALID_STATE: only field cash still waiting for handover can be confirmed' using errcode = '22023';
  end if;
  if cardinality(v_branches) <> 1 then
    raise exception 'INVALID_STATE: confirm one branch''s collections at a time' using errcode = '22023';
  end if;
  v_branch := v_branches[1];
  if v_role = 'cashier' and v_branch is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a cashier confirms field cash of their own branch' using errcode = '42501';
  end if;
  if p_counted_total_cents <> v_total then
    raise exception 'REMITTANCE_MISMATCH: counted % but the selected collections total %', p_counted_total_cents, v_total
      using errcode = '22023';
  end if;

  select * into v_cash from accounts where is_cash and active and branch_id = v_branch;
  v_lines := jsonb_build_array(jsonb_build_object('account', v_cash.code, 'debit_cents', v_total));
  for v_collector in
    select received_by, sum(amount_cents)::bigint as amount from payments where id = any (p_payment_ids)
     group by received_by order by received_by loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account', '1015', 'credit_cents', v_collector.amount, 'staff_id', v_collector.received_by));
  end loop;
  v_journal := post_journal(business_today(), 'Field cash handed over (' || v_count || ' receipts)', 'remittance',
                            null, v_branch, v_lines);

  update payments
     set remittance_status = 'confirmed', remittance_confirmed_by = auth.uid(), remittance_confirmed_at = app_now(),
         remittance_journal_id = v_journal
   where id = any (p_payment_ids);
  perform write_audit('remittance.confirmed', 'journal', v_journal::text, null,
    jsonb_build_object('payment_ids', to_jsonb(p_payment_ids), 'total_cents', v_total, 'branch_id', v_branch));
  return jsonb_build_object('journal_id', v_journal, 'journal_no', (select journal_no from journals where id = v_journal),
                            'total_cents', v_total, 'count', v_count);
end
$$;

revoke execute on function public.confirm_remittance(uuid[], bigint) from public, anon, service_role;
grant execute on function public.confirm_remittance(uuid[], bigint) to authenticated;
