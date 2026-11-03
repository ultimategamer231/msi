# Method Solutions Inc. Loan Management System (LoanDesk) MVP — Technical Specification

Status: v1.0 for build · Date: 2026-11-03 · Owner: Corex Digital Solutions
Client: **Method Solutions Inc. (MSI)**, Liberia. Codename **LoanDesk** is used only for the repo and package name. Every user-facing name, logo and header comes from `settings.company` (seeded with MSI values, section 11 "Branding (MSI)"); no code hard-codes the client name.
Audience: Claude Code (builder) and Foday (reviewer). This file is the single source of truth. If code and this file disagree, stop and ask.

---

## 0. How to use this spec (builder rules)

1. Build **one milestone at a time** (section 13). At the end of each milestone: run tests, run the app, show screenshots of the new screens, list what changed, then **stop and wait for approval** before starting the next milestone.
2. Money logic lives in **Postgres functions**, never in the browser and never duplicated in TypeScript (section 5.1, D-03).
3. Every rule value in section 2.3 is a **setting**, not a constant in code.
4. Anything marked `ASSUMPTION A-nn` is a placeholder pending client sign-off. Implement it as the default but keep it configurable and list it in `docs/ASSUMPTIONS.md` (generate this file from section 2.3).
5. Do not invent features outside the FR list (section 1.2). If something seems missing, add it to `docs/QUESTIONS.md` and continue.
6. No floats for money, anywhere. Integer cents (`bigint` in DB, `number` in TS) and integer basis points for rates.

---

## 1. Product scope

### 1.1 What this is
A web system for a **Liberian collateral-backed micro-lender** with 3 branches and 5 staff (cashier, manager, loan officer, accountant, plus CEO as approver). About 6 active borrowers today (so volume is tiny; correctness, control and auditability matter far more than scale). Lends cash against collateral to individuals and businesses, short term, **20% flat per month**, with weekly default penalties, and recovers through the courts by disposing of collateral.

Current state: paper files, then Excel. Go-live replaces both. Old records (not many) are entered manually.

### 1.2 Functional requirements (FR)

| ID | Requirement | Release |
| --- | --- | --- |
| FR-01 | Staff authentication (email + password), roles, no public sign-up, admin-created users | MVP |
| FR-02 | Branches and company settings (header, currency, rule values) | MVP |
| FR-03 | Customer register: individual and business, KYC fields, photo and document attachments, search | MVP |
| FR-04 | Edits to an existing customer require approval (maker-checker) | MVP |
| FR-05 | Guarantors per loan (optional), with ID details and document scan | MVP |
| FR-06 | Loan products (rates, term, penalty rules) as configuration | MVP |
| FR-07 | Loan application → approval workflow with limit-based approver and no self-approval | MVP |
| FR-08 | Disbursement of an approved loan by cashier (cash/MoMo/bank) | MVP |
| FR-09 | Flat interest and due-date calculation | MVP |
| FR-10 | Payments with numbered receipts and fixed allocation order; overpayment blocked | MVP |
| FR-11 | Field collection by loan officer with cashier remittance confirmation | MVP |
| FR-12 | Automatic weekly penalty accrual (idempotent daily job) | MVP |
| FR-13 | Due today / due this week / overdue lists; WhatsApp reminder links | MVP |
| FR-14 | Statement of account per loan and per customer (PDF) | MVP |
| FR-15 | Collateral register with photos, identifiers, location and custody log | MVP |
| FR-16 | Collateral linked to loans; one active loan per item; release on closure | MVP |
| FR-17 | Recovery cases (notice, court, judgment, disposal) and collateral sale with proceeds allocation | MVP |
| FR-18 | Loan extension (manager-approved) | MVP |
| FR-19 | Write-off with CEO approval and board reference | MVP |
| FR-20 | Void/reversal of payments and entries via approval, never edit or delete | MVP |
| FR-21 | Double-entry ledger, chart of accounts, approved manual journals | MVP |
| FR-22 | Expenses, payees, and payments to creditors (suppliers/expenses only; lender tracking is Phase 2) | MVP |
| FR-23 | Day close per cashier per branch, manager review, date lock | MVP |
| FR-24 | Reports: daily collections, daily payments, due loans, overdue balances, profit and loss, balance sheet, trial balance | MVP |
| FR-25 | PDF documents (receipt, statement, loan agreement, demand notice, collateral receipt/release) and public QR verification page | MVP |
| FR-26 | Immutable audit log of every change | MVP |
| FR-27 | Opening balances and back-dated entry for migration of paper/Excel records | MVP |
| FR-28 | Approvals inbox for all maker-checker requests | MVP |
| FR-29 | Role-aware dashboard | MVP |

### 1.3 Out of scope for MVP (do not build; keep the schema ready where noted)

- Payroll (schema reserved: `staff_payroll_*` not created yet). Release 2.
- Lender/investor loans-in tracking, deposits/savings. Release 2 (deposits only if licence allows).
- Mobile money API integration and automatic reconciliation. MVP records a reference number manually.
- WhatsApp/SMS sending via API. MVP generates `https://wa.me/<number>?text=<encoded>` links only.
- Offline field mode (PWA queue). MVP is mobile-first online; payments carry an idempotency key so Release 2 can add queuing without schema change.
- Multi-currency operation. Schema carries `currency` and `fx_rate`; UI and rules run in USD only.
- Group lending, borrower self-service portal, credit scoring, CBL regulatory report formats, MFA.
- Generic invoices. Lending does not use invoices; the equivalents are the loan agreement, repayment statement and demand notice (FR-14, FR-25). Add a generic invoice only if MSI later charges fees or sells goods.
- Collateral valuation workflows and insurance tracking.

---

## 2. Client facts, rules and assumptions

### 2.1 Facts stated by MSI (verbatim digest)

- 3 branches; 5 staff; roles: cashier, manager, loan officer, accountant. CEO and board authorise write-offs.
- About 6 active borrowers. Registered with the business registry; CBL licence fee paid, licensing still in progress; no reports filed with CBL yet.
- Lends cash against collateral, short term; a few borrowers have appealed for extended terms.
- Interest: **20% monthly, flat**. In default: **20% applies weekly to total due**. After a further month, the business initiates proceedings to dispose of the collateral to redeem funds.
- Lends to individuals and businesses. Guarantors required "if possible".
- Approval limit: **$2,000** (see A-07).
- If a borrower cannot pay: court, then dispose of collateral. Loans are written off when all recovery fails; authorised by the board through the CEO.
- Reports wanted: daily collections, daily payments, due loans, overdue balances, profit and loss, balance sheet.
- Cashier can see all customers and balances. Changes to customers require authorisation. Wrong records have occurred; amendments must require authorisation.
- Records: hard copies, then Excel; moving to software. Old records are few: enter manually.
- Collection is sometimes done in the field. Field officers use phones; the office uses computers; Foday can use his laptop.

### 2.2 Not yet answered by MSI (defaults apply, keep configurable)
Currency/exchange rate; payment channels; who "creditors" are; collateral types/storage/documents; one item for several loans; fees; payroll details; printers; WhatsApp use; CBL report format; budget/timeline; decision contact.

### 2.3 Assumption register (generate `docs/ASSUMPTIONS.md` from this table)

| ID | Assumption (default implemented) | Setting key | Needs sign-off from |
| --- | --- | --- | --- |
| A-01 | Operating currency is USD (`$`). LRD not enabled in MVP | `currency.base`=`USD` | CEO |
| A-02 | Default term is 1 month; `due_date = disbursed_on + term_months` calendar months, clamped to month end (31 Jan + 1 month = 28 Feb) | `product.default_term_months`=1 | Manager |
| A-03 | Interest = `principal × rate_bps/10000 × term_months`, flat, charged in full at disbursement and recognised as income then (accrual basis) | `product.interest_rate_bps`=2000 | Accountant |
| A-04 | Repayment is flexible: any number of partial payments before or after due date; no instalment schedule | n/a | Manager |
| A-05 | Allocation order: penalties, then interest, then principal. Overpayment is rejected | `payments.allocation_order` | Accountant |
| A-06 | Penalty = 20% (`penalty_rate_bps`=2000) of the **outstanding total due** at each 7-day mark after due date (compounding), maximum 4 charges | `product.penalty_base`=`outstanding_total`, `penalty_period_days`=7, `penalty_max_periods`=4 | CEO + lawyer |
| A-07 | Loans ≤ `$2,000` approved by manager; above, by CEO. Creator cannot approve own loan | `approvals.loan_manager_limit_cents`=200000 | CEO |
| A-08 | Recovery becomes eligible 30 days after due date; a manager opens the case. Penalties stop after the 4th charge or when a case opens, whichever is first | `product.recovery_after_days`=30 | CEO |
| A-09 | Extension: manager approves; adds `principal_outstanding × rate_bps × extra_months` as interest; due date moves by `extra_months`; accrued penalties stay; penalty counter resets to 0 | `extension.enabled`=true | Manager |
| A-10 | Collateral is mandatory for every loan; guarantors optional; one collateral item secures one active loan at a time | `loans.collateral_required`=true, `collateral.multi_loan`=false | Manager |
| A-11 | Loan officers and managers may create customers directly; any edit to an existing customer goes through approval (manager) | n/a | Manager |
| A-12 | Field collections post to "Field Cash (unremitted)" until the cashier confirms handover; receipts to the borrower are issued immediately | `field.require_remittance`=true | Manager |
| A-13 | Write-off posts the whole outstanding to Bad Debts Expense (direct write-off, no allowance); needs CEO approval and board reference text | n/a | Accountant |
| A-14 | Collateral sale proceeds apply in allocation order; surplus is recorded as a liability owed to the borrower (account 2100); shortfall remains outstanding until written off | n/a | CEO |
| A-15 | Accounting basis: accrual (interest at disbursement, penalties when charged). Accountant to confirm vs cash basis | `accounting.basis`=`accrual` | Accountant |
| A-16 | Receipt/document numbering is per branch and sequential, never reused | n/a | Manager |
| A-17 | No loan fees in MVP (processing/application) | `product.fees`=[] | Manager |
| A-18 | Day close is mandatory per branch per day (submitted by the cashier); an approved close locks that date for the branch; a manager can reopen it with a reason | `daycloses.enforce`=true | Manager |
| A-19 | Back-dated entry allowed only for roles admin/accountant, only before `go_live_date`; after that all postings are dated today | `migration.go_live_date` | Accountant |
| A-20 | Expenses above `$100` need manager approval; below, accountant records directly | `approvals.expense_limit_cents`=10000 | Manager |

Worked example proving A-03/A-06 is in section 12 (T-03..T-07). Alternative penalty base `original_due` must also work (T-08).

---

## 3. Architecture and decisions

### 3.1 Stack (matches the existing Corex pattern)

- Next.js (App Router) + TypeScript (strict) + Tailwind CSS + shadcn/ui
- Supabase: Postgres, Auth, Storage, Row Level Security, `pg_cron`
- Hosting: Vercel (app), Supabase (data). Start on Supabase Free for the demo; production on Pro (daily backups, PITR)
- PDF: `@react-pdf/renderer` in route handlers; QR: `qrcode`
- Forms/validation: `react-hook-form` + `zod`; tables: `@tanstack/react-table`; dates: `date-fns`
- UI text: `next-intl`, English only in MVP, every user-facing string in `messages/en.json` (translation-ready); money and date formatting through one shared formatter module
- Motion: `motion` (Framer Motion) for subtle product motion only (section 11)
- Tests: Vitest (unit + DB integration against local Supabase), Playwright (smoke e2e) with `@axe-core/playwright` for accessibility checks
- Delivery: GitHub (branch per milestone, pull request at each gate), GitHub Actions CI (lint, typecheck, unit, DB tests on local Supabase, build; Playwright smoke on PRs); local Supabase CLI + Docker for development; cloud Supabase + Vercel staging and production set up at the end of M9
- Package manager: `pnpm`

### 3.2 Locked decisions (do not revisit without asking)

| ID | Decision | Reason |
| --- | --- | --- |
| D-01 | Double-entry ledger is the source of truth for every money figure; balances are **derived** from `journal_lines`, never stored as mutable columns | Receipts, statements, reports and payroll all reconcile automatically |
| D-02 | Posted journals are immutable (DB trigger + no UPDATE/DELETE privileges). Corrections are reversing journals | Fraud resistance, audit |
| D-03 | All money operations are Postgres functions (`SECURITY DEFINER`, called via `supabase.rpc`) that validate permissions, post journals and write the audit log in **one transaction** | supabase-js cannot run multi-statement transactions; no duplicated logic |
| D-04 | Money = integer cents; rates = integer basis points (2000 = 20.00%); rounding = round half up at each posting | Determinism |
| D-05 | Maker-checker through a single `approval_requests` table; the approving function applies the change | One mechanism, one inbox |
| D-06 | Timezone `Africa/Monrovia` (UTC+0, no DST); store `date` for business dates and `timestamptz` for events | Simplicity |
| D-07 | Staff-only system in MVP; customers never log in | Scope |
| D-08 | Mobile-first responsive UI; every screen usable at 360px width | Field officers use phones |
| D-09 | All writes from the web app go through server actions calling RPCs; the browser uses the anon key with RLS for **reads only** | Defence in depth |
| D-10 | Single legal entity, single chart of accounts, cash accounts per branch | Matches client |
| D-11 | Daily accrual job runs inside Postgres (`pg_cron`) and is also callable manually (`rpc('run_daily_accruals', {as_of})`) by manager/admin; it is idempotent | Reliability |
| D-12 | UI language English; money `$1,234.56`; dates `05 Feb 2026` | Client |

### 3.3 Repository layout

```
loandesk/
  CLAUDE.md
  docs/ SPEC.md ASSUMPTIONS.md QUESTIONS.md OPERATIONS.md
  supabase/
    config.toml
    migrations/            # numbered SQL, one concern per file
    seed/ seed_core.sql seed_demo.sql
    tests/                 # SQL + Vitest integration tests
  src/
    app/
      (auth)/login/
      (app)/
        dashboard/ customers/ loans/ collateral/ payments/ due/
        recovery/ approvals/ day-close/ expenses/ payees/
        reports/ settings/ audit/ field/
      verify/[token]/      # public QR verification
      api/pdf/[kind]/[id]/route.ts
      api/cron/daily/route.ts   # optional HTTP fallback, secret-protected
    components/ ui/ forms/ tables/ layout/
    lib/ supabase/ money.ts dates.ts permissions.ts format.ts pdf/ whatsapp.ts
    types/ database.ts      # generated from Supabase
  tests/e2e/
```

### 3.4 Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only: user creation, cron fallback
CRON_SECRET=                    # protects /api/cron/daily
NEXT_PUBLIC_APP_URL=            # used in QR verification links
```
Add variables only when the milestone needs them.

---

## 4. Roles and permissions

Roles: `admin` (Corex technical admin), `ceo`, `manager`, `accountant`, `cashier`, `loan_officer`. One role per user; each user has a `branch_id` (nullable for ceo/admin/accountant).

**Read access:** all staff can read all customers, loans, balances and collateral across branches (client requirement). Financial reports and the ledger: `ceo`, `manager`, `accountant`, `admin`. Audit log: `ceo`, `manager`, `admin`. Writes are branch-scoped except where noted.

| Action | loan_officer | cashier | manager | accountant | ceo | admin |
| --- | --- | --- | --- | --- | --- | --- |
| Create customer | yes | no | yes | no | no | yes |
| Request customer edit | yes | yes | yes | no | no | yes |
| Approve customer edit | no | no | yes | no | yes | no |
| Create loan application | yes | no | yes | no | no | no |
| Approve loan ≤ limit | no | no | yes (not own) | no | yes | no |
| Approve loan > limit | no | no | no | no | yes | no |
| Disburse approved loan | no | yes | no | no | no | no |
| Receive payment (office) | no | yes | yes | no | no | no |
| Record field payment | yes | no | no | no | no | no |
| Confirm field remittance | no | yes | yes | no | no | no |
| Request payment void | no | yes | yes | yes | no | no |
| Approve void / reversal | no | no | yes (not own) | no | yes | no |
| Register collateral | yes | yes | yes | no | no | no |
| Release collateral (loan closed) | no | yes | yes | no | no | no |
| Open recovery case | no | no | yes | no | yes | no |
| Record collateral sale | no | no | yes | no | yes | no |
| Extend loan (request) | yes | no | yes | no | no | no |
| Approve extension | no | no | yes (not own) | no | yes | no |
| Request write-off | no | no | yes | yes | no | no |
| Approve write-off | no | no | no | no | yes | no |
| Record expense ≤ limit | no | no | yes | yes | no | no |
| Approve expense > limit | no | no | yes (not own) | no | yes | no |
| Manual journal (request) | no | no | no | yes | no | yes |
| Approve manual journal | no | no | yes | no | yes | no |
| Submit day close | no | yes | no | no | no | no |
| Approve day close | no | no | yes | no | yes | no |
| Run accruals manually | no | no | yes | no | no | yes |
| Manage users, products, settings | no | no | no | no | no | yes |
| View audit log | no | no | yes | no | yes | yes |

Segregation rules enforced in SQL (not only the UI): requester ≠ approver for every approval; loan creator ≠ loan approver; the user disbursing may be anyone with cashier role.

Approval routing is data-driven: `approval_requests.required_role` is computed by the creating function from settings (for example loan amount vs `loan_manager_limit_cents`). `ceo` can always approve anything a `manager` can.

---

## 5. Domain rules

### 5.1 Where logic lives

| Concern | Lives in | Never in |
| --- | --- | --- |
| Interest, penalty, allocation, posting, approvals, number sequences | Postgres functions | TypeScript, browser |
| Validation of form shape, formatting, PDF layout, WhatsApp text | TypeScript | Postgres |
| Previewing a loan's cost before saving | `rpc('preview_loan_terms')` (same SQL as disbursement) | A TypeScript copy of the formula |

### 5.2 Formulas (all integer arithmetic)

```
round_half_up(n, d) = (2*n + d) / (2*d)            -- integer division, positive values
pct(amount_cents, bps) = round_half_up(amount_cents * bps, 10000)

interest_cents   = pct(principal_cents, interest_rate_bps) * term_months     -- A-03
total_due_cents  = principal + interest
due_date         = disbursed_on + (term_months months)                       -- calendar months, clamped (A-02)

days_overdue     = max(0, as_of - due_date)
penalty_k (k = 1..penalty_max_periods) is charged when days_overdue >= k * penalty_period_days
penalty_base     = outstanding_total (principal + interest + penalties unpaid, at charging time)   -- A-06 default
                 | original_due     (principal + interest at disbursement)                          -- alternative
penalty_k_cents  = pct(penalty_base, penalty_rate_bps)
```
Penalties stop when: `k > penalty_max_periods`, or the loan has an open recovery case, or the loan is closed/written off.

**Determinism rule (late runs):** `charge_date_k = due_date + k * penalty_period_days`. The base for `penalty_k` is computed **as of the end of `charge_date_k`**, using only `journal_lines` whose journal `entry_date <= charge_date_k` (function `loan_outstanding_as_of(loan_id, date)`), and `k` is processed in ascending order with each earlier penalty included. The journal for the penalty is dated the run date (so it never hits a locked period), but the amount is identical whether the job ran daily or was late. See T-33.
Recovery eligibility: `days_overdue >= recovery_after_days` (default 30).

Allocation of a payment `A` (A-05): `penalty_outstanding` first, then `interest_outstanding`, then `principal_outstanding`. Reject if `A > total_outstanding` (error `OVERPAYMENT`). Reject `A <= 0`.

Reference numeric vectors: section 12. `tools/vectors.py` in this repo is the reference implementation; the SQL must match it exactly.

### 5.3 Loan status machine

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──disburse──▶ active
   │                    │ reject                    │ cancel                │
   ▼                    ▼                           ▼                       │ due_date passed & outstanding > 0 (job)
cancelled            rejected                   cancelled                   ▼
                                                                         overdue ──open case (manager)──▶ recovery
active/overdue/recovery ──outstanding = 0──▶ closed        recovery ──write-off approved──▶ written_off
overdue ──extension approved──▶ active (new due_date)       closed|written_off: terminal
```
Rules:
- Only `draft` is editable, and only by its creator. After submission, changes go through a new application or approval-reject-and-resubmit.
- `disburse` requires: status `approved`; at least one `loan_collaterals` row with status `pledged` if `loans.collateral_required`; cashier till open (day not closed) for that branch.
- `closed` is set by `receive_payment` / `confirm_collateral_sale` when outstanding reaches 0. Closing triggers a prompt (not an automatic action) to release collateral.
- Status changes happen **only** inside RPCs and are written to `audit_log`.

### 5.4 Payment flow

1. **Office payment** (cashier/manager): `receive_payment(loan_id, amount_cents, method, reference, received_on, idempotency_key)`. Posts recipe R2, creates `payments` + `payment_allocations`, issues receipt number, returns receipt id.
2. **Field payment** (loan officer): `record_field_payment(...)` same arguments. Posts recipe R3 (Dr Field Cash, Cr receivables). Receipt issued immediately. `payments.remittance_status = 'pending'`.
3. **Remittance** (cashier): `confirm_remittance(payment_ids[])` posts R3b (Dr Cash, Cr Field Cash) and sets `remittance_status='confirmed'`. Dashboard flags `pending` older than 1 day (red) and 3 days (blocking for day close of that officer's branch: manager must acknowledge).
4. **Idempotency:** `payments.idempotency_key` is unique per user; a repeated key returns the original receipt and posts nothing.
5. **Method rules:** `cash` needs no reference; `mobile_money` and `bank` require `reference` (text, min 4 chars). The debit account follows the method: `cash` → `1010-<BR>` of the receiver's branch; `bank` → `1020`; `mobile_money` → `1030`. Field payments always debit `1015` first.
6. **Dates:** `received_on` and `disbursed_on` default to today. A different date is accepted only for roles admin/accountant and only before `migration.go_live_date` (A-19); otherwise `DATE_NOT_ALLOWED`.
7. **Concurrency:** `receive_payment`, `record_field_payment`, `disburse_loan`, `request_extension`, `record_collateral_sale` and `run_daily_accruals` all take `select … for update` on the loan row before reading balances.
8. **Remittance control:** `confirm_remittance(payment_ids, counted_total_cents)` requires the counted total to equal the sum of the selected payments, otherwise `REMITTANCE_MISMATCH`; a shortfall is escalated to the manager and recorded as an approved manual journal (A-12). Disbursement checks the chosen account's balance; insufficient funds give `INSUFFICIENT_FUNDS` (setting `disbursement.check_funds`, default true).
9. **Void:** `request_void_payment(payment_id, reason)` creates an approval; on approval a reversing journal is posted dated today, the payment shows `voided`, the receipt prints "VOID". The original journal is untouched. Voiding a payment whose loan is `closed` re-opens it (status recomputed).

### 5.5 Accrual job (FR-12)

`run_daily_accruals(as_of date default current_date)`:
1. Mark loans `overdue` where `status='active'`, `due_date < as_of`, outstanding > 0.
2. For each overdue loan without an open recovery case, take a row lock on the loan (`select … for update`), then for each `k` in `1..penalty_max_periods` with `as_of - due_date >= k * period_days` and no `loan_penalty_events` row `(loan_id, due_date_version, k)`: compute `penalty_k` per the determinism rule in 5.2, post recipe R4, insert the event. The unique key makes reruns safe.
3. Flag `recovery_eligible = true` where `as_of - due_date >= recovery_after_days`.
4. Write an `accrual_runs` row (date, counts, duration). Return the counts.

`due_date_version` increments when an extension changes the due date, so penalties restart cleanly (A-09).

`pg_cron`: schedule `0 1 * * *` UTC. Fallback: `GET /api/cron/daily` with header `Authorization: Bearer $CRON_SECRET` (used if cron is unavailable on the plan).

### 5.6 Extension (FR-18)
`request_extension(loan_id, extra_months, reason)` → approval (manager, not requester). On approval: post R5 (Dr Interest Receivable, Cr Interest Income) for `pct(principal_outstanding, interest_rate_bps) * extra_months`; set `loans.due_date += extra_months`; `due_date_version += 1`; insert `loan_extensions`; status returns to `active`. Extension is refused if a recovery case is open.

### 5.7 Recovery and collateral disposal (FR-17)
1. `open_recovery_case(loan_id, note)` (manager/CEO): allowed when `recovery_eligible`; status `recovery`; penalties stop. Case stages: `notice_sent` → `court_filed` → `judgment` → `disposal` → `closed`. Each stage change is a `recovery_actions` row with date, note, optional court reference and attachment.
2. `record_collateral_sale(case_id, collateral_id, sale_amount_cents, buyer_name, method, sold_on, court_ref)` (manager/CEO): posts R7. Proceeds allocate in order (A-05) to the loan up to its outstanding; any excess posts to account 2100 (Customer Surplus Payable). Collateral status becomes `sold`. If outstanding reaches 0, the loan closes and the case closes.
3. `pay_surplus(loan_id, amount_cents)`: Dr 2100, Cr Cash.
4. Disposal costs (court fees, auctioneer) are ordinary expenses with category "Legal and recovery" and optional `loan_id` link (shown on the case).
5. If proceeds are insufficient, the shortfall stays outstanding; the manager may request write-off (FR-19).

### 5.8 Write-off (FR-19)
`request_write_off(loan_id, reason)` (manager or accountant) requires a case in stage `disposal` or `closed`, or a manager override reason ≥ 20 chars. CEO approves with `board_reference` (free text, required). Posts R6 for the full outstanding by component, status `written_off`. Later recoveries use `receive_payment` with `source='post_write_off_recovery'`, posting Dr Cash, Cr 4100 Recoveries of Written-off Loans.

### 5.9 Collateral rules (FR-15, FR-16)
- Item types: `vehicle`, `land_document`, `electronics`, `goods`, `savings_lien`, `other` (settings list).
- Identifiers: `serial_no`, `plate_no`, `chassis_no`, `document_no` (all nullable). Duplicate detection: warn when the same non-null identifier exists on another active item.
- `status`: `held` → `released` | `in_recovery` → `sold` | `lost`.
- Link table `loan_collaterals(loan_id, collateral_id, status pledged|released|seized|sold)`; partial unique index: at most one `pledged`/`seized` row per `collateral_id` when `collateral.multi_loan=false`.
- Custody log `collateral_events` (append-only): received, moved, valued, released, seized, sold, lost, note. Each has actor, optional witness name, optional photo, note.
- Search: free text over code, description, identifiers, borrower name, loan number.
- Release: manager/cashier only when all linked loans are `closed` (or `written_off` after sale/surrender). Prints a release letter.

### 5.10 Day close (FR-23)
`submit_day_close(branch_id, date, counted_cash_cents, note)` by cashier, one per branch per date. System computes `expected_cash` from the ledger (movement of the branch's `1010-<BR>` account for that date, plus the opening balance carried from the previous close) and stores `variance`. Manager/CEO approves (variance ≠ 0 requires a note). Approval sets `period_locks` (`locked_through = close_date`) for that branch. `post_journal` refuses lines for that branch dated on or before the lock. Reversals (R8) are dated today and therefore need an open day.
`reopen_day_close(close_id, reason)` (manager/CEO): removes the lock for that date, marks the close `rejected`, and writes an audit row. Needed when a payment arrives after the close; the cashier then submits a new close.

### 5.11 Customers (FR-03, FR-04)
- Types: `individual`, `business`. Business has registered name, registration number, contact person.
- Direct create by loan officer/manager. Edits: `request_customer_edit(customer_id, patch jsonb, reason)` → approval → `apply_customer_edit` applies the patch and logs before/after.
- Soft state only: `active`, `blacklisted`, `archived`. Never hard delete. Blacklisting is itself an approved edit.
- Duplicate guard on create: same `phone` or same `id_number` shows a blocking warning listing the existing record (override requires manager).

---

## 6. Ledger design

### 6.1 Chart of accounts (seed in `seed_core.sql`)

| Code | Name | Type | Notes |
| --- | --- | --- | --- |
| 1010-<BR> | Cash on Hand – <branch> | asset | one per branch, `is_cash=true` |
| 1015 | Field Cash (unremitted) | asset | line dimension `staff_id` |
| 1020 | Bank | asset | |
| 1030 | Mobile Money | asset | |
| 1100 | Loans Receivable – Principal | asset | component `principal` |
| 1110 | Interest Receivable | asset | component `interest` |
| 1120 | Penalties Receivable | asset | component `penalty` |
| 2000 | Accounts Payable | liability | |
| 2100 | Customer Surplus Payable | liability | |
| 3000 | Owner's Capital | equity | |
| 3900 | Opening Balance Equity | equity | used by migration wizard |
| 4000 | Interest Income | income | |
| 4010 | Penalty Income | income | |
| 4100 | Recoveries of Written-off Loans | income | |
| 4900 | Other Income | income | |
| 5000 | Salaries and Wages | expense | |
| 5010 | Rent | expense | |
| 5020 | Utilities and Internet | expense | |
| 5030 | Transport and Fuel | expense | |
| 5040 | Legal and Recovery Costs | expense | |
| 5050 | Bad Debts Expense | expense | |
| 5060 | Bank and Mobile Money Charges | expense | |
| 5900 | Other Expenses | expense | |

Retained earnings is **computed** (income − expense to date), not an account.

### 6.2 Posting recipes (every recipe is one journal; debits = credits)

| Recipe | Event | Lines |
| --- | --- | --- |
| R1 | Disbursement of P with interest I | Dr 1100 P (loan, component principal); Dr 1110 I (loan, interest); Cr cash/bank/MoMo account P; Cr 4000 I |
| R2 | Office payment A allocated (pen, int, prin) | Dr cash account A; Cr 1120 pen; Cr 1110 int; Cr 1100 prin (omit zero lines) |
| R3 | Field payment | Dr 1015 A (staff = collector); Cr 1120/1110/1100 as R2 |
| R3b | Remittance confirmed | Dr 1010-<BR> A; Cr 1015 A (staff = collector) |
| R4 | Penalty charged | Dr 1120; Cr 4010 |
| R5 | Extension interest | Dr 1110; Cr 4000 |
| R6 | Write-off of pen/int/prin | Dr 5050 total; Cr 1120 pen; Cr 1110 int; Cr 1100 prin |
| R7 | Collateral sale S | Dr cash/bank S; Cr 1120/1110/1100 allocated; Cr 2100 surplus (if any) |
| R7b | Surplus paid out | Dr 2100; Cr cash |
| R8 | Void/reversal | Same lines as original with debit/credit swapped; `reversal_of` = original journal |
| R9 | Expense paid | Dr expense account; Cr cash/bank/MoMo |
| R9b | Expense on credit | Dr expense account; Cr 2000 (payee dimension) |
| R9c | Payee paid | Dr 2000; Cr cash/bank/MoMo |
| R10 | Capital in | Dr cash/bank; Cr 3000 |
| R11 | Manual journal | Free lines, approved, memo required |
| R12 | Opening balance entry | Dr asset / Cr 3900 (or reverse for liabilities) |

Loan balance by component = `SUM(debit − credit)` over `journal_lines` where `loan_id = X` and `component = c`. Expose as view `loan_balances` and use it everywhere. Never store a balance column on `loans`.

### 6.3 Invariants (implement exactly; tests T-20..T-22)

```sql
-- 1. A journal must balance at commit.
create or replace function trg_journal_balanced() returns trigger language plpgsql as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into d, c from journal_lines where journal_id = new.journal_id;
  if d <> c or d = 0 then
    raise exception 'JOURNAL_UNBALANCED: debits % credits %', d, c using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function trg_journal_balanced();

-- 2. A line is either a debit or a credit, never both, never negative.
alter table journal_lines add constraint line_one_sided check (
  debit_cents >= 0 and credit_cents >= 0 and (debit_cents = 0) <> (credit_cents = 0));

-- 3. Posted journals are immutable.
create or replace function trg_immutable() returns trigger language plpgsql as $$
begin raise exception 'IMMUTABLE_RECORD: % on % is not allowed', tg_op, tg_table_name using errcode = '42501'; end $$;
create trigger journals_immutable before update or delete on journals for each row execute function trg_immutable();
create trigger journal_lines_immutable before update or delete on journal_lines for each row execute function trg_immutable();
create trigger audit_immutable before update or delete on audit_log for each row execute function trg_immutable();
create trigger collateral_events_immutable before update or delete on collateral_events for each row execute function trg_immutable();

-- 4. Document numbers: gapless per (kind, branch) using a locked counter row.
--    Global sequences (journal, customer, collateral) use the sentinel branch id below,
--    because a NULL branch_id would defeat the unique constraint.
--    document_sequences(kind text, branch_id uuid not null, last_value bigint, primary key (kind, branch_id))
create or replace function next_number(p_kind text, p_branch uuid default null) returns text language plpgsql as $$
declare n bigint; code text; b uuid := coalesce(p_branch, '00000000-0000-0000-0000-000000000000');
begin
  insert into document_sequences(kind, branch_id, last_value) values (p_kind, b, 0)
    on conflict (kind, branch_id) do nothing;
  update document_sequences set last_value = last_value + 1
    where kind = p_kind and branch_id = b returning last_value into n;
  select coalesce((select br.code from branches br where br.id = p_branch), 'HQ') into code;
  return case p_kind
    when 'receipt' then format('RCT-%s-%s', code, lpad(n::text, 6, '0'))
    when 'loan'    then format('LN-%s-%s',  code, lpad(n::text, 5, '0'))
    when 'journal' then format('JV-%s',     lpad(n::text, 7, '0'))
    when 'customer'then format('CU-%s',     lpad(n::text, 6, '0'))
    when 'collateral' then format('COL-%s', lpad(n::text, 6, '0'))
    when 'expense' then format('EXP-%s-%s', code, lpad(n::text, 5, '0'))
    else format('%s-%s', upper(p_kind), n) end;
end $$;
```
`post_journal(p_date, p_memo, p_source_type, p_source_id, p_branch, p_lines jsonb) returns uuid` is the **only** function that inserts into `journals` / `journal_lines`. All recipe functions call it. It checks: date not locked (5.10), accounts active, currency consistent, and writes the audit row.

### 6.4 Row Level Security pattern

- `alter table x enable row level security` on every table; no table without policies.
- Helper functions (`stable`, `security definer`, `set search_path = public`): `auth_role()`, `auth_branch()`, `is_staff()`.
- Read policies: `using (is_staff())` for customers/loans/collateral/payments/payments views; ledger and reports tables `using (auth_role() in ('ceo','manager','accountant','admin'))`.
- **No insert/update/delete policies** for authenticated users on money tables; only RPCs (security definer) write. Master data tables (products, settings, branches, profiles) are written only via admin RPCs.
- Storage buckets are private; access through signed URLs generated server-side after a role check.
- Functions: every RPC is created with `security definer set search_path = public`, then `revoke all on function … from public; grant execute on function … to authenticated;`. Each function checks `auth_role()` itself; never rely on the UI hiding a button.

---

## 7. Data model

Conventions: `id uuid pk default gen_random_uuid()`; `created_at timestamptz default now()`; `created_by uuid references profiles`; money `*_cents bigint`; rates `*_bps int`; all enums as Postgres `enum` or `text check`. Every table has RLS enabled (6.4). `†` = append-only (immutable trigger).

### 7.1 Identity and configuration

| Table | Key columns |
| --- | --- |
| `branches` | `code` (unique, e.g. BR1), `name`, `address`, `phone`, `active` |
| `profiles` | `id` = `auth.users.id`, `full_name`, `phone`, `role` (admin, ceo, manager, accountant, cashier, loan_officer), `branch_id` null, `active` |
| `settings` | `key` pk, `value jsonb`, `updated_by`, `updated_at` (keys listed in section 2.3 plus `company` {name, address, phone, email, logo_path, receipt_footer}) |
| `loan_products` | `name`, `interest_rate_bps` (2000), `rate_period` (`month`), `interest_method` (`flat`), `default_term_months` (1), `max_term_months`, `penalty_rate_bps` (2000), `penalty_period_days` (7), `penalty_base` (`outstanding_total`\|`original_due`), `penalty_max_periods` (4), `recovery_after_days` (30), `active` |
| `document_sequences` | `kind`, `branch_id` (not null, sentinel for global), `last_value`; pk `(kind, branch_id)` |

### 7.2 Customers

| Table | Key columns |
| --- | --- |
| `customers` | `code` (CU-…), `type` (individual\|business), `first_name`, `last_name`, `business_name`, `registration_no`, `contact_person`, `phone`, `phone_alt`, `address`, `city`, `id_type`, `id_number`, `date_of_birth`, `occupation`, `employer_or_business`, `next_of_kin_name`, `next_of_kin_phone`, `next_of_kin_relation`, `photo_path`, `branch_id`, `assigned_officer_id`, `status` (active\|blacklisted\|archived), `notes` |
| `guarantors` | `loan_id`, `full_name`, `phone`, `address`, `id_type`, `id_number`, `relationship`, `doc_path` |
| `attachments` | `entity_type` (customer\|loan\|collateral\|recovery_action\|expense), `entity_id`, `kind`, `storage_path`, `file_name`, `mime`, `size_bytes` (`†`-style: rows are never deleted; replacing a file adds a row) |

### 7.3 Loans, payments, accruals

| Table | Key columns |
| --- | --- |
| `loans` | `loan_no`, `customer_id`, `product_id`, `branch_id`, `officer_id`, `principal_cents`, `currency`, `term_months`, `interest_rate_bps` (snapshot), `interest_cents` (snapshot, computed at submission), `penalty_*` (snapshot of product rules), `purpose`, `status` (see 5.3), `disbursed_on`, `due_date`, `due_date_version` (int, default 1), `recovery_eligible bool`, `approved_by`, `approved_at`, `disbursed_by`, `disbursement_method`, `disbursement_account_id`, `parent_loan_id` null, `closed_on` |
| `loan_extensions` | `loan_id`, `extra_months`, `old_due_date`, `new_due_date`, `extra_interest_cents`, `approval_id`, `journal_id` |
| `loan_penalty_events` | `loan_id`, `due_date_version`, `period_no`, `base_cents`, `penalty_cents`, `charged_on` (= the charge date `due_date + k*period_days`, not the run date), `journal_id`; **unique `(loan_id, due_date_version, period_no)`** |
| `payments` | `receipt_no` (unique), `loan_id`, `customer_id`, `branch_id`, `amount_cents`, `method` (cash\|mobile_money\|bank), `reference`, `received_on`, `received_by`, `collected_in_field bool`, `remittance_status` (n/a\|pending\|confirmed), `remittance_confirmed_by`, `remittance_confirmed_at`, `status` (posted\|voided), `source` (normal\|post_write_off_recovery), `idempotency_key` (unique with `received_by`), `journal_id` |
| `payment_allocations` | `payment_id`, `component` (penalty\|interest\|principal), `amount_cents` |
| `accrual_runs` | `run_date`, `overdue_marked`, `penalties_posted`, `recovery_flagged`, `started_at`, `finished_at`, `triggered_by` |

### 7.4 Collateral and recovery

| Table | Key columns |
| --- | --- |
| `collaterals` | `code` (COL-…), `owner_customer_id`, `type`, `description`, `serial_no`, `plate_no`, `chassis_no`, `document_no`, `estimated_value_cents`, `currency`, `location_note`, `status` (held\|released\|in_recovery\|sold\|lost), `branch_id` |
| `loan_collaterals` | `loan_id`, `collateral_id`, `status` (pledged\|released\|seized\|sold), `pledged_on`, `released_on`; partial unique index on `collateral_id` where status in (`pledged`,`seized`) when `collateral.multi_loan=false` |
| `collateral_events` `†` | `collateral_id`, `event_type` (received\|moved\|valued\|released\|seized\|sold\|lost\|note), `from_location`, `to_location`, `note`, `witness_name`, `photo_path`, `actor_id`, `at` |
| `recovery_cases` | `loan_id`, `stage` (notice_sent\|court_filed\|judgment\|disposal\|closed), `opened_by`, `court_ref`, `opened_on`, `closed_on` |
| `recovery_actions` `†` | `case_id`, `stage`, `action_date`, `note`, `court_ref`, `attachment_id` |
| `collateral_sales` | `case_id`, `collateral_id`, `loan_id`, `sale_amount_cents`, `buyer_name`, `method` (court_order\|auction\|private_sale), `sold_on`, `court_ref`, `applied_penalty_cents`, `applied_interest_cents`, `applied_principal_cents`, `surplus_cents`, `journal_id` |

### 7.5 Ledger and control

| Table | Key columns |
| --- | --- |
| `accounts` | `code` (unique), `name`, `type` (asset\|liability\|equity\|income\|expense), `is_cash bool`, `branch_id` null, `active` |
| `journals` `†` | `journal_no`, `entry_date`, `memo`, `source_type`, `source_id`, `branch_id`, `reversal_of` null, `posted_by`, `posted_at` |
| `journal_lines` `†` | `journal_id`, `account_id`, `debit_cents`, `credit_cents`, `currency` (default `USD`), `fx_rate_micros` (default 1000000), `loan_id` null, `customer_id` null, `payee_id` null, `staff_id` null, `component` null (principal\|interest\|penalty) |
| `period_locks` | `branch_id`, `locked_through date`, `locked_by`, `locked_at` |
| `day_closes` | `branch_id`, `close_date`, `cashier_id`, `expected_cash_cents`, `counted_cash_cents`, `variance_cents`, `note`, `status` (submitted\|approved\|rejected), `approved_by`; unique `(branch_id, close_date)` where status in (submitted, approved) |
| `issued_documents` | `kind` (receipt\|statement\|loan_agreement\|demand_notice\|collateral_receipt\|collateral_release), `number` (unique), `entity_id`, `token` (unique, random 22+ chars), `generated_by`, `generated_at`, `is_void bool`; backs `/verify/[token]` |
| `approval_requests` | `type` (customer_edit, loan_approval, loan_extension, payment_void, journal_reversal, write_off, expense, manual_journal, day_close, customer_blacklist), `entity_type`, `entity_id`, `payload jsonb`, `required_role` (manager\|ceo), `status` (pending\|approved\|rejected\|cancelled), `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_note`, `reason` |
| `audit_log` `†` | `at`, `actor_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip` |

### 7.6 Expenses and payees

| Table | Key columns |
| --- | --- |
| `payees` | `name`, `type` (supplier\|landlord\|utility\|other), `phone`, `notes`, `active` |
| `expenses` | `expense_no`, `payee_id` null, `account_id` (expense account), `amount_cents`, `expense_date`, `description`, `paid_now bool`, `paid_from_account_id` null, `status` (pending_approval\|approved\|paid\|rejected), `receipt_attachment_id`, `branch_id`, `journal_id`, `settled_journal_id` null |

### 7.7 Views and indexes
- `loan_balances` (loan_id, principal_out, interest_out, penalty_out, total_out, last_payment_on, days_overdue, next_penalty_on).
- `customer_balances` (customer_id, total_out, loans_active, loans_overdue).
- `due_list` (loan rows with bucket: `due_today`, `due_7d`, `overdue_1_7`, `overdue_8_30`, `overdue_30_plus`).
- `cash_position` (per cash account per branch per date).
- Indexes: `journal_lines(loan_id, component)`, `journal_lines(account_id)`, `payments(loan_id)`, `loans(status, due_date)`, `customers(phone)`, `customers(id_number)`, trigram GIN on customers name, collateral identifiers.

---

## 8. RPC catalogue (all `security definer`, each validates `auth_role()`, writes `audit_log`, one transaction)

| Function | Used by | Notes |
| --- | --- | --- |
| `create_customer(jsonb)` | FR-03 | duplicate guard, returns code |
| `request_customer_edit(id, patch, reason)` / `decide_approval(id, decision, note)` | FR-04, FR-28 | `decide_approval` dispatches on `type` |
| `create_loan_draft(jsonb)`, `submit_loan(id)` | FR-07 | computes snapshot terms; routes approval by amount vs limit |
| `preview_loan_terms(principal, product, term, disbursed_on)` | FR-09 | read-only, same SQL helpers as submission |
| `approve_loan` / `reject_loan` (through `decide_approval`) | FR-07 | enforces creator ≠ approver, limit |
| `disburse_loan(id, method, account_id, disbursed_on)` | FR-08 | R1; sets `due_date`; collateral and day-lock checks |
| `receive_payment(...)`, `record_field_payment(...)`, `confirm_remittance(ids, counted_total_cents)` | FR-10, FR-11 | idempotent |
| `request_void_payment(id, reason)` | FR-20 | on approval posts R8 |
| `run_daily_accruals(as_of)` | FR-12 | idempotent |
| `request_extension(...)` | FR-18 | on approval R5 |
| `register_collateral(jsonb)`, `link_collateral(loan_id, collateral_id)`, `log_collateral_event(...)`, `release_collateral(collateral_id, note)` | FR-15, FR-16 | |
| `open_recovery_case`, `advance_recovery_stage`, `record_collateral_sale`, `pay_surplus` | FR-17 | |
| `request_write_off(loan_id, reason)` | FR-19 | CEO approval + board reference |
| `create_expense(jsonb)`, `settle_expense(id, account_id)` | FR-22 | limit routing |
| `request_manual_journal(jsonb)` | FR-21 | approval, then `post_journal` |
| `submit_day_close(...)`, `reopen_day_close(id, reason)` | FR-23 | approval creates lock; reopen removes it |
| `issue_document(kind, entity_id)` | FR-25 | allocates number and verify token, returns row for the PDF route |
| `loan_outstanding_as_of(loan_id, date)` | FR-12 | helper used by accrual; read-only |
| `import_opening_balance(jsonb)` | FR-27 | only before `go_live_date`; posts R12 |
| `admin_create_user(...)` | FR-01 | **server action using service role**, not an RPC |

Error codes returned as `RAISE EXCEPTION 'CODE: message'`; the UI maps codes to friendly text: `FORBIDDEN`, `SELF_APPROVAL`, `OVERPAYMENT`, `INSUFFICIENT_FUNDS`, `REMITTANCE_MISMATCH`, `DATE_NOT_ALLOWED`, `JOURNAL_UNBALANCED`, `PERIOD_LOCKED`, `COLLATERAL_REQUIRED`, `COLLATERAL_ALREADY_PLEDGED`, `DUPLICATE_CUSTOMER`, `INVALID_STATE`, `REFERENCE_REQUIRED`, `IMMUTABLE_RECORD`, `DUPLICATE_REQUEST` (idempotency replay returns the original, not an error).

---

## 9. Screens and routes

Layout: left nav on desktop, bottom tab bar on phones. Top bar: branch, user, role badge, approvals bell (count of pending items you can decide). Tables: server-side search, sort, pagination (25/page). Forms: inline validation, disabled submit while pending, clear error from the code table above.

| Route | Roles | Content |
| --- | --- | --- |
| `/login` | all | Email + password; no sign-up link |
| `/dashboard` | all | **Officer:** my due today, my overdue, my pending remittances. **Cashier:** today's collections, cash to close, unconfirmed field cash. **Manager/CEO:** portfolio outstanding, PAR buckets (overdue 1–7, 8–30, 30+), collections today, approvals waiting, recovery cases. **Accountant:** cash by branch, income this month, expenses awaiting |
| `/customers` | all | List/search (name, phone, ID, code); filters (status, branch, officer); outstanding column |
| `/customers/new` | officer, manager | Individual/business form; photo and ID upload; duplicate warning |
| `/customers/[id]` | all | Profile; loans; collateral; documents; balance; statement button; "Request edit" |
| `/loans` | all | List with status filters; per-row balance and days overdue |
| `/loans/new` | officer, manager | Select customer → product → principal/term (live preview from `preview_loan_terms`) → collateral (pick or add) → guarantors → submit |
| `/loans/[id]` | all | Summary (principal, interest, penalties, paid, outstanding), schedule of events (disbursed, payments, penalties, extension), collateral, guarantors, approvals, actions by role/status (Approve, Disburse, Receive payment, Extend, Open recovery, Request write-off), documents |
| `/payments/new?loan=` | cashier, manager | Amount, method, reference, date; shows allocation preview (penalty → interest → principal); on save opens receipt |
| `/payments` | cashier, manager, accountant, ceo | Receipt list with filters; void request |
| `/receipts/[id]` | staff | Print view (A5 and 80mm thermal CSS) + PDF |
| `/field` | loan_officer | Mobile list: my customers due today/overdue, big "Collect" button, call and WhatsApp buttons, pending remittance list |
| `/field/collect/[loanId]` | loan_officer | Minimal payment form with idempotency key generated on open |
| `/remittance` | cashier, manager | Pending field collections grouped by officer; confirm selected |
| `/due` | all | Tabs: due today, due 7 days, overdue; WhatsApp reminder button per row; export CSV |
| `/collateral` | all | Register with search by any identifier; filters by status/location |
| `/collateral/new` | officer, cashier, manager | Type, description, identifiers, value, photos, documents, location |
| `/collateral/[id]` | all | Details, linked loan, custody log, add event, release (when allowed) |
| `/recovery` | manager, ceo | Eligible loans (30+ days), open cases by stage, actions |
| `/recovery/[caseId]` | manager, ceo | Stage timeline, notes, attachments, record sale, pay surplus |
| `/approvals` | manager, ceo (view own requests for others) | Inbox: type, summary, requester, age, Approve/Reject with note |
| `/day-close` | cashier, manager, ceo | Submit counts; manager review with variance |
| `/expenses` | manager, accountant | List, create, approve, settle |
| `/payees` | manager, accountant | Simple list and form |
| `/reports/*` | per 4 | See 10.2 |
| `/ledger` | accountant, manager, ceo | Journals list, drill to lines, manual journal request |
| `/settings` | admin | Users, branches, products, rule settings, company header, go-live date |
| `/audit` | manager, ceo, admin | Filterable by user, entity, date; read-only |
| `/verify/[token]` | public | Confirms a receipt/statement is genuine: number, date, amount, masked customer name; no other data |

Every list has an empty state and a loading state. Every destructive-looking action (void, write-off, reject) shows a confirmation dialog with a mandatory reason.

---

## 10. Documents and reports

### 10.1 PDF documents (`/api/pdf/[kind]/[id]`)

All carry the company header from `settings.company`, a unique number, generation timestamp, preparer name, and a QR code to `/verify/<token>` (token = signed random value stored with the document row).

| Kind | Size | Content |
| --- | --- | --- |
| `receipt` | A5 and 80mm | Receipt no., date, customer, loan no., amount paid, method and reference, allocation (penalty/interest/principal), balance after, received by, branch, VOID stamp if voided |
| `statement` | A4 | Customer or loan; period; opening balance; every debit and credit with running balance; totals; outstanding by component; next due date |
| `loan_agreement` | A4 | Parties, amount, interest, term, due date, penalty terms in plain language, collateral list, guarantors, signature blocks (printed and signed by hand) |
| `demand_notice` | A4 | Amount due, days overdue, penalties to date, deadline, warning of collateral disposal per policy |
| `collateral_receipt` | A4 | Item details, identifiers, photos, value, custody statement, signatures |
| `collateral_release` | A4 | Item, loan closed confirmation, release date, signatures |

Legal wording on `loan_agreement`, `demand_notice` is **placeholder text** stored in `settings.templates` and must be reviewed by MSI's lawyer; mark placeholders visibly in seed text.

### 10.2 Reports (`/reports/...`; date-range and branch filters; CSV export; print view)

| Report | Source and logic |
| --- | --- |
| Daily collections | Payments with `received_on` in range, `status='posted'`, grouped by branch, officer, method; field collections show remittance status; totals |
| Daily payments (money out) | Disbursements (R1), expenses paid, payee payments, surplus payouts; grouped by day and type |
| Due loans | `due_list` buckets `due_today`, `due_7d` with outstanding and contact phone |
| Overdue balances | Loans with `days_overdue > 0`: principal/interest/penalty outstanding, days, penalties charged, next penalty date, recovery eligibility; PAR 1–7, 8–30, 30+ summary and portfolio total |
| Profit and loss | Income and expense accounts for the period, accrual basis; subtotals; net profit |
| Balance sheet | Assets, liabilities, equity as at a date; equity includes capital + computed retained earnings; check line `Assets = Liabilities + Equity` |
| Trial balance | Every account's debit and credit totals; must balance (shown with a green/red check) |
| Cash position | Per branch cash account, bank, MoMo, field cash |
| Collateral register | All items with status, location, linked loan, estimated value |

Report queries are SQL views/functions; the page only renders them. A report that does not reconcile (balance sheet check or trial balance) shows a red banner and must be covered by tests (T-26, T-27).

### 10.3 WhatsApp reminder (no API)
Link: `https://wa.me/<digits>?text=<url-encoded>`. Phone normalisation: strip non-digits; if it starts with `0`, replace with `231`; if it already starts with `231`, keep.
Template (editable in `settings.templates.reminder`):
`Dear {name}, your loan {loan_no} of {amount} is due on {due_date}. Outstanding: {outstanding}. Please pay at {branch} or call {branch_phone}. Thank you. – {company}`
Overdue variant adds days overdue and penalties to date. The officer taps the link; WhatsApp opens with the text prefilled; the officer presses send. Log each tap as an audit event `reminder_opened` (no delivery guarantee).

---

## 11. Non-functional requirements

- **Security:** HTTPS only; password min 10 chars; session max 12 hours; login rate limit (Supabase defaults + 5 failures → 15-minute delay); no secrets in client bundle; service role used only in server code paths listed in section 8; signed URLs expire in 10 minutes; file types restricted (jpg, png, webp, pdf; 10 MB max).
- **Audit:** every RPC writes `audit_log`; the audit page cannot filter out entries; no delete anywhere in the UI or API.
- **Backups:** Supabase daily backups (Pro). Weekly logical export (`pg_dump`) script `scripts/backup.sh` documented in `docs/OPERATIONS.md` for off-platform copy. Restore tested once before go-live.
- **Performance:** all list pages < 1 s with 5,000 loans; PDF generation < 3 s. (Volume is tiny; do not add caching layers.)
- **Accessibility and UX:** 44px minimum touch targets on `/field`; contrast AA; keyboard operable forms; no horizontal scroll at 360px.
- **Observability:** server action errors logged with code and user id (no PII in logs); `/api/health` returns DB reachability and last accrual run date.
- **Branding (MSI):** logo file `public/brand/msi-logo.png` (also uploaded to Storage `branding/` and referenced by `settings.company.logo_path`). Seed `settings.company` = {name: "Method Solutions Inc.", short_name: "MSI", address: "[pending]", phone: "[pending]", email: "[pending]", logo_path, receipt_footer: "Thank you for your payment."}. Pending fields print as blank, never as the placeholder text.
- **Theming:** design tokens in `tailwind.config` from the MSI logo: `primary` #32207E (MSI purple; buttons, links, active nav), `primary-dark` #241660 (sidebar, mobile header), `primary-tint` #E6E1F7, `accent` #FFE103 (MSI yellow; count badges and highlights only, always with #241660 text, never as text on white). Status colours are separate and fixed: overdue orange #C2410C / #FFEDD5, active green #166534 / #DCFCE7, due blue #1E3A8A / #DBEAFE, recovery #0F172A. The logo always sits on a white tile; do not place it directly on purple. Mock-ups: `docs/mockups/` (index and tokens in its README) and https://claude.ai/artifact/9Cb26wkner8VdRy86Z6FuT. Light mode only in MVP.
- **Motion:** purposeful and fast: 150–250 ms, ease-out; page and tab transitions, dialog/sheet/toast enter and exit, skeleton loaders, dashboard number count-up, list item add/remove. No scroll-jacking, parallax or decorative scroll effects. Every animation respects `prefers-reduced-motion`. Never animate money values on receipts, forms or tables.
- **Standards baseline:** WCAG 2.2 AA; OWASP ASVS 4.0 level 2 for authentication, access control, input validation, logging and session management; OWASP Top 10 reviewed at each audit gate; security headers (CSP, HSTS, frame-ancestors none, referrer policy); no PII or secrets in logs; dependency audit in CI.
- **Browser support:** current Chrome and Safari on Android and iOS, and desktop Chrome/Edge.

---

## 12. Test vectors and acceptance tests

All amounts in cents unless shown with `$`. Reference implementation: `tools/vectors.py`. Tests live in `supabase/tests/` (SQL via `supabase test db` or Vitest calling RPCs against local Supabase). A milestone is not done until its tests pass.

### 12.1 Money rules

| ID | Scenario | Expected |
| --- | --- | --- |
| T-01 | Interest: principal 100000, 2000 bps, 1 month | interest 20000; total due 120000 |
| T-02 | Due date: disbursed 2026-01-05 +1 month; disbursed 2026-01-31 +1 month | 2026-02-05; 2026-02-28 |
| T-03 | Penalty, base `outstanding_total`, total due 120000, no payments, 4 periods | charges 24000, 28800, 34560, 41472; owed 144000, 172800, 207360, 248832 |
| T-04 | Penalty not charged before day 7; charged on day 7; second on day 14 | exact day boundaries (`>= k*7`) |
| T-05 | Penalty stops after period 4 (day 35+ gives no 5th charge) | no new event rows |
| T-06 | Partial payment 50000 after week-1 penalty (owed 144000: pen 24000, int 20000, prin 100000) | allocations: penalty 24000, interest 20000, principal 6000; remaining principal 94000; next penalty = pct(94000, 2000) = 18800; owed then 112800 |
| T-07 | Rerun `run_daily_accruals` for the same date twice | no duplicate penalties (unique key) |
| T-08 | Penalty base `original_due`, same loan | charges 24000 × 4; owed 144000, 168000, 192000, 216000 |
| T-09 | Rounding: pct(3333, 2000); pct(25, 2000) | 667; 5 |
| T-10 | Payment greater than outstanding | `OVERPAYMENT`, nothing posted |
| T-11 | Mobile money payment without reference | `REFERENCE_REQUIRED` |
| T-12 | Same idempotency key sent twice | one payment, one receipt, same receipt returned |
| T-13 | Extension on principal 100000 outstanding, +1 month | extra interest 20000; due date +1 month; `due_date_version` 2; penalties restart at period 1 |
| T-14 | Collateral sale 200000 vs owed 248832 (penalty 128832, interest 20000, principal 100000) | applied: penalty 128832, interest 20000, principal 51168; remaining principal 48832; loan stays open |
| T-15 | Collateral sale 300000 same loan | applied 128832 / 20000 / 100000; surplus 51168 to account 2100; loan closes |
| T-16 | Write-off of remaining 48832 principal (from T-14) | Dr 5050 48832, Cr 1100 48832; status `written_off`; balance 0 |
| T-33 | Loan due 2026-02-05, principal 100000, interest 20000. A payment of 50000 is posted on 2026-02-14. **Run A:** job runs every day. **Run B:** job first runs on 2026-02-19 (after the payment). | **Penalty amounts and `charged_on` are identical in both runs:** k=1 24000 on 2026-02-12 (base 120000, payment not yet posted), k=2 18800 on 2026-02-19 (base 94000). **Total outstanding is identical:** 112800. Component split may differ because the payment is allocated against what existed when it was posted: Run A = principal 94000, penalty 18800; Run B = principal 70000, penalty 42800 |

### 12.2 Controls and ledger

| ID | Scenario | Expected |
| --- | --- | --- |
| T-17 | Loan creator tries to approve own loan | `SELF_APPROVAL` |
| T-18 | Loan 250000 submitted | `required_role = ceo`; manager approval attempt gives `FORBIDDEN` |
| T-19 | Loan 200000 submitted | `required_role = manager` |
| T-20 | Insert unbalanced journal | `JOURNAL_UNBALANCED` at commit |
| T-21 | Update or delete a posted journal/line/audit row (as any role, including service role) | `IMMUTABLE_RECORD` |
| T-22 | Post into a locked date | `PERIOD_LOCKED` |
| T-23 | Disburse without collateral when required | `COLLATERAL_REQUIRED` |
| T-24 | Pledge a collateral item already pledged to an active loan | `COLLATERAL_ALREADY_PLEDGED` |
| T-25 | Void payment approved by its requester | `SELF_APPROVAL`; after valid approval, reversal journal exists, balances restored, receipt marked VOID |
| T-26 | After a full scenario run (disburse, payments, penalties, expense, sale, write-off) trial balance debits = credits | equal |
| T-27 | Same run: assets = liabilities + equity + computed retained earnings | equal |
| T-28 | Field payment then remittance | before confirmation: 1015 has balance; after: 1010-BR has it, 1015 zero |
| T-29 | Customer edit by loan officer | no change until approved; audit row has before/after after approval |
| T-30 | RLS: cashier attempts direct `insert` into `payments` via the REST API | denied |
| T-31 | RLS: loan_officer reads `/ledger` data | denied |
| T-32 | Duplicate customer phone | `DUPLICATE_CUSTOMER` unless manager override |
| T-34 | Close a day (approved), then post a payment dated that day; manager reopens; payment succeeds; new close required | `PERIOD_LOCKED`, then success; audit row for reopen |
| T-35 | Disburse 500000 from a cash account holding 300000 | `INSUFFICIENT_FUNDS` |
| T-36 | Confirm remittance with counted total different from the sum of selected payments | `REMITTANCE_MISMATCH`, nothing posted |
| T-37 | After go-live, accountant posts a payment dated yesterday | `DATE_NOT_ALLOWED` |

### 12.3 End-to-end smoke (Playwright)
1. Officer logs in on a 390px viewport, creates a customer, creates a loan draft with collateral, submits.
2. Manager approves from `/approvals`. Cashier disburses. Receipt for disbursement not required; loan shows active and due date.
3. Cashier receives a partial payment; receipt PDF opens; QR verify page shows the receipt.
4. Clock advanced (test hook calls `run_daily_accruals(as_of)`) to day 8: loan overdue, one penalty visible on statement.
5. Manager opens recovery after day 30, records sale, loan closes, collateral status `sold`.
6. Reports: trial balance balanced; P&L shows interest, penalty income.

---

## 13. Milestones (build in order; stop at each gate)

Each milestone ends with: tests green, `pnpm build` clean, screenshots of new screens at 390px and 1280px, a short changelog, then **wait for approval**.

| M | Name | Covers | Deliverables | Acceptance |
| --- | --- | --- | --- | --- |
| M0 | Foundation | FR-01, FR-02, FR-26 | Repo, Supabase project config, migrations for `branches`, `profiles`, `settings`, `audit_log`, `document_sequences`; auth, role guard, layout (nav, top bar) with MSI logo and tokens, `settings.company` seeded with MSI values, settings screen, user creation (admin) | Login works per role; unauthorised routes redirect; audit rows on settings change |
| M1 | Ledger core | FR-21 | `accounts` seed, `journals`, `journal_lines`, triggers (6.3), `post_journal`, `next_number`, `period_locks`, ledger screen (read), manual journal request skeleton | T-20, T-21, T-22 pass |
| M2 | Customers | FR-03, FR-04, FR-05, FR-28 | Customer CRUD per 5.11, attachments, `approval_requests` + inbox, `decide_approval` dispatcher, guarantor model | T-29, T-32 pass; inbox shows pending edit and applies it |
| M3 | Loans | FR-06, FR-07, FR-08, FR-09 | Products, draft/submit/approve/disburse, preview, loan detail, `loan_balances` view, agreement PDF | T-01, T-02, T-17, T-18, T-19, T-23, T-35 pass |
| M4 | Payments | FR-10, FR-11, FR-20 | Receive/field payment, allocation, receipts (screen + PDF), remittance, void flow | T-06 (allocation part), T-10, T-11, T-12, T-25, T-28, T-36, T-37 pass |
| M5 | Accruals and due lists | FR-12, FR-13, FR-18 | `run_daily_accruals`, `pg_cron`, manual run button, due/overdue lists, WhatsApp links, extension | T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-13, T-33 pass |
| M6 | Collateral and recovery | FR-15, FR-16, FR-17, FR-19 | Collateral register and custody log, pledge rules, recovery cases, sale, surplus, write-off | T-14, T-15, T-16, T-24 pass |
| M7 | Statements and documents | FR-14, FR-25 | Statement PDF, demand notice, collateral receipt/release, QR verification page | Statement running balance equals ledger for every seeded loan |
| M8 | Money-out, day close, reports | FR-22, FR-23, FR-24 | Payees, expenses, settlement, day close and lock, all reports in 10.2 with CSV | T-26, T-27, T-34 pass; every report matches `docs/DEMO_DATA.md` with `--as-of 2026-02-12` |
| M9 | Migration, dashboards, hardening | FR-27, FR-29 | Opening balance wizard, back-dated entry before go-live, role dashboards, RLS review, e2e smoke, `docs/OPERATIONS.md`, demo seed | T-30, T-31 and section 12.3 pass; no table without RLS; Lighthouse accessibility ≥ 90 on `/field` |

Gate checklist after M9 (client pilot): enter real old records; run in parallel with Excel for the agreed period; compare outstanding per loan; sign off assumptions A-01..A-20.

---

## 14. Seed data

`seed_core.sql` (always): chart of accounts (6.1), cash accounts per branch, default product "Standard 1-month, 20% flat", default settings (2.3), document templates (placeholder legal text clearly marked "REVIEW WITH LAWYER").

Demo seed (demo environment only, `pnpm seed:demo [--as-of YYYY-MM-DD]`): exactly the dataset in `docs/DEMO_DATA.md`, which is also the data behind every mock-up in `docs/mockups/`. It is built by calling the RPCs in date order (never by inserting journals), is reproducible, prints generated passwords once and never commits them. With `--as-of 2026-02-12`, every mock-up screen must show the same figures. The void flow, draft and approved states are covered by tests, not by the seed. Demo data must match T-01..T-16 numbers where applicable.

---

## 15. Phase 2 and 3 hooks (so the schema does not block them)

- Payroll: add `staff`, `payroll_runs`, `payroll_lines`, configurable tax/NASSCORP tables; postings through `post_journal` (Dr 5000, Cr cash, Cr statutory payables).
- Lender/investor tracking: `lenders`, `lender_loans` with interest accrual to 2000-series liabilities.
- Offline field mode: service worker + IndexedDB queue replaying `record_field_payment` with the stored idempotency key.
- Multi-currency: enable `currency` choice per loan; use `fx_rate_micros`; reports per currency and a base-currency view.
- Mobile money automation, WhatsApp Business API, CBL report pack, MFA for manager/CEO/admin, group lending.

---

## 16. Audit record (v1.0)

Scripted checks (`tools/audit.py`) and a manual logic review were run before release.

| Check | Result |
| --- | --- |
| Every FR (29) is covered by a milestone | Pass |
| Every test (37) is referenced by a milestone; every milestone test exists | Pass |
| Every assumption reference (A-01..A-20) is defined | Pass |
| Every internal "section N" reference resolves | Pass |
| Money vectors T-01..T-16 and T-33 reproduced by `tools/vectors.py` (integer arithmetic) | Pass |

Defects found in review and fixed in this version:

1. **Late accrual runs gave different penalties** than daily runs. Fixed with the as-of determinism rule (5.2), `loan_outstanding_as_of`, `charged_on` = charge date, and test T-33.
2. **QR verification had no backing table.** Added `issued_documents` and `issue_document` (FR-25).
3. **Day close locked the day for good**, blocking a payment that arrives after the close. Added `reopen_day_close` and made the close per branch per day, not per cashier (A-18, 5.10, T-34).
4. **Receiving accounts were undefined.** Method now maps to cash, bank or mobile-money accounts (5.4).
5. **Back-dating was ungoverned.** Dates other than today allowed only for admin/accountant before go-live (`DATE_NOT_ALLOWED`, T-37).
6. **Race conditions** between payments and the accrual job. All money functions lock the loan row first (5.4, 5.5).
7. **Field cash could vanish at handover.** Remittance now requires a counted total that matches (`REMITTANCE_MISMATCH`, T-36).
8. **Disbursement could exceed available cash.** Added `INSUFFICIENT_FUNDS` check (T-35).
9. **Function execution rights** were unspecified. Revoke from public and grant to authenticated, with role checks inside each function (6.4).
10. **Invoices** (requested originally) are not part of lending; replaced by agreement, statement and demand notice, stated in 1.3.

Known risks that the spec cannot remove (client decisions): the compounding penalty (A-06) more than doubles a month of default debt and must be checked against the pending CBL licence terms and by a lawyer; legal wording in agreements and notices is placeholder text.
