-- M1.3: trial balance (SPEC 10.2 "Trial balance": every account's debit and credit totals; must
-- balance). Security invoker, so RLS on journal_lines applies: finance roles see the totals, other
-- roles see nothing. The full report pack (filters, CSV, print) arrives in M8.
create or replace function public.trial_balance(p_as_of date)
returns table (
  account_id uuid,
  code text,
  name text,
  type public.account_type,
  debit_cents bigint,
  credit_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, a.code, a.name, a.type,
         coalesce(sum(l.debit_cents), 0)::bigint,
         coalesce(sum(l.credit_cents), 0)::bigint
    from accounts a
    join journal_lines l on l.account_id = a.id
    join journals j on j.id = l.journal_id
   where j.entry_date <= p_as_of
   group by a.id, a.code, a.name, a.type
   order by a.code;
$$;

revoke execute on function public.trial_balance(date) from public, anon, service_role;
grant execute on function public.trial_balance(date) to authenticated;
