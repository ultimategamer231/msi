# Phase M9: Migration, dashboards, hardening — ready for review

Date: 2026-11-09 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1

Pushed. The GitHub API still answers 404 for the repository, so this session cannot see PR #1 or CI. Every check below was run locally.

## Acceptance (SPEC 13, M9)

| Check | Evidence | Result |
| --- | --- | --- |
| T-30: a cashier's direct insert into payments is denied | `13_money_and_balances` | **Pass** |
| T-31: a loan officer cannot read ledger data | `05_ledger_core`, `07_trial_balance` | **Pass** |
| SPEC 12.3 smoke: apply at 390 px → approve → pay out → partial payment, receipt PDF, QR check → day 8 overdue with one penalty on the statement → recovery after day 30, sale, loan closed, item sold → trial balance balanced, P&L shows interest and penalty income | `pnpm test:smoke` (`tests/smoke`), also in CI | **Pass** |
| No table without RLS | `01_schema_rls` (also covers the new `login_failures` table) | **Pass** |
| Lighthouse accessibility ≥ 90 on `/field` | 100 (test data), 100 (demo data, Emmanuel Tarpeh) | **Pass** |

## Blocks completed
- **M9.1 Opening balances (FR-27):**
  - a Ledger → Opening balances tab for the admin or accountant, available only before go-live;
  - balance-sheet accounts only; the difference goes to 3900 (R12);
  - old loans are entered as loans with back-dated payout and payments (A-19, already in place).
- **M9.2 Role dashboards (FR-29; mock-up 05):**
  - loan officer: due today, overdue, field cash to hand over, and their own list;
  - cashier: collected today, cash to close, field cash not yet confirmed;
  - manager and CEO: the mock-up 05 layout;
  - accountant: cash by account, income this month, expenses waiting, owed to payees;
  - admin: go-live date, last daily job, number of users.
- **M9.3 Hardening (SPEC 11):**
  - Content-Security-Policy and the other security headers;
  - 5 failed sign-ins lock an account for 15 minutes;
  - `/api/health`;
  - `scripts/backup.sh` (weekly pg_dump);
  - `docs/OPERATIONS.md` (deploying, going live, daily routine, backups and restore test, security, incidents, demo).
- **M9.4 Smoke and accessibility:** the SPEC 12.3 smoke run (`pnpm test:smoke`, added to CI) and a Lighthouse run on `/field`.
- **M9.5:** full checks, demo check, screenshots and this report.

## Test totals (local, clean database)
- Unit: 328 passed
- Database: 592 passed; `supabase db lint` and `db advisors` clean
- E2E: 201 passed at 390 and 1280 px; smoke: passed
- Demo payment check (`pnpm test:demo` on a fresh `--as-of 2026-02-12` seed): passed
- Lint, format, typecheck, build: clean

## Mock-up comparison
Screenshots are in `docs/screenshots/m9/`: `compare-05.png` shows the manager dashboard next to mock-up 05, and there is a dashboard for each role at 390 and 1280 px.

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 05 | "Day close, Branch 2, 11 Feb: counted cash is $10.00 short. Needs your review." | "Day close, Branch 2, 11 Feb: not closed yet." | DEMO_DATA says that day is not closed yet and lists no day close among the approvals waiting (the inbox count is 3 in both). DEMO_DATA ranks above the mock-ups. Once the cashier submits the count, the mock-up's text appears |
| 05 | Search box in the top bar | Not built | Search is on each list page; a global search is not in FR-01..FR-29 |
| 05 | "Court filing is the next step" | "Court filed is the next step" | Uses the stage names from the recovery screens |

## Security review (phase end)
- **Sign-in lockout:**
  - it counts failures per email hash, and only the service role can reach it, from the sign-in action;
  - it answers the same way whether or not an account exists;
  - if it cannot run, sign-in still works and Supabase's per-IP limits stay in force (a deliberate choice).
- **CSP:**
  - inline scripts are allowed, because Partial Prerendering cannot use per-request nonces (Next.js guide);
  - everything else is limited to this app: no `eval` in production, no plugins, no framing, forms only to this app;
  - images may also come from the Supabase host.
- **Opening balances:** admin or accountant only, before go-live only, balance-sheet accounts only, and audited.
- **`/api/health`:** public, but it shows only whether the database answers and two dates.
- **Service role:** now also used for the sign-in lockout. It is granted only `login_guard` and has no table privileges.

## Issues found and fixed this phase
- A strict CSP (no inline scripts) stopped pages from working; it was replaced by the policy described above.
- The dashboard counted approval age in hours, so a request from yesterday evening showed as "from today"; it now counts business days.
- The test ids of the manual journal form changed when it became reusable for opening balances; the tests were updated.

## Decisions taken this phase
See `docs/DECISIONS.md` (M9.1 to M9.3):
- opening balance rules;
- dashboard contents per role, including the "latest collection day" card;
- the CSP choice;
- the lockout rules;
- what `/api/health` shows.

## Needs your decision or action
1. **Hosted setup (SPEC 3.1: "cloud Supabase + Vercel staging and production set up at the end of M9").** This needs your accounts:
   - **Supabase:** an organisation on the Pro plan (for daily backups), with two projects: `loandesk-staging` and `loandesk-prod`, plus `loandesk-demo` if you want a demo site.
   - **Vercel:** a project linked to the repository. Vercel deploys from GitHub, so your GitHub account must be working again first. Without GitHub, deploying from the Vercel command line needs a Vercel token.
   - **From you:** once these exist, invite me or share the project references, and I will apply the migrations, set the variables (`docs/OPERATIONS.md` section 2) and check `/api/health`. Never paste keys into chat; add them in the Vercel and Supabase dashboards.
2. **Client pilot gate (SPEC 13, after M9):**
   - MSI enters real old records: opening balances, plus old loans with back-dated payouts and payments;
   - LoanDesk runs alongside Excel for the agreed period, comparing what is outstanding per loan;
   - MSI signs off assumptions A-01..A-20 (`docs/ASSUMPTIONS.md`).
3. **Earlier items still open:**
   - accountant receipt uploads (M8);
   - who fills in the day-close count (M8, mock-up 14);
   - open questions B-04, B-05, B-07, B-08, B-09, B-10, B-12, B-15, B-16, B-18 and B-19.
