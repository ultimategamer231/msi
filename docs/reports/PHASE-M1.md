# Phase M1: Ledger core — ready for review

Date: 2026-11-04 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (also carries M0, still in review)

## Acceptance (SPEC 13, M1)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-20 | Insert an unbalanced journal | `05_ledger_core`: refused with `JOURNAL_UNBALANCED` at commit; `06_posting_numbering`: `post_journal` refuses it before writing; `08_manual_journal`: refused at request time | **Pass** |
| T-21 | Update or delete a posted journal, line or audit row | Owner gets `IMMUTABLE_RECORD` on update, delete and truncate (`02_audit_log`, `05_ledger_core`); service role, admin and accountant are refused earlier with `permission denied` (no write privilege); lines cannot be added to a journal from an earlier transaction; the hash chain exposes edits made with triggers disabled | **Pass** (see B-23 on the wording) |
| T-22 | Post into a locked date | `06_posting_numbering`: `PERIOD_LOCKED` for a locked branch via the journal branch or a cash account line; the next day is open; `08_manual_journal`: refused at request time | **Pass** |

## Blocks completed
- M1.1 Chart of accounts (SPEC 6.1, cash account per branch), journals and journal lines with all SPEC 6.3 invariants, journals in the hash chain (R-02)
- M1.2 `post_journal` (only writer), `next_number` (global loan counter B-02, 6-digit EXP B-03), `set_sequence_start`, `period_locks`
- M1.3 `/ledger`: journals with lines, trial balance with balanced check, `trial_balance()`
- M1.4 `approval_requests` and the manual journal request (accountant, admin; validated with the real posting rules by a rolled-back dry run)

## Test totals (local, last run)
- Unit: 281 passed
- Database: 155 passed (on a fresh and on a used database); `supabase db lint --fail-on warning` clean
- E2E: 103 passed (390 and 1280 px, axe on every screen), repeated runs clean
- Lint, typecheck, build: clean; CI green on every M1 block push

## Mock-up comparison
No mock-up covers the ledger or manual journals (`docs/mockups/README.md` lists them under "Not shown"). Built in the shared visual language; screenshots in `docs/screenshots/m1/` (journals, trial balance, manual journal; 390 and 1280).

## Demo data check
M1 adds no demo records by itself. Opening cash per branch (DEMO_DATA: BR1 $5,000, BR2 $2,000, BR3 $3,000 on A−1) needs a capital journal. SPEC lists recipe R10 (capital in) but no RPC for it; plan: the demo seed records capital as an approved manual journal (R11) once `decide_approval` exists in M2, before the M3 disbursements need cash.

## Accessibility
axe: no serious or critical issues. Fixed this phase: wide tables on phones were not keyboard-scrollable (`ScrollRegion`, WCAG 2.1.1), now also applied to audit and branches tables.

## Security review (phase end)
No high-confidence vulnerabilities in the M1 changes. Checked: `post_journal`, `next_number` and helper functions are not executable by clients; `request_manual_journal` checks the role in SQL and its dry run is always rolled back (the success marker is raised only by the function itself); `approval_requests` RLS shows requests to managers, the CEO and their requester only; `trial_balance` runs with the caller's rights so ledger RLS applies; ledger filters are validated and passed through the query builder. Fixed this phase: new functions no longer get EXECUTE for PUBLIC by default (caught by the schema test).

## Issues found and fixed this phase
- Global PUBLIC execute default on new functions (security; migration `20261105000100`).
- react-hook-form resolver did not nest field errors, so errors on journal lines were not shown (`src/lib/zod-resolver.ts`, unit tests added).
- Database tests that assumed an empty database now hold on any database.

## Decisions taken this phase
See `docs/DECISIONS.md` (M1.1 to M1.4): content hash for the journal chain, lines only in the creating transaction, receivable lines tagged with loan and component, one lock row per branch, numbering fixed after go-live, invoker trial balance, inline journal lines, dry-run validation for requests.

## Recommendations (need approval)
| ID | Recommendation | Benefit | Cost | Phase |
| --- | --- | --- | --- | --- |
| R-12 | `supabase db advisors` in the CI database job (carried from M0) | Automatic security and performance lint | One CI step | M2 |
| R-14 | Add an RPC for recipe R10 (capital in / owner contributions), approved like a manual journal | SPEC 6.2 lists R10 but no function; MSI will put money in; avoids using free-form manual journals for a routine event | Small | M2 or M8 |

## Risks and open questions
- B-22 approved and built; B-23 keeps both layers (see `docs/QUESTIONS.md` answers).
- PR #1 now carries M0 and M1. If you merge it, both go in together; if you want them separate, tell me and I will split the history.

## Next: M2 Customers (FR-03, FR-04, FR-05, FR-28; T-29, T-32) — waiting for your approval
- M2.1 Customers, `create_customer` with duplicate guard, attachments and private storage
- M2.2 Customer list and new-customer form
- M2.3 `decide_approval` dispatcher, customer edit and blacklist requests (and decisions on manual journals)
- M2.4 Customer profile (mock-up 08), approvals inbox (mock-up 12), top-bar approvals count
- M2.5 Guarantor model and form component
