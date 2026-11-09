# Phase M8: Money-out, day close, reports — ready for review

Date: 2026-11-09 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1

Pushed. The GitHub API still answers 404 for the repository, so this session cannot see PR #1 or CI. Every check below was run locally.

## Acceptance (SPEC 13, M8)

| Test | Evidence | Result |
| --- | --- | --- |
| T-26 trial balance after a full run (payouts, payments, penalties, expense, sale, write-off) | `32_reports`; demo data: debits = credits $30,839.28 | **Pass** |
| T-27 assets = liabilities + equity with computed retained earnings | `32_reports`; demo data: balanced, retained earnings = profit to date | **Pass** |
| T-34 close, late payment refused, reopen, payment accepted, new close | `31_day_close` (PERIOD_LOCKED, then success, reopen audited) | **Pass** |
| Every report matches DEMO_DATA (`--as-of 2026-02-12`) | Checked on the seeded database (table below) | **Pass** |

| DEMO_DATA figure | Report | Built |
| --- | --- | --- |
| Opening cash A−1: BR1 $5,000.00, BR2 $2,000.00, BR3 $3,000.00 | Day close, cash position | Same |
| Day close BR2 A−1: 2,000 + 350 − 500 − 45 = **$1,805.00**; field cash $350.00 kept out | Day close (mock-up 14) | Same |
| Collected A−1: $700.00 in 3 receipts, $350.00 still with the officer | Daily collections | Same |
| Overdue $6,209.28 (61.1% of $10,169.28); 1–7 $1,440.00, 8–30 $1,036.80, 31+ $3,732.48; penalties $2,609.28; recovery $3,732.48 | Overdue balances (mock-up 15) | Same |
| Expense waiting: court filing fee $240.00, Branch 3 cash, for a manager | Approvals inbox | Same (EXP-BR3-000001) |

## Blocks completed
- **M8.1** Payees and expenses:
  - expenses up to the $100.00 limit are posted at once; above it they wait for a manager who did not record them;
  - an expense can be paid now (R9) or taken on credit (R9b) and settled later (R9c);
  - what each payee is owed comes from the ledger.
- **M8.2** `/expenses` (form with a receipt file, status tabs, Pay payee), `/payees`, and an expense card in the inbox.
- **M8.3** Day close:
  - expected cash comes from the ledger;
  - the cashier counts the drawer; a variance needs a reason;
  - the manager approves, which locks the day; a manager can reopen it with a reason;
  - `/day-close` (mock-up 14) and a day-close card in the inbox.
- **M8.4** Report functions for collections, money out, overdue, profit and loss, balance sheet, trial balance and cash position.
- **M8.5** `/reports` with nine reports. Each has filters, Export CSV, Print / PDF, and a red banner when the books do not balance.
- **M8.6** Demo seed changes:
  - the $45.00 expense on A−1 and the $240.00 court fee waiting for approval;
  - opening capital set so the drawers match DEMO_DATA.

  Also in this block: screenshots and this report.

## Test totals (local, clean database)
- Unit: 328 passed
- Database: 573 passed; `supabase db lint` and `db advisors` clean
- E2E: 181 passed at 390 and 1280 px, with axe on the new screens. `field.spec` needed one retry; that test is from M4 and its failure is not caused by M8.
- Demo payment check (`pnpm test:demo`): passed
- Lint, typecheck, build: clean

## Mock-up comparison
Screenshots are in `docs/screenshots/m8/`; `compare-14.png` and `compare-15.png` place the build next to the mock-up.

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 14 | A manager fills in the count and clicks Close day | The cashier counts and closes. The manager sees the count with Approve/Reject, and later Reopen | SPEC 4: only the cashier submits a day close; the manager approves |
| 14 | "Disbursement, LN-BR2-00010"; "final repayment" | "Payout, LN-BR2-00010"; "repayment" | Same figures. Whether a payment was the final one is not shown in the cash list |
| 14 | Payout at 11:05 | 14:00 | That is the time the demo seed paid the loan out |
| 15 | Detail table | Adds a "Next penalty" column and the full collateral description | SPEC 10.2 lists the next penalty date |
| — | No mock-up for expenses, payees or the other reports | Built in the same style | |

## Security review (phase end)
- **Roles enforced in SQL:**
  - expenses: manager or accountant; approval by a manager who did not record it, or the CEO;
  - day close: submitted by the cashier of that branch only; approval and reopen by a manager or the CEO, with a reason;
  - reports: CEO, manager, accountant or admin. The same rule guards the CSV route.
- **Money rules:**
  - money is posted only through `post_journal`; an expense is never posted before its approval;
  - paying from branch cash checks what is in the drawer;
  - 5050 Bad debts can be used only through a write-off.
- **CSV safety:** a value that starts with `= + - @` is prefixed with an apostrophe, so spreadsheets do not run it as a formula.
- **Permission change:** accountants may now upload expense receipts, to their own storage folder only. This follows from SPEC 4 (the accountant records expenses), but it is a permission change, so please confirm it.

## Issues found and fixed this phase
- Accountants could not upload receipts because the storage rule did not include them (fixed).
- When a report table had rows, its total label landed in a date column and broke the CSV export (fixed).
- The demo seed pays every loan out before it posts the receipts dated earlier, so the drawer check is now paused while the seed fills in history.
- The screenshot script split `--compare` URLs at a second `=` (fixed).
- Reopening the only closed day locked the day before it; now the lock is removed.

## Decisions taken this phase
See `docs/DECISIONS.md` (M8.1 to M8.5):
- expense limit routing and posting date;
- payee balances come from the ledger;
- expected cash, and when a reason is required;
- how the lock moves on reopen;
- the branch filter applies to some reports only;
- one shared shape for report pages and CSV.

## Needs your decision
- **Accountant receipt uploads** (above): confirm.
- **Mock-up 14:** who fills in the count. SPEC 4 says the cashier, so I built it that way; the mock-up shows the manager.
- **Open questions** still on defaults: B-04, B-05 (M6); B-07, B-15, B-16, B-18 (M5); B-08, B-09, B-10, B-12, B-19 (M4).

## Next: M9 — waiting for your approval
- Opening balance wizard and back-dated entries before go-live (FR-27)
- Role dashboards, RLS review, e2e smoke (SPEC 12.3), `docs/OPERATIONS.md`
- T-30, T-31; Lighthouse accessibility ≥ 90 on `/field`
- Hosted setup on Vercel and Supabase (needs a working GitHub account)
