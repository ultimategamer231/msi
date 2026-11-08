# Phase M6: Collateral and recovery — ready for review

Date: 2026-11-08 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (carries M0–M4 on GitHub)

**Not pushed yet.** GitHub has refused this session's access (HTTP 403) since M5 began. All M5 and M6 commits are on the local branch. Every check below was run locally; CI has not run on them. To publish them, reconnect GitHub at https://claude.ai/connect-github.

## Acceptance (SPEC 13, M6)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-14 | Sale 200000 against 248832 owed | `27_recovery`: penalty 128832, interest 20000, principal 51168 applied; 48832 principal left; loan stays in recovery; case at disposal; item sold | **Pass** |
| T-15 | Sale 300000 against the same 248832 | `27_recovery`: 51168 surplus to 2100; loan and case close; surplus paid out once (R7b) | **Pass** |
| T-16 | Write-off of the remaining 48832 | `28_write_off`: Dr 5050 48832, Cr 1100 48832; written off; balance 0; case closed; CEO only, board reference required | **Pass** |
| T-24 | Pledge an item already securing an active loan | `26_collateral` (and `15_disbursement`): `COLLATERAL_ALREADY_PLEDGED` | **Pass** |

## Blocks completed
- **M6.1** Collateral register functions:
  - duplicate-identifier warning;
  - photos and documents;
  - custody events (moved, valued, note, lost);
  - release once every linked loan has ended;
  - RC numbering (B-04).
- **M6.2** `/collateral` (mock-up 09), `/collateral/new`, and `/collateral/[id]` (mock-up 10).
- **M6.3** Recovery in SQL:
  - recovery cases and stages (B-05);
  - opening a case stops penalties and seizes the collateral;
  - court steps;
  - sale preview and sale (R7);
  - surplus payout (R7b);
  - a case closes with its loan.
- **M6.4** Write-off through CEO approval with board reference (R6), and later recoveries posted to 4100.
- **M6.5** Recovery screens and actions:
  - `/recovery` and `/recovery/[caseId]` (mock-up 13);
  - recovery and write-off actions on the loan page;
  - write-off inbox card.
- **M6.6** Demo seed (custody log, releases, ready-to-return item, RC-000001), screenshots, and this report.

## Test totals (local, clean database)
- Unit: 322 passed
- Database: 514 passed; `supabase db lint` and `supabase db advisors` clean at warning level
- E2E: 166 passed at 390 and 1280 px, with axe on every new screen
- Lint, typecheck, build: clean
- CI: not run (push blocked)

## Mock-up comparison
Screenshots are in `docs/screenshots/m6/` (collateral register, the generator COL-000031, recovery list, case RC-000001 with a $3,000.00 sale preview), on demo data at 12 Feb 2026 09:10.

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 09 | "All locations" filter, Export CSV | Type filter and search | Locations are free text; CSV comes with the report pack (M8) |
| 09 | "Deed no. D-4410" | "Doc. D-4410" | One label for every document number |
| 10 | Print collateral receipt; signed collateral receipt PDF | Not yet | Collateral receipt and release letter PDFs are M7 |
| 10 | Received 14:10 by Grace Flomo | Received 09:30 when registered | The item is registered before the loan is drafted and pledged; the valuation at 14:25 and the move at 15:00 match |
| 13 | Print demand notice | Not yet | The demand notice PDF is M7 |
| 13 | "Filing fee request of $240.00 is waiting for approval" | "Next step." | Expenses come with M8 |
| 13 | Demand notice by David Kerkula | Recorded by Rebecca Wolo, with the note "delivered by hand by David Kerkula" | Recovery steps are recorded by a manager or the CEO (SPEC 4); a loan officer cannot record them |

## Demo data check
After `pnpm seed:demo --as-of 2026-02-12`:
- **Register:** 12 items listed (7 held, 1 in recovery, 1 ready to return, 3 released in the last 30 days), plus COL-000019, returned in Dec 2025.
- **COL-000031:** received, valued at $1,400.00 by Rebecca Wolo, then moved from the office desk to "Branch 2 safe, shelf B2" by Grace Flomo.
- **RC-000001 (Mohammed Sheriff):** opened 04 Feb by Rebecca Wolo; demand notice 07 Feb; the next step is court filed. The car (COL-000030) is held for the case.
- **Sale preview at $3,000.00:** allocates $1,932.48 / $300.00 / $767.52, leaving a $732.48 shortfall, as in DEMO_DATA.
- **Outstanding:** still $10,169.28 across 7 open loans.

## Accessibility
- axe: no serious or critical issues on the new screens.
- Forms are labelled dialogs, and the sale needs a confirmation.
- Links inside text are underlined.
- The stage list tells screen readers which steps are done, next or later.

## Security review (phase end)
No high-confidence vulnerabilities in the M6 changes. Checked:
- **Roles enforced in SQL:**
  - register and log events: officer, cashier or manager;
  - value or mark lost: manager only;
  - release: cashier or manager;
  - recovery steps, sale and surplus: manager or CEO;
  - write-off request: manager or accountant, with the override reserved to managers;
  - write-off approval: CEO only, never the requester.
- **Money rules:**
  - sales allocate with the same `allocate_amount` as payments;
  - surplus can never be paid twice or above what is held;
  - recoveries on written-off loans are capped;
  - every posting goes through `post_journal` with audit.
- **Data access:**
  - new read functions are staff-only;
  - photos stay in the private bucket with 10-minute signed links;
  - `journal_lines` stays finance-only (T-31).

## Issues found and fixed this phase
- An inline loan link on the case page needed an underline (accessibility).
- The recovery e2e test moved a due date back, but the payout was dated today, so no penalties existed then. The test now checks the recovery flow on the amount owed; penalties are covered by the database tests.
- Another parallel-test cash race in the loans e2e test was fixed with a top-up buffer.

## Decisions taken this phase
See `docs/DECISIONS.md` (M6.1 to M6.5). In short:
- custody event rules;
- duplicate warnings;
- release rules;
- B-04 and B-05 defaults;
- opening a case seizes items and stops penalties;
- the sale records the case step;
- surplus per loan on 2100;
- write-off override and board reference;
- capped recoveries;
- recovery actions on the loan page.

## Needs your decision
- **GitHub access**: reconnect it so the M5 and M6 commits can be pushed and CI can run.
- **Who records recovery steps**: SPEC 4 gives recovery to managers and the CEO. If loan officers should record a delivered demand notice themselves, say so. That is a permission change.
- **Open questions** still on defaults: B-04, B-05 (M6); B-07, B-15, B-16, B-18 (M5); B-08, B-09, B-10, B-12, B-19 (M4).

## Next: M7 Statements and documents (FR-14, FR-25) — waiting for your approval
- Statement of account PDF (running balance from the ledger for every seeded loan)
- Demand notice, collateral receipt and release letter PDFs
- Public QR verification page `/verify/[token]` (number, date, amount, masked name)
