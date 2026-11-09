# Changelog

All notable changes, one section per phase. Format follows Keep a Changelog.

## [M7 Statements and documents] 2026-11-09 (in review, PR #1)
### Added
- M7.1: Statements with running balance from the ledger, demand notices with a deadline, collateral receipt and release letter numbering, public document check.
- M7.2: PDFs: statement of account (loan or customer, optional period), demand notice, collateral receipt with photos, release letter; each with a verification QR code.
- M7.3: Public `/verify` page; document links on the loan, customer, collateral and recovery pages.
- M7.4: Statement check over the demo data, screenshots, M7 report.

## [M6 Collateral and recovery] 2026-11-08 (in review, PR #1; push pending)
### Added
- M6.1: Collateral register rules: duplicate identifiers flagged, photos and documents, custody log entries, return to the owner once loans have ended; recovery case numbers RC-000001 (T-24).
- M6.2: Collateral register, item page and registration screens.
- M6.3: Recovery cases with stages, court steps, collateral sale with allocation and surplus, surplus payout (T-14, T-15).
- M6.4: Write-off through CEO approval with the board reference; later recoveries (T-16).
- M6.5: Recovery screens, recovery and write-off actions on the loan page, write-off card in the inbox.
- M6.6: Demo custody log, releases and recovery case RC-000001 from DEMO_DATA.

## [M5 Accruals and due lists] 2026-11-07 (in review, PR #1; push pending)
### Added
- M5.1: Daily job: overdue marking, weekly penalties with the same amounts whether it runs daily or late, recovery eligibility, run log (T-03 to T-08, T-33, T-33b).
- M5.2: The job runs every night in the database; the loan page shows penalties, the weekly count and the next penalty.
- M5.3: Due and overdue list with WhatsApp reminders (logged), reminders on the field list, a manual run for managers, and the due-soon window as a setting.
- M5.4: Loan extension through approval, with the cost shown on the request (T-13).
- M5.5: Demo penalties and the pending extension from DEMO_DATA; demo payment check (`pnpm test:demo`).

## [M4 Payments] 2026-11-07 (in review, PR #1)
### Added
- M4.1: Office payments with a fixed allocation order (penalty, interest, then amount lent), overpayment refused, references for mobile money and bank, safe retries, date rules; loans close when nothing is owed.
- M4.2: Field payments by loan officers; field cash waits until the cashier confirms the handover with a counted total.
- M4.3: Payment voids and journal reversals through approval, never by the requester; voided receipts print VOID.
- M4.4: Receive payment screen with a live allocation preview; payments list with filters and void requests; Receive payment and "Paid so far" on the loan page.
- M4.5: Receipt screen, A5 and 80 mm printing, receipt PDF with verification QR code.
- M4.6: Field screens (today's list, collect) and the Field cash screen for cashiers and managers.
- M4.7: Demo repayments from DEMO_DATA (receipts RCT-BR2-000116 to 000122; five loans closed).
### Fixed
- M4.4: Contrast of help text and inline links on the payment screens.

## [M3 Loans] 2026-11-05 (in review, PR #1)
### Added
- M3.1: Loan products as configuration with an admin tab in Settings; the standard 1-month product is seeded.
- M3.2: Interest, rounding and due-date rules in the database (T-01, T-02, T-09); loans with the product's rules copied at submission; balances from the ledger; loan preview.
- M3.3: Loan applications: draft, send for approval, approval by a manager up to the limit and by the CEO above it, never by the creator (T-17, T-18, T-19); cancel.
- M3.4: Collateral register and pledge (minimal); payout by the cashier with collateral, funds, date and closed-day checks (T-23, T-35).
- M3.5: New loan wizard with live preview, collateral and guarantors.
- M3.6: Loans list, loan page with activity, collateral and guarantors; loans and total owed on the customer profile.
- M3.7: Loan agreement PDF with verification QR code; demo loans, collateral and opening capital.
### Fixed
- M3.6: A cashier's payout was refused at commit because the ledger checks could not see the new lines.

## [M2 Customers] 2026-11-04 (in review, PR #1)
### Added
- M2.1: Customer register (individual and business) with KYC fields, a duplicate check on phone, second phone and ID number (manager override with a reason), document attachments that are never deleted, and a private documents store.
- M2.2: Customer list with search (name, phone, ID, code) and filters; new-customer form with photo, ID scan and proof of address; large photos are made smaller before upload; the server checks each file's real type.
- M2.3: Customer changes and blacklisting go through approval; one approval step for all requests (customer changes, manual journals, owner capital); owner capital entry (R10) on the ledger.
- M2.4: Customer profile (mock-up 08) with pending-change notice, documents and request edit; approvals inbox (mock-up 12) with Waiting, Approved, Rejected and Mine; approvals count in the header and menu.
- M2.5: Guarantor model and form section for loans; demo customers (Mariama Kollie CU-000008 with her pending phone change).
### Fixed
- M2.5: A numbering test no longer depends on an empty database.

## [M1 Ledger core] 2026-11-04 (in review, PR #1)
### Added
- M1.1: Chart of accounts (SPEC 6.1) with a cash account per branch created automatically; `journals` and `journal_lines` with the SPEC 6.3 invariants (balanced at commit, one-sided lines, immutable), lines only in the creating transaction, and journals joined to the hash chain (`verify_journal_chain`). Tests T-20, T-21.
- M1.2: `post_journal` (the only journal writer: balance, whole cents, active accounts, one currency, loan receivable tagging, period locks, audit), `next_number` with a global loan counter (B-02) and 6-digit expense numbers (B-03), `set_sequence_start` for continuing paper numbering before go-live, `period_locks`. Test T-22.
- M1.3: `/ledger` for accountant, manager, CEO and admin: journals with expandable lines, date and branch filters, pagination; trial balance as at a date with a balanced check; `trial_balance()` SQL function.
- M1.4: `approval_requests` (maker-checker inbox table) and the manual journal request: form on `/ledger` for accountant and admin with live totals, validated under the real posting rules, waiting for a manager's decision (decisions arrive with M2).
- Follow-up: the company logo shows on the sign-in page (B-22, public `branding` bucket); CI checks the database with Supabase advisors (R-12); four foreign-key indexes.
### Fixed
- M1.4: Errors on individual journal lines are shown (form resolver now nests errors).
- M1.3: Wide tables on phones are now keyboard-scrollable (WCAG 2.1.1).
- M1.1: New functions no longer get EXECUTE for PUBLIC by default.

## [M0 Foundation] 2026-11-04 (in review, PR #1)
### Added
- M0.6: `/audit` read-only audit log for manager, CEO and admin with filters and before/after changes; `pnpm seed:demo [--as-of]` creating the DEMO_DATA staff accounts through audited RPCs.
- M0.1: Next.js 16 (App Router, TypeScript strict) project with pnpm, MSI design tokens (Tailwind 4, shadcn/ui variables), Inter with tabular figures, next-intl with `messages/en.json`, designed not-found and error pages.
- M0.1: `src/lib/format.ts` for money (integer cents via BigInt), rates (basis points), shares and dates (Africa/Monrovia), with 33 unit tests.
- M0.1: ESLint rules that forbid floats for money and `any`; Prettier; Vitest; Playwright at 390 and 1280 px with axe checks; `scripts/screenshots.ts` with mock-up comparison mode.
- M0.1: GitHub Actions CI (format, lint, typecheck, unit, build, audit; e2e on PRs), gitleaks and CodeQL scans, Dependabot.
- M0.1: Baseline security headers.
- M0.2: Local Supabase (Postgres 17) with sign-up disabled, 10-character passwords, 12-hour sessions, private `branding` bucket.
- M0.2: Migrations for roles, deployment environment, business clock (`app_now`, `business_today`), branches, profiles (managers may have no branch), settings with validation, hash-chained append-only `audit_log`, `document_sequences`, RLS on every table and explicit function grants.
- M0.2: Admin RPCs `update_setting`, `upsert_branch`, `admin_set_profile`, each audited with before and after; `verify_audit_chain` for integrity checks.
- M0.3: Sign-in page (company name from settings, no sign-up), sign-in and sign-out, session refresh in the Next.js proxy, 12-hour session limit, signed-out redirect with return path, route-role map from SPEC 9 with a page guard, inactive accounts refused.
- M0.5: `/settings` (admin only): company header, logo upload, WhatsApp reminder texts, branches (add, rename, deactivate), rule settings A-05/A-07/A-09/A-10/A-12/A-18/A-19/A-20 with money in dollars stored as cents, business clock for demo and test databases, users (create with one-time password, edit role and branch, deactivate, reset password). Every change is audited.
- M0.5: `admin_record_password_reset` RPC; admin logo upload storage policy; `update_setting` accepts SQL NULL as JSON null.
- M0.5: Friendly text for every error code; dollars-to-cents input parser; shared form fields.
- M0.4: App shell from the mock-ups: 232px sidebar with logo tile, role-aware navigation and user block; white top bar; purple phone header with context line; bottom tab bar with a "More" sheet; skeleton and in-shell error states; skip link; logo through a signed URL.
- M0.4: Restyled shadcn/ui Button and Sheet; Callout and Skeleton components.
- M0.3: E2E setup that creates one test account per role; e2e for every role's sign-in, wrong password, inactive user, return path, sign-out and not-found; CI e2e job runs against local Supabase.
- M0.2: `seed_core.sql` (branches, MSI company header, A-01..A-20 rule settings, reminder templates); 70 pgTAP tests; CI database job with PL/pgSQL lint and a generated-types check.

## [Phase 0] 2026-11-03
### Added
- Project kit extracted into the repository: `CLAUDE.md`, `docs/SPEC.md`, `docs/DEMO_DATA.md`, `docs/ASSUMPTIONS.md`, `docs/QUESTIONS.md`, `docs/mockups/`, `public/brand/`, `tools/vectors.py`.
- `docs/SKILL_MAP.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/reports/PHASE-0.md`.
- Builder questions B-01..B-21 in `docs/QUESTIONS.md`.
- `.gitignore`.
