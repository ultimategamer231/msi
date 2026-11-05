# Phase M3: Loans — ready for review

Date: 2026-11-05 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (also carries M0, M1 and M2, still in review)

## Acceptance (SPEC 13, M3)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-01 | Interest on 100000 at 2000 bps for 1 month | `13_money_and_balances`: 20000, total 120000 (`flat_interest`, `preview_loan_terms`); `15_disbursement`: the payout journal and `loan_balances` show 120000; matches `tools/vectors.py` | **Pass** |
| T-02 | Due dates 05 Jan + 1 month, 31 Jan + 1 month | `13_money_and_balances`: 05 Feb, 28 Feb (and 29 Feb in a leap year); `15_disbursement`: a payout on 05 Jan is due 05 Feb | **Pass** |
| T-17 | Loan creator approves own loan | `14_loan_workflow`: `SELF_APPROVAL` | **Pass** |
| T-18 | Loan 250000 submitted | `14_loan_workflow`: `required_role = ceo`, a manager gets `FORBIDDEN`, the CEO approves; e2e: only the CEO's inbox shows it, with the limit notice | **Pass** |
| T-19 | Loan 200000 submitted | `14_loan_workflow`: `required_role = manager` (the limit itself goes to a manager) | **Pass** |
| T-23 | Pay out without collateral when required | `15_disbursement`: `COLLATERAL_REQUIRED`; the wizard also asks for collateral before sending | **Pass** |
| T-35 | Pay out 500000 from a cash account holding 300000 | `15_disbursement`: `INSUFFICIENT_FUNDS` (on a fresh test branch so no other data can affect the balance) | **Pass** |

T-09 (rounding) also passes: pct(3333, 2000) = 667, pct(25, 2000) = 5.

## Blocks completed
- M3.1 Loan products (`loan_products`, `upsert_loan_product`, standard product seeded, Loan products tab in `/settings`, rates typed as percentages without floats)
- M3.2 Money helpers in SQL, `loans` with snapshot columns, `loan_balances` and `customer_balances` from the ledger, `preview_loan_terms`
- M3.3 `create_loan_draft`, `update_loan_draft`, `submit_loan` (routing by the manager limit), `cancel_loan`, loan decisions in `decide_approval`, loan cards in the inbox
- M3.4 Minimal collateral (`collaterals`, `loan_collaterals`, append-only `collateral_events`, `register_collateral`, `link_collateral`) and `disburse_loan` (R1) with collateral, funds, date and closed-day checks
- M3.5 `/loans/new` wizard: customer, amount and term with a live preview, collateral, guarantors with ID scans, send or save as draft
- M3.6 `/loans` (mock-up 06), `/loans/[id]` (mock-up 07), loans and total owed on the customer profile, `loan_activity()`
- M3.7 `issued_documents`, `issue_document`, loan agreement PDF with QR code, demo seed loans

## Test totals (local, last run)
- Unit: 311 passed
- Database: 325 passed on a seeded database; `supabase db lint` and `supabase db advisors` clean at warning level
- E2E: 142 passed (390 and 1280 px, axe on every new screen)
- Lint, typecheck, build: clean
- CI: green through M3.6; the last pushes are running

## Mock-up comparison
`docs/screenshots/m3/compare-06.png` and `compare-07.png` (demo data as of 12 Feb 2026 09:10). Layout, columns, cards and copy match. Differences:

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| Loans list | Closed loans (Prince, Alieu, Musu, Comfort, Mariama's first loan) show "Closed"; Mariama owes $1,440.00, Esther $1,036.80, Mohammed $3,732.48 in recovery | Those loans are still open and owe interest only; no penalties | Repayments arrive with M4, penalties with M5, recovery with M6; the seed adds them then |
| Loans list | "Export CSV" | Not yet | CSV export comes with the report pack (M8) |
| Loans list | Rows in the mock-up's order | Newest application first | In real use applications are numbered in time order; the demo seed creates them out of date order, so the demo list order differs |
| Loan page | Receive payment, Extend loan, WhatsApp reminder, Demand notice, Open recovery | Not yet | M4, M5, M7 and M6 |
| Loan page | "Next penalty 19 Feb 2026: $288.00", penalty activity row | Components line (principal, interest, penalties) | Penalties come with M5 |
| Loan page | Collateral receipt and statement links | Loan agreement link only | M7 |
| Both | Top-bar search, branch switcher | Branch name | Not in FR-01..FR-29 (as in M2) |

## Demo data check
`pnpm seed:demo --as-of 2026-02-12` now also:
- funds the branch cash accounts with approved capital (placeholder amounts: Main $5,000, Branch 2 $10,000, Branch 3 $3,000, reconciled with the Branch 2 day close in M8);
- registers the 13 DEMO_DATA collateral items as COL-000019 to COL-000034 (lower and missing numbers were paper records, B-02);
- creates the 13 DEMO_DATA loans in number order, LN-…-00002 to 00014 (LN-00001 was a paper loan), each drafted by its officer, approved by Rebecca Wolo and paid out in cash by Grace Flomo on its DEMO_DATA date, with due dates as in DEMO_DATA (for example LN-BR2-00009 paid out 05 Jan, due 05 Feb, guarantor Joseph Kollie). LN-BR1-00014 (Kpanah Mulbah, $2,500) waits for the CEO.

The seed is safe to rerun. Branch 2 cash after the payouts: $1,825.00.

## Accessibility
axe: no serious or critical issues on the new screens. The wizard announces its step and the live preview (`aria-live`); confirmation steps for pay out and cancel are `alertdialog`s; inner table scroll areas have their own names ("Loans table", "Activity table") so they do not repeat the section names.

## Security review (phase end)
No high-confidence vulnerabilities in the M3 changes. Checked:
- Every new RPC checks the role in SQL. Loan officers act only for customers of their branch. Only the creator changes or sends a draft. The creator never approves (T-17). Only a cashier pays out, from their own cash account (B-10).
- Money and dates are validated in SQL: whole cents and basis points, today's date unless admin or accountant before go-live, closed days refused.
- The balances and activity functions return per-loan totals to active staff only. `journal_lines` stays finance-only (T-31 unchanged).
- The PDF route requires a signed-in staff member, validates the kind and id, and serves `no-store`. Tokens are 24 random URL-safe characters.

Fixed this phase: the commit-time ledger checks ran with the session's rights, so a cashier's payout was refused. They now run with the owner's rights, and a regression test proves the failure without the fix.

## Issues found and fixed this phase
- Commit-time ledger checks under RLS (above). The database tests now force deferred checks under the acting role.
- A PL/pgSQL lint warning (role cast in `submit_loan`) reached CI once. The database lint now runs before every commit.
- Two tests depended on data left by other runs (sequence audit count, empty cash account); both are now independent.

## Decisions taken this phase
See `docs/DECISIONS.md` (M3.1 to M3.6). In short:
- product ranges and the placeholder maximum term (3 months);
- money helpers in SQL;
- balances views over a staff-only function;
- loan numbers given at draft;
- the customer's branch owns the loan;
- routing by the manager limit;
- minimal collateral now, the rest in M6;
- cashier-only payout from their own cash account;
- the wizard calls the RPCs in order and cancels on failure;
- status pills read from due date and balance;
- `loan_activity()`;
- agreement numbered AGR-<loan number>.

## Needs your decision
- **Longest loan term**: the seeded product allows up to 3 months. Confirm or give MSI's figure.
- **Opening capital amounts** in the demo seed are placeholders until the M8 reconciliation.
- **B-24, B-25 and the M2 mock-up differences** are still open; the defaults apply.

## Next: M4 Payments (FR-10, FR-11, FR-20; T-06 allocation, T-10, T-11, T-12, T-25, T-28, T-36, T-37) — waiting for your approval
- M4.1 `receive_payment` (R2): allocation, idempotency, method and date rules
- M4.2 `record_field_payment` (R3) and `confirm_remittance` (R3b) (B-09 needs your answer: mobile money in the field)
- M4.3 Void and journal reversal flows (R8, B-12)
- M4.4 Receive payment screen (mock-up 03) and payments list
- M4.5 Receipt screen (mock-up 04), print CSS and receipt PDF
- M4.6 Field app (mock-ups 01, 02) and remittance screen
- Demo seed: the DEMO_DATA repayments, so closed loans close
