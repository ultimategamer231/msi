-- M1.4: maker-checker requests (SPEC 7.5 approval_requests, D-05) and the manual journal request
-- (SPEC 4 "Manual journal (request)": accountant, admin; R11; FR-21). The decision dispatcher
-- (decide_approval) arrives in M2; until then requests stay pending.

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('customer_edit', 'loan_approval', 'loan_extension', 'payment_void',
                                     'journal_reversal', 'write_off', 'expense', 'manual_journal', 'day_close',
                                     'customer_blacklist')),
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null,
  required_role public.app_role not null check (required_role in ('manager', 'ceo')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text,
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default public.app_now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  constraint approval_decision_complete check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null))
);

comment on table public.approval_requests is 'All maker-checker requests in one inbox (D-05, FR-28).';

create index approval_requests_pending_idx on public.approval_requests (status, required_role, requested_at);
create index approval_requests_requester_idx on public.approval_requests (requested_by, requested_at desc);

alter table public.approval_requests enable row level security;

-- Managers and the CEO see every request (they decide them); everyone sees the requests they made.
create policy approval_requests_read on public.approval_requests
  for select to authenticated
  using ((select public.auth_role()) in ('manager', 'ceo') or requested_by = (select auth.uid()));

revoke all on public.approval_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.approval_requests from authenticated, service_role;

-- Accountant or admin asks for a manual journal (R11). Input:
-- {"entry_date": "YYYY-MM-DD", "memo": "...", "branch_id": uuid|null,
--  "lines": [{"account": "5010", "debit_cents": 50000}, {"account": "1010-BR2", "credit_cents": 50000}]}
-- The journal is checked by running post_journal in a sub-transaction that is always rolled back,
-- so the request meets exactly the rules it will be posted under, and nothing is written by the check.
create or replace function public.request_manual_journal(p_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_memo text := btrim(coalesce(p_request ->> 'memo', ''));
  v_branch uuid := nullif(p_request ->> 'branch_id', '')::uuid;
  v_go_live date;
  v_id uuid;
  v_payload jsonb;
begin
  perform require_role('accountant', 'admin');

  begin
    v_date := (p_request ->> 'entry_date')::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null then
    raise exception 'INVALID_STATE: the journal needs a valid date' using errcode = '22023';
  end if;
  if v_memo = '' or length(v_memo) > 500 then
    raise exception 'INVALID_STATE: a manual journal needs a memo (up to 500 characters)' using errcode = '22023';
  end if;
  if v_branch is not null and not exists (select 1 from branches where id = v_branch) then
    raise exception 'INVALID_STATE: the branch does not exist' using errcode = 'P0002';
  end if;

  -- A-19: after go-live every posting is dated today.
  select (value #>> '{}')::date into v_go_live from settings where key = 'migration.go_live_date';
  if v_go_live is not null and business_today() >= v_go_live and v_date <> business_today() then
    raise exception 'DATE_NOT_ALLOWED: after go-live a manual journal is dated today' using errcode = '42501';
  end if;
  if v_date > business_today() then
    raise exception 'DATE_NOT_ALLOWED: a journal cannot be dated in the future' using errcode = '42501';
  end if;

  -- Dry run: the real posting rules, rolled back.
  begin
    perform post_journal(v_date, v_memo, 'manual_journal', null, v_branch, p_request -> 'lines');
    raise exception 'DRY_RUN_OK';
  exception when others then
    if sqlerrm <> 'DRY_RUN_OK' then
      raise;
    end if;
  end;

  v_payload := jsonb_build_object('entry_date', v_date, 'memo', v_memo, 'branch_id', v_branch,
                                  'lines', p_request -> 'lines');
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('manual_journal', 'journal', null, v_payload, 'manager', v_memo, auth.uid())
  returning id into v_id;

  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'manual_journal', 'required_role', 'manager', 'payload', v_payload));
  return v_id;
end
$$;

revoke execute on function public.request_manual_journal(jsonb) from public, anon, service_role;
grant execute on function public.request_manual_journal(jsonb) to authenticated;
