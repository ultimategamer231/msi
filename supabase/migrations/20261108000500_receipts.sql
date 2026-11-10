-- M4.5: receipts (SPEC 10.1, FR-25). issue_document now serves receipts, numbered with the
-- payment's receipt number; a voided payment's receipt is issued as void (it prints "VOID").
create or replace function public.issue_document(p_kind text, p_entity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_payment payments;
  v_doc issued_documents;
  v_token text;
  v_number text;
  v_void boolean := false;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if p_kind = 'loan_agreement' then
    select * into v_loan from loans where id = p_entity_id;
    if not found or v_loan.status not in ('approved', 'active', 'overdue', 'recovery', 'closed', 'written_off') then
      raise exception 'INVALID_STATE: the agreement is printed once the loan is approved' using errcode = '22023';
    end if;
    v_number := 'AGR-' || v_loan.loan_no;
    select * into v_doc from issued_documents
     where kind = p_kind and entity_id = p_entity_id and not is_void
     order by generated_at limit 1;
  elsif p_kind = 'receipt' then
    select * into v_payment from payments where id = p_entity_id;
    if not found then
      raise exception 'INVALID_STATE: the payment does not exist' using errcode = 'P0002';
    end if;
    v_number := v_payment.receipt_no;
    v_void := v_payment.status = 'voided';
    -- One receipt per payment: a reprint, also after a void, returns the same number and token.
    select * into v_doc from issued_documents where kind = p_kind and entity_id = p_entity_id;
  else
    raise exception 'INVALID_STATE: this document kind is not available yet' using errcode = '22023';
  end if;

  if not found then
    v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
    insert into issued_documents (kind, number, entity_id, token, generated_by, is_void)
    values (p_kind, v_number, p_entity_id, v_token, auth.uid(), v_void)
    returning * into v_doc;
    perform write_audit('document.issued', 'issued_document', v_doc.id::text, null,
      jsonb_build_object('kind', p_kind, 'number', v_doc.number, 'entity_id', p_entity_id));
  end if;
  return jsonb_build_object('id', v_doc.id, 'kind', v_doc.kind, 'number', v_doc.number, 'token', v_doc.token,
                            'generated_at', v_doc.generated_at, 'generated_by', v_doc.generated_by,
                            'is_void', v_doc.is_void);
end
$$;

revoke execute on function public.issue_document(text, uuid) from public, anon, service_role;
grant execute on function public.issue_document(text, uuid) to authenticated;

-- "Balance after payment" on the receipt (SPEC 10.1): what the loan owed right after this payment's
-- journal, from the ledger in posting order. Later penalties, payments or a void do not change it.
-- Staff only; journal_lines stays finance-only (T-31).
create or replace function public.receipt_balance_after(p_payment_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_chain bigint;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    raise exception 'INVALID_STATE: the payment does not exist' using errcode = 'P0002';
  end if;
  select chain_no into v_chain from journals where id = v_payment.journal_id;
  return (select coalesce(sum(l.debit_cents - l.credit_cents), 0)::bigint
            from journal_lines l join journals j on j.id = l.journal_id
           where l.loan_id = v_payment.loan_id and l.component is not null and j.chain_no <= v_chain);
end
$$;

revoke execute on function public.receipt_balance_after(uuid) from public, anon, service_role;
grant execute on function public.receipt_balance_after(uuid) to authenticated;
