# Phase M5: Accruals and due lists — ready for review

Date: 2026-11-07 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (also carries M0–M4)

**Not pushed yet.** GitHub refused this session's access (HTTP 403 on fetch and push) from the start of M5. All M5 commits are on the local branch and go up with the next push once GitHub access is reconnected (https://claude.ai/connect-github). CI has not run on them; every check below was run locally.

## Acceptance (SPEC 13, M5)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-03 | Penalties on the outstanding total, 4 periods | `21_accruals`: 24000, 28800, 34560, 41472; owes 248832 | **Pass** |
| T-04 | Day boundaries | `21_accruals`: nothing on day 6, first penalty on day 7 (`>= k*7`) | **Pass** |
| T-05 | No 5th penalty | `21_accruals`: 4 events after day 35 | **Pass** |
| T-06 | 50000 after the week-1 penalty | `17_payments` (allocation) and `21_accruals`: penalty 24000, interest 20000, principal 6000; next penalty 18800; owes 112800 | **Pass** |
| T-07 | Rerun the same day | `21_accruals`: second run posts nothing, one event | **Pass** |
| T-08 | Base `original_due` | `21_accruals`: 24000 four times; owes 216000 | **Pass** |
| T-09 | Rounding | `13_money_and_balances` (M3): 667 and 5 | **Pass** |
| T-13 | Extension of 100000 by 1 month | `25_extensions`: 20000 extra interest, due date +1 month, version 2, penalties restart at period 1 (28000 on the new term) | **Pass** |
| T-33 | Daily run vs late run | `21_accruals` (run A) and `22_accruals_late` (run B): same amounts and charge dates, 112800 owed; split as SPEC states | **Pass** |
| T-33b (B-15) | Job first runs three periods late | `22_accruals_late`: 24000, 18800, 22560, owes 135360, as daily; oracle added to `tools/vectors.py` | **Pass** |

## Blocks completed
- **M5.1** `loan_penalty_events`, `accrual_runs`, `loan_outstanding_as_of` (B-15 rule), and `run_daily_accruals` (manager or admin, today or earlier). The job marks loans overdue, posts penalties (R4) by the late-run rule, flags recovery eligibility, and logs and audits each run. Balances gain the last payment and next penalty dates.
- **M5.2** The `pg_cron` job runs at 01:00 UTC through an entry point no client can call. The loan page shows "1 of 4 weekly charges", the next penalty with its amount (`loan_next_penalty`), and penalty rows in the activity.
- **M5.3** The `due_list` view, the `due.upcoming_days` setting, and `/due` (mock-up 11).
  - WhatsApp reminders (`/api/reminder/<loan>`, audit `loan.reminder_opened`) on `/due` and `/field`.
  - Manual run panel showing the last runs.
- **M5.4** `request_extension` and its approval (R5): Extend on the loan page and an inbox card (mock-up 12).
- **M5.5** Demo seed, demo payment check, screenshots, this report.
  - The seed runs the nightly job for each past day, then that day's payments, plus the pending extension.
  - The check is `pnpm test:demo`.

## Test totals (local, clean database)
- Unit: 322 passed
- Database: 460 passed; `supabase db lint` and `supabase db advisors` clean at warning level
- E2E: 160 passed at 390 and 1280 px, with axe on every new screen
- Demo payment check: passed. On a fresh demo seed it takes Mariama from $1,440.00 to $940.00 and issues RCT-BR2-000123.
- Lint, typecheck and build: clean
- CI: not run (push blocked, see above)

## Mock-up comparison
Screenshots are in `docs/screenshots/m5/`: due list, Mariama's loan, approvals and field list, at 390 and 1280 px, on demo data at 12 Feb 2026 09:10.

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 11 | "Due in 14 days" card; Fatu (due in 8 days) listed | "Due in 7 days" with $0.00; Fatu not listed | B-07 default: 7 days, a setting in Settings |
| 11 | Mohammed in recovery (card $3,732.48), not in the list | Listed as 38 days overdue; recovery card $0.00 | Recovery cases come with M6; the seed opens his case then |
| 11 | Call per row; Export CSV | Call and WhatsApp per row; no CSV | SPEC 9 asks for WhatsApp; CSV is part of the M8 report pack, as on `/loans` |
| 11 | Wide table fits at 1280 | Last columns scroll inside the table region at 1280 | Ten columns plus actions; the table scrolls in its own named region |
| 07 | WhatsApp reminder, Demand notice, Open recovery buttons | Receive payment and Extend loan | WhatsApp is on `/due` and `/field`; demand notice is M7; recovery is M6 |
| 12 | "He would owe…, and no penalty starts on 19 Feb" | "The borrower would owe…. No penalty starts on 19 Feb." | B-16 default (no gender recorded) |
| 12 | Expense card (court filing fee) | Not shown | Expenses come with M8 |

## Demo data check
After `pnpm seed:demo --as-of 2026-02-12`:
- **Penalties:** Mariama $240.00 (12 Feb). Esther $120.00, $144.00, $172.80. Mohammed $360.00, $432.00, $518.40, $622.08 (4 of 4, eligible for recovery).
- **Open loans:** 7 loans, **$10,169.28** outstanding; overdue $6,209.28 across Mariama, Esther and Mohammed. All match DEMO_DATA.
- **Pending extension:** Emmanuel's request for Joseph's loan (A−1 16:40, adds $120.00, new due date 12 Mar) waits in the inbox, as in DEMO_DATA.
- **Seed time:** about 3.5 minutes on a fresh database, because the nightly job runs once per day over 94 days. It is safe to rerun.

## Accessibility
- axe found no serious or critical issues on the new screens.
- Reminder and Call links include their visible words in their names.
- Field buttons stay at least 44 px high.
- The extension form is a labelled dialog, and the job result is a status message.

## Security review (phase end)
No high-confidence vulnerabilities in the M5 changes. Checked:
- **Job access:** the manual job is limited to manager and admin. The scheduled entry point and the internal helpers are not executable by any client role. Runs are serialised with an advisory lock, and every effect is audited.
- **Extensions:** only a loan officer (for their own branch) or a manager can request one, with a reason. A different manager or the CEO approves (SELF_APPROVAL). On approval the interest is recomputed, and a due date that changed since the request is refused.
- **Reminder route:** it requires signed-in staff, checks the loan state in SQL, logs every tap, and only redirects to `https://wa.me/…` built from the stored phone number. It is not an open redirect.
- **Read functions:** `due_list` and `loan_next_penalty` are staff-only. `journal_lines` stays finance-only (T-31).

## Issues found and fixed this phase
- A PL/pgSQL lint warning (shadowed loop variable) was fixed before commit.
- Audit actions must be namespaced, so the reminder event is `loan.reminder_opened` rather than the bare `reminder_opened` in SPEC 10.3.
- Accessible-name mismatches on the new reminder links were fixed.
- Job run times used the server clock; they now use the business clock, like every other record.
- Tests that picked up rows left by other local runs are now scoped to their own records.

## Decisions taken this phase
See `docs/DECISIONS.md` (M5.1 to M5.4). In short:
- B-15 base rule and T-33b;
- one job function for manual and scheduled runs;
- pg_cron without the HTTP fallback;
- next-penalty preview from SQL;
- B-07 window setting and B-18 buckets;
- reminders through a logging route;
- extension limits and recomputation;
- B-16 wording.

## Needs your decision
- **GitHub access**: reconnect it so the M5 commits can be pushed and CI can run.
- **Open questions:** B-07, B-15, B-16 and B-18 (M5), plus B-08, B-09, B-10, B-12 and B-19 (M4). Defaults apply; see `docs/reports/OPEN-QUESTIONS-2026-11-05.md`.
- **Extension limit**: at most the product's longest term (3 months by default) per request. Confirm or give MSI's rule.

## Next: M6 Collateral and recovery (FR-15, FR-16, FR-17, FR-19; T-14, T-15, T-16, T-24) — waiting for your approval
- Collateral register and custody log (`/collateral`, mock-ups 09, 10), release on closed loans
- Recovery cases (`open_recovery_case`, stages; B-04 RC numbers, B-05 "Case opened" stage), `/recovery` (mock-up 13); penalties stop when a case opens
- Collateral sale with allocation and surplus (R7, R7b; T-14, T-15), write-off with CEO approval (R6; T-16)
- Demo seed: RC-000001 for Mohammed Sheriff (opened A−8, notice A−5)
