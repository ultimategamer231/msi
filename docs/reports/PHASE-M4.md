# Phase M4: Payments — ready for review

Date: 2026-11-07 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (also carries M0–M3, still in review)

## Acceptance (SPEC 13, M4)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-06 (allocation) | 50000 paid after a 24000 penalty on a 120000 loan | `17_payments`: penalty 24000, interest 20000, principal 6000; 94000 left; R2 lines Dr branch cash, Cr 1120/1110/1100; the screen's preview shows the same split (`preview_payment`) | **Pass** |
| T-10 | Payment above what is owed | `17_payments`: `OVERPAYMENT`, nothing posted; e2e: flagged in the preview and refused on save | **Pass** |
| T-11 | Mobile money without a reference | `17_payments`: `REFERENCE_REQUIRED` (bank too, at least 4 characters); e2e: the form asks for it | **Pass** |
| T-12 | Same request key twice | `17_payments`: the original receipt comes back, one payment, one journal; the screens make the key when they open | **Pass** |
| T-25 | Void approved by its requester | `19_voids_reversals`: `SELF_APPROVAL`; another manager approves: reversing journal with `reversal_of`, balances restored, closed loan reopened, original journal untouched, chain verifies; `20_receipts` and e2e: the receipt reads VOID | **Pass** |
| T-28 | Field cash before and after handover | `18_field_payments`: 1015 holds the cash under the collector, then is back to zero and the branch cash has it; e2e: officer collects, cashier confirms | **Pass** |
| T-36 | Counted total does not match | `18_field_payments`: `REMITTANCE_MISMATCH`, nothing posted; e2e: the error shows, the right total confirms | **Pass** |
| T-37 | Back-dated payment after go-live | `17_payments`: `DATE_NOT_ALLOWED` for the accountant after go-live; allowed before go-live (A-19) | **Pass** |

## Blocks completed
- M4.1 `payments`, `payment_allocations`, `receive_payment` (R2): allocation order setting, overpayment, references, request keys, entry dates; loans close at zero; `post_journal` links reversals
- M4.2 `record_field_payment` (R3; B-09 default) and `confirm_remittance` (R3b)
- M4.3 Payment voids and journal reversals through approval (R8; B-12 default); inbox cards
- M4.4 Receive payment screen (mock-up 03) with the SQL preview; payments list with filters and void request; Receive payment and "Paid so far" on the loan page
- M4.5 Receipt screen (mock-up 04), A5 and 80 mm printing, receipt PDF, VOID stamp
- M4.6 Field screens (mock-ups 01, 02) and the Field cash (remittance) screen
- M4.7 Demo repayments, clean-up, handover notes, this report

## Test totals (local, last run)
- Unit: 312 passed
- Database: 395 passed; `supabase db lint` and `supabase db advisors` clean at warning level
- E2E: 152 passed (390 and 1280 px, axe on every new screen)
- Lint, typecheck, build: clean
- CI: green on M4.1–M4.6 pushes (M4.7 result added to the PR when it finishes)

## Mock-up comparison
Screenshots in `docs/screenshots/m4/` (demo data, 12 Feb 2026 09:10, 390 and 1280 px): receive payment, receipt, payments list, field cash, field list, collect.

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| 01, 02, 03 | Mariama owes $1,440.00 (with a $240.00 penalty); Esther $1,036.80 | $1,200.00 and $600.00 | Penalties come with M5 (daily job) |
| 01 | "Remind" (WhatsApp) button | Call and Collect | WhatsApp reminders and their template and audit event are M5 (SPEC 10.3, FR-13) |
| 01 | Bottom tabs Today, Customers, Cash, History | The shared menu (Dashboard, Today, Customers, Loans, More) | Navigation follows the role rules (B-14 default); field cash is on the Today screen |
| 01, 02 | Custom purple header with logo and stat tiles | Standard top bar, stat tiles below it | One header for every screen |
| 04 | "Share on WhatsApp" | Print A5, Print 80 mm, PDF | B-19 not approved yet; the slot holds the 80 mm print |
| 04 | `[Address] · [Phone]` | Line left out | B-08 default (a): blank fields are not printed |
| 04 | RCT-BR2-000123 for Mariama | Not seeded | DEMO_DATA: that payment is the demo e2e script, which needs the M5 penalty first |

## Demo data check
`pnpm seed:demo --as-of 2026-02-12` now also records the DEMO_DATA payments through the RPCs at their story dates:
- RCT-BR2-000116 to 000119: the earlier receipts. Mariama's first loan is paid 10 Dec 2025, Prince on 15 Jan, part payments by Alieu and Musu.
- RCT-BR2-000120: Musu's final $350.00, collected in the field by Emmanuel Tarpeh on 11 Feb and still with him (shows on his Today screen and on Grace's Field cash screen).
- RCT-BR2-000121 and 000122: Alieu's $200.00 at 09:20 and Comfort's $150.00 at 15:10 on 11 Feb, taken by Grace Flomo.
- LN-BR1-00011, LN-BR2-00002, 00003, 00006 and 00012 close on their DEMO_DATA dates. The seed is safe to rerun.

## Accessibility
axe: no serious or critical issues on the new screens. Method choice is a radio group; the allocation preview is a live region; void and handover confirmations are `alertdialog`s; field buttons are 52 px high at every width; links inside text are underlined.

## Security review (phase end)
No high-confidence vulnerabilities in the M4 changes. Checked:
- Every money RPC checks the role in SQL. Office payments are cashier or manager; accountant and admin only before go-live with a back date. Field payments are loan officers, for loans of their branch only. Remittance is a cashier for their own branch, or a manager. Voids and reversals need a reason, and a different approver (SELF_APPROVAL).
- Amounts are whole cents checked in SQL. Overpayment, references and dates are refused before anything is written. Request keys make retries safe.
- New read functions (`preview_payment`, `receipt_balance_after`) are staff-only and return totals for one loan or payment. `journal_lines` stays finance-only (T-31).
- Receipt tokens are 24 random URL-safe characters. The PDF route needs a signed-in staff member and serves `no-store`. The QR link uses the request's host, which only affects the page shown to that same user.

## Issues found and fixed this phase
- Help text on the grey page background and an inline link without underline failed contrast checks. The form now sits on a white card and links in text are underlined.
- The void button's accessible name did not include its visible text; renamed to "Request void of RCT-…".
- Parallel e2e tests drew on the same branch cash; the test helper now tops up with a buffer.
- Locally, stale pending requests from many runs pushed new items to page 2 of the inbox. CI uses a fresh database. The handover notes say to reset the local database if this happens.

## Decisions taken this phase
See `docs/DECISIONS.md` (M4.1 to M4.6). In short:
- payments follow the receiver's branch (B-10);
- request keys are required;
- the allocation order is a setting;
- loans close at zero;
- field cash goes to 1015 and mobile money or bank collected in the field go straight to their accounts (B-09);
- remittance is one branch at a time;
- voids and journal reversals go through approval (B-12);
- the preview comes from SQL;
- the receipt is issued on first view, and the balance after it is read from the ledger in posting order;
- print sizes;
- the field screens reuse the payment form.

## Needs your decision
Still open (defaults applied, see `docs/reports/OPEN-QUESTIONS-2026-11-05.md`):
- **B-09**: field mobile money and bank.
- **B-10**: the cashier's branch.
- **B-12**: journal reversal.
- **B-08**: blank header fields.
- **B-19**: WhatsApp share on receipts (not built).
- **M5 items**: B-07, B-15, B-16, B-18.

## Next: M5 Accruals and due lists (FR-12, FR-13, FR-18; T-03 to T-09, T-13, T-33) — waiting for your approval
- `run_daily_accruals` (penalties per SPEC 5.2 with the late-run rule, B-15), `pg_cron`, manual run button
- Overdue status and days overdue from the job
- `/due` (due today, due in 7 days, overdue) with WhatsApp reminder links and the `reminder_opened` audit event; Remind on `/field`
- Loan extension through approval
- Demo seed: penalties as in DEMO_DATA (Mariama $240.00 on A, Esther, Mohammed) and the demo payment script (RCT-BR2-000123)
