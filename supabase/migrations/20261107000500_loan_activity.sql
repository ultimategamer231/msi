-- M3.6: activity of one loan for /loans/[id] (SPEC 9 "schedule of events": paid out, payments,
-- penalties, extension). Built from the loan's receivable lines in the ledger, summed per journal
-- and component; staff see amounts and who posted them, never accounts or other journal lines
-- (journal_lines stays finance-only, T-31).
create or replace function public.loan_activity(p_loan_id uuid)
returns table (
  journal_id uuid,
  journal_no text,
  entry_date date,
  posted_at timestamptz,
  source_type text,
  component text,
  amount_cents bigint,
  posted_by uuid,
  reversal_of uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, j.journal_no, j.entry_date, j.posted_at, j.source_type, l.component,
         sum(l.debit_cents - l.credit_cents)::bigint, j.posted_by, j.reversal_of
    from journal_lines l
    join journals j on j.id = l.journal_id
   where l.loan_id = p_loan_id and l.component is not null and is_staff()
   group by j.id, j.journal_no, j.entry_date, j.posted_at, j.source_type, l.component, j.posted_by, j.reversal_of
   order by j.entry_date, j.posted_at, j.journal_no,
            case l.component when 'principal' then 1 when 'interest' then 2 else 3 end
$$;

revoke execute on function public.loan_activity(uuid) from public, anon, service_role;
grant execute on function public.loan_activity(uuid) to authenticated;
