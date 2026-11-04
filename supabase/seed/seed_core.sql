-- seed_core.sql: runs in every environment (SPEC 14). Idempotent: re-running changes nothing.
-- M0 part: branches, company header and rule settings (SPEC 2.3, 11 Branding).
-- The chart of accounts, loan product and document templates for legal texts join in later milestones.

-- Branch names and addresses are placeholders until MSI supplies them (QUESTIONS client item 9).
insert into public.branches (code, name)
values ('BR1', 'Main'), ('BR2', 'Branch 2'), ('BR3', 'Branch 3')
on conflict (code) do nothing;

insert into public.settings (key, value)
values
  -- SPEC 11 Branding. "[pending]" fields print blank until MSI supplies them.
  ('company', jsonb_build_object(
      'name', 'Method Solutions Inc.',
      'short_name', 'MSI',
      'address', '[pending]',
      'phone', '[pending]',
      'email', '[pending]',
      'logo_path', 'branding/msi-logo.png',
      'receipt_footer', 'Thank you for your payment.')),
  -- SPEC 2.3 assumption register (defaults until MSI signs off; see docs/ASSUMPTIONS.md).
  ('currency.base', '"USD"'),                          -- A-01
  ('payments.allocation_order', '["penalty", "interest", "principal"]'), -- A-05
  ('approvals.loan_manager_limit_cents', '200000'),    -- A-07: $2,000.00
  ('loans.collateral_required', 'true'),               -- A-10
  ('collateral.multi_loan', 'false'),                  -- A-10
  ('extension.enabled', 'true'),                       -- A-09
  ('field.require_remittance', 'true'),                -- A-12
  ('accounting.basis', '"accrual"'),                   -- A-15
  ('daycloses.enforce', 'true'),                       -- A-18
  ('migration.go_live_date', 'null'),                  -- A-19: set by admin before go-live
  ('approvals.expense_limit_cents', '10000'),          -- A-20: $100.00
  ('disbursement.check_funds', 'true'),                -- SPEC 5.4.8
  -- SPEC 10.3 WhatsApp reminder texts (editable by admin).
  ('templates', jsonb_build_object(
      'reminder', 'Dear {name}, your loan {loan_no} of {amount} is due on {due_date}. Outstanding: {outstanding}. Please pay at {branch} or call {branch_phone}. Thank you. – {company}',
      'reminder_overdue', 'Dear {name}, your loan {loan_no} was due on {due_date} and is {days_overdue} days overdue. Outstanding: {outstanding}, including penalties of {penalties}. Please pay at {branch} or call {branch_phone}. Thank you. – {company}')),
  -- B-01 business clock: real time unless a demo or test environment moves it.
  ('clock.override_at', 'null')
on conflict (key) do nothing;
