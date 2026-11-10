-- M5.3: due list (SPEC 7.7, 9 /due; FR-13; B-07, B-18). The "due soon" window is a setting,
-- due.upcoming_days (default 7, B-07). Buckets: due today, due within the window, overdue 1-7,
-- 8-30 and 31+ days (B-18). Loans in recovery are listed on the recovery screen, not here.

insert into public.settings (key, value) values ('due.upcoming_days', '7') on conflict (key) do nothing;

create or replace function public.validate_setting(p_key text, p_value jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_field text;
begin
  if p_value is null then
    perform setting_error(p_key, 'needs a value');
  end if;

  case p_key
    when 'currency.base' then
      -- A-01: USD only in the MVP. LRD needs the multi-currency work in phase 2.
      if p_value <> '"USD"'::jsonb then
        perform setting_error(p_key, 'must be "USD" in this release');
      end if;

    when 'accounting.basis' then
      -- A-15: accrual is the only basis the posting recipes implement.
      if p_value <> '"accrual"'::jsonb then
        perform setting_error(p_key, 'must be "accrual" in this release');
      end if;

    when 'payments.allocation_order' then
      -- A-05: any order of the three components, each exactly once.
      if jsonb_typeof(p_value) <> 'array'
         or jsonb_array_length(p_value) <> 3
         or not (p_value @> '["penalty", "interest", "principal"]'::jsonb) then
        perform setting_error(p_key, 'must list penalty, interest and principal once each');
      end if;

    when 'approvals.loan_manager_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint <= 0 then
        perform setting_error(p_key, 'must be a positive whole number of cents');
      end if;

    when 'approvals.expense_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint < 0 then
        perform setting_error(p_key, 'must be zero or a positive whole number of cents');
      end if;

    when 'loans.collateral_required', 'collateral.multi_loan', 'extension.enabled',
         'field.require_remittance', 'daycloses.enforce', 'disbursement.check_funds' then
      if jsonb_typeof(p_value) <> 'boolean' then
        perform setting_error(p_key, 'must be true or false');
      end if;

    when 'migration.go_live_date' then
      -- A-19: null until MSI sets the go-live date.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform setting_error(p_key, 'must be null or a date YYYY-MM-DD');
      end if;
      begin
        perform (p_value #>> '{}')::date;
      exception when others then
        perform setting_error(p_key, 'is not a real date');
      end;

    when 'company' then
      -- SPEC 11 Branding. Pending fields hold "[pending]" and print blank.
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field not in ('name', 'short_name', 'address', 'phone', 'email', 'logo_path', 'receipt_footer') then
          perform setting_error(p_key, format('has an unknown field "%s"', v_field));
        end if;
      end loop;
      if not jsonb_is_short_text(p_value -> 'name', 120) or length(btrim(p_value ->> 'name')) = 0 then
        perform setting_error(p_key, 'needs a name of 1 to 120 characters');
      end if;
      if not jsonb_is_short_text(p_value -> 'short_name', 20) or length(btrim(p_value ->> 'short_name')) = 0 then
        perform setting_error(p_key, 'needs a short name of 1 to 20 characters');
      end if;
      if not (jsonb_is_short_text(p_value -> 'address', 300)
              and jsonb_is_short_text(p_value -> 'phone', 60)
              and jsonb_is_short_text(p_value -> 'email', 200)
              and jsonb_is_short_text(p_value -> 'receipt_footer', 200)) then
        perform setting_error(p_key, 'address, phone, email and receipt_footer must be text (use "" or "[pending]" when unknown)');
      end if;
      if not (jsonb_typeof(p_value -> 'logo_path') = 'null' or jsonb_is_short_text(p_value -> 'logo_path', 300)) then
        perform setting_error(p_key, 'logo_path must be a storage path or null');
      end if;

    when 'due.upcoming_days' then
      -- B-07: how far ahead the due list's "due soon" tab looks (SPEC 7.7 due_7d).
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 60 then
        perform setting_error(p_key, 'must be a whole number of days from 1 to 60');
      end if;

    when 'templates' then
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object of named texts');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field !~ '^[a-z_]+$' or not jsonb_is_short_text(p_value -> v_field, 10000) then
          perform setting_error(p_key, format('template "%s" must be text up to 10,000 characters', v_field));
        end if;
      end loop;

    when 'clock.override_at' then
      -- B-01: null (real time) or {"at": timestamptz, "frozen": bool}.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'object'
         or jsonb_typeof(p_value -> 'at') <> 'string'
         or (p_value ? 'frozen' and jsonb_typeof(p_value -> 'frozen') <> 'boolean')
         or exists (select 1 from jsonb_object_keys(p_value) k where k not in ('at', 'frozen', 'set_at')) then
        perform setting_error(p_key, 'must be null or {"at": "<timestamp>", "frozen": true|false}');
      end if;
      begin
        perform (p_value ->> 'at')::timestamptz;
      exception when others then
        perform setting_error(p_key, '"at" is not a valid timestamp');
      end;

    else
      perform setting_error(p_key, 'is not a known setting');
  end case;
end
$$;

create or replace function public.due_list_rows()
returns table (
  loan_id uuid,
  bucket text,
  days int,
  due_date date,
  total_out bigint,
  penalty_out bigint,
  next_penalty_on date,
  last_penalty boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select business_today() as today,
           coalesce((select (value #>> '{}')::int from settings where key = 'due.upcoming_days'), 7) as ahead
  )
  select ln.id,
         case when ln.due_date = p.today then 'due_today'
              when ln.due_date > p.today then 'due_7d'
              when p.today - ln.due_date <= 7 then 'overdue_1_7'
              when p.today - ln.due_date <= 30 then 'overdue_8_30'
              else 'overdue_30_plus' end,
         p.today - ln.due_date,                    -- negative: days until due
         ln.due_date, b.total_out, b.penalty_out, b.next_penalty_on,
         b.next_penalty_on is not null
           and (b.next_penalty_on - ln.due_date) / ln.penalty_period_days = ln.penalty_max_periods
    from loans ln
    join loan_balance_rows() b on b.loan_id = ln.id
    cross join params p
   where ln.status in ('active', 'overdue') and ln.due_date is not null and b.total_out > 0
     and ln.due_date <= p.today + p.ahead
     and is_staff()
$$;

revoke execute on function public.due_list_rows() from public, anon, service_role;
grant execute on function public.due_list_rows() to authenticated;

create view public.due_list with (security_invoker = true) as
  select * from public.due_list_rows();

revoke all on public.due_list from anon, service_role;
grant select on public.due_list to authenticated;

-- SPEC 10.3: each tap on a WhatsApp reminder link is logged (no delivery guarantee).
create or replace function public.log_reminder_opened(p_loan_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if p_kind not in ('reminder', 'reminder_overdue') then
    raise exception 'INVALID_STATE: unknown reminder' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_loan_id;
  if not found or v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: reminders are for open loans' using errcode = '22023';
  end if;
  perform write_audit('loan.reminder_opened', 'loan', v_loan.id::text, null,
                      jsonb_build_object('loan_no', v_loan.loan_no, 'template', p_kind, 'channel', 'whatsapp'));
end
$$;

revoke execute on function public.log_reminder_opened(uuid, text) from public, anon, service_role;
grant execute on function public.log_reminder_opened(uuid, text) to authenticated;
