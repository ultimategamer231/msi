-- M3.7: issued documents (SPEC 7.5, 8: issue_document; FR-25). Every printed document gets a number
-- and a random verification token for the QR code (the public /verify page comes in M7). The loan
-- agreement is the first kind; receipts, statements and notices join in M4–M7.

create table public.issued_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('receipt', 'statement', 'loan_agreement', 'demand_notice',
                                     'collateral_receipt', 'collateral_release')),
  number text not null unique,
  entity_id uuid not null,
  token text not null unique check (length(token) >= 22),
  generated_by uuid not null references public.profiles (id),
  generated_at timestamptz not null default public.app_now(),
  is_void boolean not null default false
);

comment on table public.issued_documents is 'Numbered documents with verification tokens (SPEC 7.5); backs /verify/[token].';

create index issued_documents_entity_idx on public.issued_documents (kind, entity_id);
create index issued_documents_generated_by_idx on public.issued_documents (generated_by);

alter table public.issued_documents enable row level security;
create policy issued_documents_read on public.issued_documents
  for select to authenticated using ((select public.is_staff()));
revoke all on public.issued_documents from anon;
revoke insert, update, delete, truncate, references, trigger on public.issued_documents from authenticated, service_role;

-- issue_document (SPEC 8): returns the document row for the PDF route, creating it on first print.
-- A reprint returns the same number and token. Loan agreement: one per loan, numbered
-- AGR-<loan number>, available from approval on (it is signed before the cashier pays out).
create or replace function public.issue_document(p_kind text, p_entity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_doc issued_documents;
  v_token text;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if p_kind <> 'loan_agreement' then
    raise exception 'INVALID_STATE: this document kind is not available yet' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_entity_id;
  if not found or v_loan.status not in ('approved', 'active', 'overdue', 'recovery', 'closed', 'written_off') then
    raise exception 'INVALID_STATE: the agreement is printed once the loan is approved' using errcode = '22023';
  end if;

  select * into v_doc from issued_documents
   where kind = p_kind and entity_id = p_entity_id and not is_void
   order by generated_at limit 1;
  if not found then
    v_token := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
    insert into issued_documents (kind, number, entity_id, token, generated_by)
    values (p_kind, 'AGR-' || v_loan.loan_no, v_loan.id, v_token, auth.uid())
    returning * into v_doc;
    perform write_audit('document.issued', 'issued_document', v_doc.id::text, null,
      jsonb_build_object('kind', p_kind, 'number', v_doc.number, 'entity_id', p_entity_id));
  end if;
  return jsonb_build_object('id', v_doc.id, 'kind', v_doc.kind, 'number', v_doc.number, 'token', v_doc.token,
                            'generated_at', v_doc.generated_at, 'generated_by', v_doc.generated_by);
end
$$;

revoke execute on function public.issue_document(text, uuid) from public, anon, service_role;
grant execute on function public.issue_document(text, uuid) to authenticated;

-- Placeholder agreement wording (SPEC 10.1: legal text lives in settings.templates and must be
-- reviewed by MSI's lawyer). Added to databases that already have templates; seed_core carries it
-- for new ones.
update public.settings
   set value = value || jsonb_build_object('loan_agreement',
     '[PLACEHOLDER: to be reviewed by MSI''s lawyer before use] The borrower agrees to repay the total amount shown by the due date. Interest is charged once, at payout. If any amount is still unpaid after the due date, a penalty of {penalty_rate} of the amount then owed is added every {penalty_days} days, up to {penalty_max} times. The collateral listed below is held by {company} until the loan is repaid in full and may be sold under the recovery policy if the loan is not repaid. Payments are applied first to penalties, then to interest, then to the amount lent.')
 where key = 'templates' and not (value ? 'loan_agreement');
