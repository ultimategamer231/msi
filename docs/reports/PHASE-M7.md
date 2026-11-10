# Phase M7: Statements and documents — ready for review

Date: 2026-11-09 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1

**Pushed, but CI and PR not visible.** `git push` to the branch works again (M7.1–M7.3 went up on 2026-11-09), but the GitHub API still answers 404 for the repository, so this session cannot read PR #1 or the CI runs. Every check below was run locally.

## Acceptance (SPEC 13, M7)

| Check | Evidence | Result |
| --- | --- | --- |
| Statement running balance equals the ledger for every seeded loan | Demo seed: 12 of 12 paid-out loans, statement closing = `loan_balances.total_out`, $10,169.28 in total; `29_documents` checks the same for every paid-out loan in the database | **Pass** |
| Statement numbers, opening balance for a period, totals, outstanding by component | `29_documents` (17 tests) | **Pass** |
| Demand notice for overdue loans only, by a manager, the CEO or a loan officer, with deadline | `29_documents`; e2e (a cashier is refused) | **Pass** |
| Collateral receipt keeps one number; release letter only once returned | `29_documents`; e2e (409 before the release) | **Pass** |
| QR verify page shows number, date, amount, masked name and nothing else | `29_documents`; e2e signed out at 390 and 1280 px, also for a payment receipt (SPEC 13 scenario 3) | **Pass** |

## Blocks completed
- **M7.1** `loan_statement`, `issue_document` for statement (STM-), demand notice (DN-), collateral receipt (CR-<code>) and release letter (RL-<code>), public `verify_document`, the demand notice template and the `recovery.notice_days` setting.
- **M7.2** One A4 document layout (company header, number, time, preparer, QR footer, page numbers) and the four PDFs at `/api/pdf/<kind>/<id>`. A statement can be for one loan or for every paid-out loan of a customer, with `?from=&to=` for a period.
- **M7.3** Public `/verify/[token]`. Links:
  - loan page: Statement of account and, for overdue or recovery loans, Demand notice;
  - customer profile: Statement (all loans);
  - recovery case: Demand notice;
  - collateral item: Collateral receipt and, once returned, Release letter.
- **M7.4** Statement check on the demo data, screenshots, this report.

## Test totals (local, clean database)
- Unit: 322 passed
- Database: 531 passed; `supabase db lint` clean
- E2E: 172 passed at 390 and 1280 px (6 new), axe on the verify page and the item page
- Lint, typecheck, build: clean

## Screenshots
`docs/screenshots/m7/`:
- PDFs (first page): `pdf-statement.png` (Esther Toe, LN-BR2-00008), `pdf-demand-notice.png` (Mohammed Sheriff, in recovery), `pdf-collateral-receipt.png` (COL-000031), `pdf-release-letter.png` (COL-000019);
- `verify-390.png` / `verify-1280.png`;
- `loan-*.png` (Documents card) and `collateral-item-*.png` (Printouts card).

Demo data seeded on the real date (09 Nov 2026).

## Mock-up differences

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 10 | "Print collateral receipt" button at the top | "Printouts" card with the receipt and, once returned, the release letter | Same place as the loan page's Documents card; keeps the top for actions that change data |
| 13 | "Print demand notice" | "Demand notice (PDF)" next to Record court step | As drawn, with "(PDF)" like the other document links |
| — | No mock-up for `/verify` | Plain card in the login page style | SPEC 9 lists the fields only |

## Security review (phase end)
- `verify_document` is the only new function open to anonymous users. It returns kind, number, date, amount, masked name and the void flag. It looks up tokens of 22–64 characters only. The tokens are 18 random bytes.
- `/verify` is marked `noindex`. The page shows only those fields.
- `loan_statement` and `issue_document` are staff-only.
- Demand notices are limited in SQL to a manager, the CEO or a loan officer.
- The PDF routes stay behind sign-in; each kind checks the record again in `issue_document`.

## Issues found and fixed this phase
- The document title overlapped its subtitle in the PDFs; the title line height was fixed.
- Two database tests read rows left by e2e runs, which are dated on the real clock after the frozen test date. Both tests now read only their own data.
- After many local e2e runs, the approvals inbox had more than 25 pending items, so new cards fell onto page 2 and inbox tests failed. A `db reset` fixes it; CI always starts clean.

## Decisions taken this phase
See `docs/DECISIONS.md` (M7.1 to M7.3):
- statement and notice numbering;
- what the statement lists;
- who prints demand notices;
- what `/verify` shows;
- where the document links sit.

## Needs your decision
- **Demand notice wording**: it is a placeholder for MSI's lawyer (Settings → templates).
- **GitHub**: the API still shows the repository as not found. Once the account is restored, check PR #1 and CI.
- **Open questions** still on defaults: B-04, B-05 (M6); B-07, B-15, B-16, B-18 (M5); B-08, B-09, B-10, B-12, B-19 (M4).

## Next: M8 Money-out, day close, reports (FR-22, FR-23, FR-24) — waiting for your approval
- Payees, expenses, settlement
- Day close and period lock
- All reports in SPEC 10.2 with CSV export
- T-26, T-27, T-34; every report matches DEMO_DATA with `--as-of 2026-02-12`
