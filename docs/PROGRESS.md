# Progress

| Item | Value |
| --- | --- |
| Current phase | M5 Accruals and due lists (approved by Foday 2026-11-07); M0–M4 in review on PR #1 |
| Current block | M5.3 Due list, WhatsApp reminders and the manual run |
| Last approved block | M5 phase start (Foday 2026-11-07, "I approve M5"; open questions answered later, recommended defaults apply) |
| State | Working on M5 |
| Next step | M5.4 Loan extension |

## M5 plan (Accruals and due lists: FR-12, FR-13, FR-18; T-03 to T-09, T-13, T-33, T-33b)

| Block | Content | Done when |
| --- | --- | --- |
| M5.1 | `loan_penalty_events`, `accrual_runs`, `loan_outstanding_as_of` (B-15 rule), `run_daily_accruals` (overdue marking, penalties R4 by the late-run rule, recovery eligibility, run log; manager/admin), balances gain last payment and next penalty dates | T-03, T-04, T-05, T-06 (penalty part), T-07, T-08, T-33, T-33b match `tools/vectors.py` |
| M5.2 | `pg_cron` schedule (01:00 UTC) calling the job without a user; penalty lines and the next penalty on the loan page | cron job registered; e2e |
| M5.3 | `due_list` view (B-07 setting `due.upcoming_days`, B-18 buckets), `/due` (mock-up 11) with WhatsApp reminders (SPEC 10.3, `reminder_opened` audit), Remind on `/field`, manual "Run daily job" with the last runs | e2e at 390 and 1280 |
| M5.4 | `request_extension` and its decision (R5; FR-18, A-09), Extend on the loan page, inbox card (B-16 wording) | T-13 |
| M5.5 | Demo seed: daily job for each past day (DEMO_DATA penalties, overdue and recovery flags), demo payment check (RCT-BR2-000123, $1,440.00 → $940.00), screenshots, M5 report | all checks green |

Open questions use the recommended defaults (Foday 2026-11-07, "I approve M5"): B-07 window 7 days as a setting, B-15 base rule plus T-33b, B-16 "The borrower would owe…", B-18 buckets 1–7, 8–30, 31+.

## M4 plan (Payments: FR-10, FR-11, FR-20; T-06 allocation, T-10, T-11, T-12, T-25, T-28, T-36, T-37)

| Block | Content | Done when |
| --- | --- | --- |
| M4.1 | `payments`, `payment_allocations`, `receive_payment` (R2): allocation order (A-05), overpayment, references, idempotency, entry dates, loan closes at zero; `post_journal` gains a reversal link | T-06 allocation, T-10, T-11, T-12, T-37 |
| M4.2 | `record_field_payment` (R3; B-09 default: cash to 1015, mobile money and bank direct), `confirm_remittance` (R3b) | T-28, T-36 |
| M4.3 | `request_void_payment` and its decision (R8), `request_journal_reversal` (B-12 default) | T-25 |
| M4.4 | `/payments/new?loan=` (mock-up 03) with allocation preview, `/payments` list, "Receive payment" on the loan page | e2e |
| M4.5 | `/receipts/[id]` (mock-up 04) with A5 and 80 mm print CSS, receipt PDF | e2e, screenshots |
| M4.6 | `/field` and `/field/collect/[loanId]` (mock-ups 01, 02), `/remittance` | e2e |
| M4.7 | Demo seed repayments (closed loans close), clean-up, handover notes and a prompt for the next session, M4 report | all checks green |

Open questions are answered later (Foday 2026-11-07): B-08 (a), B-09 (a), B-10 (a) and B-12 (yes) use the recommended defaults; B-19 (WhatsApp share on receipts) is not built until approved.

## M3 plan (Loans: FR-06, FR-07, FR-08, FR-09; T-01, T-02, T-17, T-18, T-19, T-23, T-35)

| Block | Content | Done when |
| --- | --- | --- |
| M3.1 | `loan_products` (SPEC 7.1), `upsert_loan_product` (admin, audited), seeded standard product, products tab in `/settings` | pgTAP and e2e |
| M3.2 | Money helpers (`round_half_up`, `pct`, `add_months_clamped`), `loans` (SPEC 7.3) with snapshot terms, `loan_balances` and `customer_balances` views, `preview_loan_terms` | T-01, T-02, T-09 match `tools/vectors.py` |
| M3.3 | `create_loan_draft`, `update_loan_draft`, `submit_loan` (routes by `approvals.loan_manager_limit_cents`), loan decisions in `decide_approval` (creator ≠ approver), cancel | T-17, T-18, T-19 |
| M3.4 | Minimal collateral (`collaterals`, `loan_collaterals`, `register_collateral`, `link_collateral`), `disburse_loan` (R1) with collateral, funds and day-lock checks | T-23, T-35 |
| M3.5 | `/loans/new` wizard: customer, product, amount and term with live preview, collateral, guarantors, submit | e2e at 390 and 1280 |
| M3.6 | `/loans` (mock-up 06) and `/loans/[id]` (mock-up 07); loans and total owed on the customer profile | compare screenshots |
| M3.7 | `issued_documents`, `issue_document`, loan agreement PDF; demo seed (opening capital, DEMO_DATA loans that M3 can create); M3 phase report | all checks green |

## M2 plan (Customers: FR-03, FR-04, FR-05, FR-28; T-29, T-32)

| Block | Content | Done when |
| --- | --- | --- |
| M2.1 | `customers` (SPEC 7.2), `attachments` (append-only), private `documents` bucket with own-folder uploads, `create_customer` with duplicate guard (phone, second phone, ID number; manager override with reason), `add_customer_documents` | T-32 and RLS tests pass |
| M2.2 | `/customers` list (search by name, phone, ID, code; status, branch and officer filters; 25 per page) and `/customers/new` (individual and business, photo and document upload, duplicate warning listing the existing record) | e2e at 390 and 1280 px with axe |
| M2.3 | `request_customer_edit` (edits and blacklisting), `decide_approval` dispatcher (customer edits, blacklist, manual journals), R10 capital-in request (R-14) | T-29 passes; approved manual journal posts |
| M2.4 | Customer profile (mock-up 08) with pending-change notice and documents; approvals inbox (mock-up 12) with Waiting, Approved, Rejected, Mine; top-bar approvals count | "inbox shows pending edit and applies it" |
| M2.5 | `guarantors` table (loan link added with loans in M3), guarantor form section for the loan wizard; demo seed customers and the pending phone edit; M2 phase report | all checks green |

Loans, collateral and total owed on the profile arrive with M3 and M6; the panels are not shown before their data exists.

## Session start checklist (cloud container)

1. Read `CLAUDE.md`, this file (state and next step), the latest report in `docs/reports/`, and the SPEC sections for the current block. Decisions so far are in `docs/DECISIONS.md`; open questions in `docs/QUESTIONS.md` and `docs/reports/OPEN-QUESTIONS-2026-11-05.md`.
2. Start Docker if it is not running: `dockerd > /tmp/dockerd.log 2>&1 &`, then wait until `docker info` works. If Supabase containers come back unhealthy after a restart: `pnpm supabase stop --no-backup` then `pnpm db:start`.
3. `pnpm install`, `pnpm db:start` (applies migrations and seeds), `pnpm env:local` (writes `.env.local`), `pnpm types` after any migration change.
4. Checks before every commit (CI runs the same and fails on warnings): `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm supabase db lint --level warning`, `pnpm supabase db advisors --type all --level warn`. For e2e: `pnpm build`, free port 3000 (`fuser -k 3000/tcp`), then `CI=1 pnpm test:e2e`.
5. Apply a new migration locally with `pnpm supabase migration up`. If local e2e runs start failing on lists (old test data piling up, for example the approvals inbox), reset with `pnpm supabase db reset`; CI always starts fresh.
6. Demo data: `pnpm seed:demo --as-of 2026-02-12` on a fresh database. It prints the demo passwords once; never commit them.
7. Work is safe only once pushed; the container is temporary. Commit per block, push, keep PR #1 up to date, never push to `main`.

## Log

| Date | Phase / block | Event |
| --- | --- | --- |
| 2026-11-03 | Phase 0 | Kit extracted and verified; mock-up zip identical; vectors match SPEC 12; toolchain checked; SKILL_MAP, QUESTIONS (B-01..B-21), Phase 0 report written |
| 2026-11-04 | Phase 0 | Plan approved; R-01..R-11 and B-01, B-02, B-03, B-11 answered (see `docs/reports/PHASE-0.md` section 9) |
| 2026-11-04 | M0.1 | Next.js 16 scaffold, MSI tokens, next-intl, format module, Vitest, Playwright + axe, screenshot tool, CI, security scans, Dependabot |
| 2026-11-04 | M0.2 | Local Supabase, 5 migrations (roles, environment, business clock, branches, profiles, settings, hash-chained audit log, document sequences, RLS and grants), admin RPCs, seed_core, 70 pgTAP tests, CI database job |
| 2026-11-04 | M0.3 | Sign-in, sign-out, proxy session refresh and 12-hour limit, route map and page guard, public_branding, e2e global setup with role fixtures, 32 e2e checks |
| 2026-11-04 | M0.4 | App shell: sidebar, top bar, phone header and bottom tabs with More sheet, role-aware navigation, logo via signed URL, skeleton/error states, skip link; 39 e2e checks |
| 2026-11-04 | M0.5 | /settings for the admin: company header, logo upload, reminder texts, branches, rule settings, demo clock, users (create, edit, deactivate, reset password); null-setting fix; 75 e2e checks |
| 2026-11-04 | M0.6 | /audit screen, seed:demo (M0 part), phase checks, security review (no findings), M0 phase report |
| 2026-11-04 | M1.1 | accounts (SPEC 6.1) with branch cash accounts, journals and journal_lines with balance, one-sided, immutable, same-transaction and hash-chain invariants; T-20, T-21; global function grant fix |
| 2026-11-04 | M1.2 | period_locks, next_number (B-02 global loans, B-03 6-digit EXP), set_sequence_start, post_journal with all SPEC 6.3 checks; T-22; 132 database tests |
| 2026-11-04 | M1.3 | /ledger (journals with lines, filters, pagination; trial balance with balanced check), trial_balance() function, ScrollRegion a11y fix; 139 DB tests, 97 e2e checks |
| 2026-11-04 | M1.4 | approval_requests, request_manual_journal (dry-run validation), manual journal tab on /ledger, resolver nesting fix, data-independent DB tests; M1 phase report |
| 2026-11-04 | M1 follow-up | Foday answered B-22 (approved) and asked for recommended defaults elsewhere: public logo on sign-in, db advisors in CI, FK indexes; B-23, R-14, PR #1 decisions recorded |
| 2026-11-04 | M2.1 | customers, attachments, documents bucket, create_customer with duplicate guard (T-32), add_customer_documents; 186 database tests |
| 2026-11-04 | M2.2 | /customers list (search, filters, phone cards, table), /customers/new (individual or business, photo and documents with type check and shrinking, duplicate warning with manager override); 10 new e2e checks |
| 2026-11-04 | M2.3 | request_customer_edit (fields, photo, status), apply_customer_edit, decide_approval (customer edits, blacklist, manual journal, capital in), request_capital_in with ledger form; T-29; 225 database tests |
| 2026-11-04 | M2.4 | /customers/[id] (mock-up 08: details, pending notice, documents, request edit, status change), /approvals (mock-up 12: Waiting, Approved, Rejected, Mine; approve, reject with reason and confirmation), approvals count in the shell; 10 new e2e checks |
| 2026-11-04 | M2.5 | guarantors table and clean_guarantors, guarantor form section, demo seed customers and pending phone change, M2 phase report |
| 2026-11-04 | M3 | Phase approved by Foday ("Start M3"); B-24, B-25 and the M2 mock-up differences not answered, defaults stay |
| 2026-11-04 | M3.1 | loan_products, upsert_loan_product (admin, audited), seeded standard product, Loan products tab in /settings with percent input; 246 database tests |
| 2026-11-04 | M3.2 | round_half_up, pct, flat_interest, add_months_clamped (T-01, T-02, T-09), loans table with snapshot columns, loan_balances and customer_balances, preview_loan_terms; 265 database tests |
| 2026-11-04 | M3.3 | create_loan_draft, update_loan_draft, submit_loan (routing by limit), cancel_loan, loan decisions in decide_approval, loan cards in the inbox; T-17, T-18, T-19; 292 database tests |
| 2026-11-04 | M3.4 | collaterals, loan_collaterals, collateral_events (append-only), register_collateral, link_collateral, disburse_loan (R1) with collateral, funds, date and lock checks; T-23, T-35; 315 database tests |
| 2026-11-04 | M3.5 | /loans/new wizard (customer search, product, amount and term with live preview, collateral pick or add, guarantors with ID scan, send or save draft); 4 e2e checks |
| 2026-11-04 | M3.6 | /loans (tabs, search, filters, open total), /loans/[id] (cards, outstanding, details, activity, collateral, guarantors; submit, decide, pay out, cancel), loans and total owed on the customer profile; ledger trigger rights fix; 317 database tests, 140 e2e |
| 2026-11-05 | M3.7 | issued_documents, issue_document, loan agreement PDF with QR, demo seed loans/collateral/capital, M3 phase report; 325 database tests, 142 e2e |
| 2026-11-07 | M4 | Phase approved ("Start M4"); questions answered later, recommended defaults apply; clean-up and handover prompt at the end of M4 |
| 2026-11-07 | M4.1 | payments, payment_allocations, receive_payment (R2), post_journal reversal link; T-06 allocation, T-10, T-11, T-12, T-37; 349 database tests |
| 2026-11-07 | M4.2 | record_field_payment (R3, B-09 default), confirm_remittance (R3b); T-28, T-36; 365 database tests |
| 2026-11-07 | M4.3 | request_void_payment and its decision (R8), request_journal_reversal (B-12 default), inbox cards; T-25; 384 database tests |
| 2026-11-07 | M4.4 | /payments/new (mock-up 03) with preview_payment, /payments list with void request, Receive payment on the loan page; 386 database tests, 148 e2e |
| 2026-11-07 | M4.5 | /receipts/[id] (mock-up 04) with A5 and 80 mm print, receipt PDF, VOID stamp; issue_document receipts, receipt_balance_after; 395 database tests |
| 2026-11-07 | M4.6 | /field (mock-up 01), /field/collect (mock-up 02), /remittance with counted total; Today and Field cash in the menu |
| 2026-11-07 | M4.7 | Demo repayments (RCT-BR2-000116..000122), shared payment form moved, handover checklist, M4 report and screenshots; 395 database tests, 152 e2e |
| 2026-11-07 | M5 | Phase approved ("I approve M5"); plan written; GitHub access from the session lost (403), blocks committed locally until it is restored |
| 2026-11-07 | M5.1 | Accrual job, penalty events, run log, late-run rule; T-03..T-08, T-33, T-33b; 430 database tests (committed locally, push blocked) |
| 2026-11-07 | M5.2 | pg_cron schedule, next penalty and penalty rows on the loan page; 435 database tests (committed locally, push blocked) |
| 2026-11-07 | M5.3 | due_list, /due (mock-up 11), WhatsApp reminders with audit, Remind on /field, manual run panel, due.upcoming_days setting; 444 database tests, 158 e2e (committed locally, push blocked) |
