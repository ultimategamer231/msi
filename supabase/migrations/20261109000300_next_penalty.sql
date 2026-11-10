-- M5.2: the next penalty on the loan page (mock-up 07: "Next penalty 19 Feb 2026: $288.00"). The
-- amount is what the job would charge if nothing changes before that date, from the same pct()
-- and base rule; staff only. Null when no further penalty can be charged.
create or replace function public.loan_next_penalty(p_loan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_next date;
  v_owed bigint;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select next_penalty_on into v_next from loan_balance_rows() where loan_id = p_loan_id;
  if v_next is null then
    return null;
  end if;
  select * into v_loan from loans where id = p_loan_id;
  select penalty_cents + interest_cents + principal_cents into v_owed from loan_owed(p_loan_id);
  return jsonb_build_object(
    'on', v_next,
    'period_no', (v_next - v_loan.due_date) / v_loan.penalty_period_days,
    'cents', pct(case v_loan.penalty_base when 'original_due' then v_loan.principal_cents + v_loan.interest_cents
                                          else v_owed end, v_loan.penalty_rate_bps));
end
$$;

revoke execute on function public.loan_next_penalty(uuid) from public, anon, service_role;
grant execute on function public.loan_next_penalty(uuid) to authenticated;
