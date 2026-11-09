-- M9.1: opening balances for the move from paper and Excel (SPEC 8 import_opening_balance, R12;
-- FR-27; A-19). Admin or accountant, only before migration.go_live_date. Balance-sheet accounts
-- only; the difference goes to 3900 Opening Balance Equity. Loans are not entered here: they are
-- recorded as loans with back-dated payout and payments (A-19), so every loan keeps its history.
-- Input: {"entry_date": "YYYY-MM-DD", "memo": "...",
--         "lines": [{"account": "1020", "debit_cents": 150000}, {"account": "2000", "credit_cents": 20000, "payee_id": uuid}]}
create or replace function public.import_opening_balance(p_entry jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_memo text := btrim(coalesce(p_entry ->> 'memo', ''));
  v_go_live date;
  v_line jsonb;
  v_account accounts;
  v_debit bigint;
  v_credit bigint;
  v_total bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  v_journal uuid;
begin
  perform require_role('admin', 'accountant');
  select (value #>> '{}')::date into v_go_live from settings where key = 'migration.go_live_date';
  if v_go_live is not null and business_today() >= v_go_live then
    raise exception 'DATE_NOT_ALLOWED: opening balances are entered before go-live' using errcode = '42501';
  end if;
  begin
    v_date := (p_entry ->> 'entry_date')::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or v_date > business_today() or (v_go_live is not null and v_date >= v_go_live) then
    raise exception 'DATE_NOT_ALLOWED: opening balances are dated before go-live' using errcode = '42501';
  end if;
  if v_memo = '' or length(v_memo) > 500 then
    raise exception 'INVALID_STATE: an opening balance needs a memo (up to 500 characters)' using errcode = '22023';
  end if;
  if jsonb_typeof(p_entry -> 'lines') <> 'array' or jsonb_array_length(p_entry -> 'lines') not between 1 and 30 then
    raise exception 'INVALID_STATE: enter 1 to 30 lines' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_entry -> 'lines') loop
    select * into v_account from accounts where code = v_line ->> 'account' and active;
    if not found or v_account.type not in ('asset', 'liability', 'equity')
       or v_account.code in ('1100', '1110', '1120', '1015', '3900') then
      raise exception 'INVALID_STATE: % cannot take an opening balance here (loans are entered as loans)',
        coalesce(v_line ->> 'account', '') using errcode = '22023';
    end if;
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'INVALID_STATE: each line is a debit or a credit above zero' using errcode = '22023';
    end if;
    if nullif(v_line ->> 'payee_id', '') is not null
       and not exists (select 1 from payees where id = (v_line ->> 'payee_id')::uuid) then
      raise exception 'INVALID_STATE: the payee does not exist' using errcode = '22023';
    end if;
    v_total := v_total + v_debit - v_credit;
    v_lines := v_lines || jsonb_strip_nulls(jsonb_build_object(
      'account', v_account.code, 'debit_cents', nullif(v_debit, 0), 'credit_cents', nullif(v_credit, 0),
      'payee_id', nullif(v_line ->> 'payee_id', '')));
  end loop;
  if v_total > 0 then
    v_lines := v_lines || jsonb_build_object('account', '3900', 'credit_cents', v_total);
  elsif v_total < 0 then
    v_lines := v_lines || jsonb_build_object('account', '3900', 'debit_cents', -v_total);
  end if;
  v_journal := post_journal(v_date, v_memo, 'opening_balance', null, null, v_lines);       -- R12
  perform write_audit('ledger.opening_balance', 'journal', v_journal::text, null,
                      jsonb_build_object('entry_date', v_date, 'memo', v_memo, 'lines', v_lines));
  return jsonb_build_object('journal_id', v_journal, 'journal_no', (select journal_no from journals where id = v_journal),
                            'equity_cents', v_total);
end
$$;
revoke execute on function public.import_opening_balance(jsonb) from public, anon, service_role;
grant execute on function public.import_opening_balance(jsonb) to authenticated;
