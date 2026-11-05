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
      'reminder_overdue', 'Dear {name}, your loan {loan_no} was due on {due_date} and is {days_overdue} days overdue. Outstanding: {outstanding}, including penalties of {penalties}. Please pay at {branch} or call {branch_phone}. Thank you. – {company}',
      -- SPEC 10.1: placeholder legal wording, visibly marked, for MSI's lawyer to replace.
      'loan_agreement', '[PLACEHOLDER: to be reviewed by MSI''s lawyer before use] The borrower agrees to repay the total amount shown by the due date. Interest is charged once, at payout. If any amount is still unpaid after the due date, a penalty of {penalty_rate} of the amount then owed is added every {penalty_days} days, up to {penalty_max} times. The collateral listed below is held by {company} until the loan is repaid in full and may be sold under the recovery policy if the loan is not repaid. Payments are applied first to penalties, then to interest, then to the amount lent.')),
  -- B-01 business clock: real time unless a demo or test environment moves it.
  ('clock.override_at', 'null')
on conflict (key) do nothing;

-- M1: chart of accounts (SPEC 6.1). Branch cash accounts 1010-<BR> are created by the
-- branches_cash_account trigger for every branch. Retained earnings is computed, not an account.
insert into public.accounts (code, name, type)
values
  ('1015', 'Field Cash (unremitted)', 'asset'),
  ('1020', 'Bank', 'asset'),
  ('1030', 'Mobile Money', 'asset'),
  ('1100', 'Loans Receivable – Principal', 'asset'),
  ('1110', 'Interest Receivable', 'asset'),
  ('1120', 'Penalties Receivable', 'asset'),
  ('2000', 'Accounts Payable', 'liability'),
  ('2100', 'Customer Surplus Payable', 'liability'),
  ('3000', 'Owner''s Capital', 'equity'),
  ('3900', 'Opening Balance Equity', 'equity'),
  ('4000', 'Interest Income', 'income'),
  ('4010', 'Penalty Income', 'income'),
  ('4100', 'Recoveries of Written-off Loans', 'income'),
  ('4900', 'Other Income', 'income'),
  ('5000', 'Salaries and Wages', 'expense'),
  ('5010', 'Rent', 'expense'),
  ('5020', 'Utilities and Internet', 'expense'),
  ('5030', 'Transport and Fuel', 'expense'),
  ('5040', 'Legal and Recovery Costs', 'expense'),
  ('5050', 'Bad Debts Expense', 'expense'),
  ('5060', 'Bank and Mobile Money Charges', 'expense'),
  ('5900', 'Other Expenses', 'expense')
on conflict (code) do nothing;

-- M3: the standard product from DEMO_DATA (A-02, A-03, A-06, A-08): 20% flat per month, 1 month,
-- penalty 20% of the amount owed every 7 days after the due date, at most 4, recovery after 30 days.
-- The maximum term (3 months) is a placeholder until MSI confirms it.
insert into public.loan_products (name, interest_rate_bps, default_term_months, max_term_months, penalty_rate_bps,
                                  penalty_period_days, penalty_base, penalty_max_periods, recovery_after_days)
values ('Standard 1-month', 2000, 1, 3, 2000, 7, 'outstanding_total', 4, 30)
on conflict (name) do nothing;
