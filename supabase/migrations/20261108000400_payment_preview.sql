-- M4.4: read-only payment preview for the receive-payment screen (SPEC 9 /payments/new: "shows
-- allocation preview"). The split comes from the same loan_owed and allocate_amount that
-- take_payment posts with, so no allocation rule is written in TypeScript (CLAUDE.md rule 2).
create or replace function public.preview_payment(p_loan_id uuid, p_amount_cents bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owed record;
  v_total bigint;
  v_amount bigint := greatest(coalesce(p_amount_cents, 0), 0);
  v_split jsonb;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if not exists (select 1 from loans where id = p_loan_id) then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  select * into v_owed from loan_owed(p_loan_id);
  v_total := v_owed.penalty_cents + v_owed.interest_cents + v_owed.principal_cents;
  v_split := allocate_amount(least(v_amount, v_total), v_owed.penalty_cents, v_owed.interest_cents,
                             v_owed.principal_cents);
  return jsonb_build_object(
    'owed', jsonb_build_object('penalty', v_owed.penalty_cents, 'interest', v_owed.interest_cents,
                               'principal', v_owed.principal_cents, 'total', v_total),
    'allocation', v_split - 'unallocated',
    'after_cents', v_total - least(v_amount, v_total),
    'overpayment', v_amount > v_total);
end
$$;

revoke execute on function public.preview_payment(uuid, bigint) from public, anon, service_role;
grant execute on function public.preview_payment(uuid, bigint) to authenticated;
