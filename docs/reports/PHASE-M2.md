# Phase M2: Customers — ready for review

Date: 2026-11-04 · Branch: `claude/new-session-6ictcc` · PR: https://github.com/ultimategamer231/msi/pull/1 (also carries M0 and M1, still in review)

## Acceptance (SPEC 13, M2)

| Test | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| T-29 | Customer edit by a loan officer | `10_approvals`: nothing changes while the request waits; a manager approves; the record changes and the `customer.updated` audit row holds only the changed field, before and after, with the approver as actor. E2E `approvals.spec`: the same through the profile and the inbox | **Pass** |
| T-32 | Duplicate customer phone | `09_customers`: same phone (also as +231 or as the second phone) or same ID number gives `DUPLICATE_CUSTOMER` with the existing record in the error detail; a loan officer's override is `FORBIDDEN`; a manager overrides with a reason, which is audited. E2E `customers.spec`: warning lists the record; only the manager sees "Create anyway" | **Pass** |
| M2 gate | "Inbox shows pending edit and applies it" | E2E `approvals.spec`: the officer's phone change appears in the manager's Waiting list with current and requested values; Approve applies it and moves it to Approved | **Pass** |

## Blocks completed
- M2.1 `customers` (SPEC 7.2) with phone and ID comparison keys and a search column; `attachments` (append-only); private `documents` bucket with own-folder uploads; `create_customer` with validation and the duplicate guard; `add_customer_documents`
- M2.2 `/customers` (search by name, phone, ID or code; status, branch and officer filters; phone cards and desktop table) and `/customers/new` (individual or business, KYC, photo and documents with file-type check and photo shrinking, duplicate warning with manager override)
- M2.3 `request_customer_edit` (fields, new photo, status change), `apply_customer_edit` (stale check, re-validation, before/after audit), `decide_approval` (customer edits, status changes, manual journals, capital in), `request_capital_in` (R10, R-14) with a ledger form
- M2.4 `/customers/[id]` (mock-up 08), `/approvals` (mock-up 12), approvals count in the top bar, sidebar and More sheet
- M2.5 `guarantors` table and `clean_guarantors()` validation, guarantor form section for the M3 loan wizard; demo seed customers and the pending phone change

## Test totals (local, last run)
- Unit: 299 passed
- Database: 234 passed (fresh and seeded database); `supabase db lint` and `supabase db advisors` clean at warning level
- E2E: 126 passed (390 and 1280 px, axe on every screen)
- Lint, typecheck, build: clean
- CI: green on M2.1. The runs for M2.2–M2.4 were still queued on GitHub's side when this report was written (no job had started); the latest run covers all blocks.

## Mock-up comparison
`docs/screenshots/m2/compare-08.png` and `compare-12.png` (mock-up left, built right, demo data as of 12 Feb 2026 09:10). Same layout, copy and colours. Differences, all deliberate:

| Where | Mock-up | Built | Why |
| --- | --- | --- | --- |
| Profile | Loans, Collateral, Total owed, "New loan", "Statement of account" | Not shown yet | Those records arrive in M3 (loans, balances), M6 (collateral), M7 (statements); no dead buttons |
| Profile | "Request edit" shown while a change waits | Hidden while a change waits | Only one open change per customer (decision M2.3); the button would only produce an error |
| Top bar | Search box and "All branches" button | Branch name only | A global search and a branch switcher are not in FR-01..FR-29 (CLAUDE.md rule 10) |
| Inbox | Extension and expense cards | Not yet | Those request types arrive in M5 and M8; the inbox already renders any type generically |
| Inbox | — | "Open customer CU-000008" link on customer cards | Lets the manager check the record before deciding |
| Profile | — | Add document, and status change (blacklist/archive) panels | FR-03 documents and SPEC 5.11 blacklisting need a place; same card style |

## Demo data check
`pnpm seed:demo --as-of 2026-02-12` now creates the 12 DEMO_DATA customers through `create_customer`, signed in as their loan officers, at their registration dates. Mariama Kollie is CU-000008, registered 02 Oct 2025, with phone 0770 555 010, National ID LR-0012345, market trader, next of kin Joseph Kollie (brother) 0770 555 014, as on mock-up 08. Emmanuel Tarpeh's request to change her phone to 0770 555 011 waits from 07:10, so on A at 09:10 the manager sees "2 hours ago" and "1 waiting for you". Details DEMO_DATA does not give (other phones, IDs, occupations, registration days) are placeholders in the same style. The seed skips customers that already exist and is safe to rerun.

## Accessibility
axe: no serious or critical issues on the new screens at 390 and 1280 px. Status badges carry text, counts have screen-reader text ("1 request waiting for you"), the reject confirmation is an `alertdialog`, each approval card is an article named by its title, and every field has a visible label.

## Security review (phase end)
No high-confidence vulnerabilities in the M2 changes. Checked:
- Every new RPC checks the role in SQL. The helpers (`claim_upload`, `link_attachments`, `apply_customer_edit`, `find_duplicate_customers`, `validate_customer`, `clean_guarantors`) cannot be called by clients (schema test lists exactly the client RPCs).
- `decide_approval` locks the request row, refuses decided requests, `SELF_APPROVAL`, and CEO-level requests for managers.
- Uploads go only to the uploader's folder (storage policy). Files are linked only by the uploader, only once, and the type and size come from storage. The server reads the file type from the first bytes.
- Documents are private and shown through 10-minute signed links. Approval requests keep their RLS (managers, CEO, requester).
- Edit patches accept only listed fields. A changed phone or ID is re-checked for duplicates at approval.

Note: server actions now accept up to 11 MB per request (one document); Next.js parses the body before the action checks the session. This is the documented way to raise the limit; rate limiting arrives with M9.3.

## Issues found and fixed this phase
- A numbering test assumed no customers existed; it now resets counters inside its own rolled-back transaction.
- The duplicate check compares phone digits with the +231 prefix folded, so "0770 555 010" and "+231 770 555 010" match.

## Decisions taken this phase
See `docs/DECISIONS.md` (M2.1 to M2.4): duplicate keys and override reason, ID required for individuals, own-folder uploads with type sniffing, documents added without approval (B-24), one open change per customer, status changes as their own request type, edit form on the profile route, request-age wording, inline reject confirmation, approvals count rule.

## Needs your decision
- **B-24** (default applied): documents can be added to a customer without approval; a new photo needs approval.
- **B-25** (default applied): only managers, the CEO and the requester see that a customer change is waiting.
- **Mock-up differences** in the table above: confirm, or tell me which to change.

## Next: M3 Loans (FR-06, FR-07, FR-08, FR-09; T-01, T-02, T-17, T-18, T-19, T-23, T-35) — waiting for your approval
- M3.1 Loan products and settings tab
- M3.2 Loans table, money helpers, `preview_loan_terms`, `loan_balances` view
- M3.3 Draft, submit and approval routing (through `decide_approval`)
- M3.4 Minimal collateral pledge and `disburse_loan` (R1) with collateral, funds and lock checks
- M3.5 New loan wizard (with the guarantor section from M2.5)
- M3.6 Loans list (mock-up 06) and loan detail (mock-up 07); loans, total owed and "New loan" on the customer profile
- M3.7 `issue_document` and the loan agreement PDF
- Demo seed: branch opening cash through approved capital entries (R-14), then the DEMO_DATA loans
