-- M3.6 fix: the deferred ledger checks (balanced at commit, journal has lines) run at commit time
-- as the session's role, not as the definer of the RPC that posted the journal. For staff without
-- read access to journal_lines (cashier, loan officer: T-31) RLS hid the new lines, so a valid
-- disbursement was refused with "journal has no lines". The checks must always see the whole
-- journal, so they run with the owner's rights. They only read; nothing else changes.
alter function public.trg_journal_balanced() security definer;
alter function public.trg_journal_has_lines() security definer;
alter function public.trg_journal_line_same_txn() security definer;

revoke execute on function public.trg_journal_balanced(), public.trg_journal_has_lines(),
  public.trg_journal_line_same_txn() from public, anon, authenticated, service_role;
