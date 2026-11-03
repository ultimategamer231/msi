# Mock-ups: Method Solutions Inc. loan system

Approved visual reference for the MVP. Live canvas: https://claude.ai/artifact/9Cb26wkner8VdRy86Z6FuT

- `screens/` – PNG at 2x (390px mobile, 1280px desktop). Use these for visual comparison.
- `html/` – the same screens as static HTML (open in a browser; Inter font loads from Google Fonts). Use these to read exact spacing, colours and copy.

The mock-ups define **layout, hierarchy, copy tone and colour tokens**. They do not override the spec: if a mock-up and `docs/SPEC.md` disagree on a rule, the spec wins; record the difference in `docs/QUESTIONS.md`.

All figures come from the demo dataset in `docs/DEMO_DATA.md` (business date 12 Feb 2026). After `pnpm seed:demo`, each built screen must show the same numbers.

| # | File | Route | Role shown | Milestone |
| --- | --- | --- | --- | --- |
| 01 | field-today | `/field` | Loan officer (Emmanuel Tarpeh) | M4 |
| 02 | field-collect | `/field/collect/[loanId]` | Loan officer | M4 |
| 03 | cashier-receive-payment | `/payments/new?loan=` (390px) | Cashier (Grace Flomo) | M4 |
| 04 | receipt | `/receipts/[id]` (phone view) | Cashier | M4 |
| 05 | dashboard-manager | `/dashboard` | Manager (Rebecca Wolo) | M9 |
| 06 | loans-list | `/loans` | Manager | M3 |
| 07 | loan-detail | `/loans/[id]` | Manager | M3 (actions complete by M6) |
| 08 | customer-profile | `/customers/[id]` | Manager | M2 |
| 09 | collateral-register | `/collateral` | Manager | M6 |
| 10 | collateral-detail | `/collateral/[id]` | Manager | M6 |
| 11 | due-overdue | `/due` | Manager | M5 |
| 12 | approvals | `/approvals` | Manager | M2 (all request types by M8) |
| 13 | recovery-case | `/recovery/[caseId]` | Manager | M6 |
| 14 | day-close | `/day-close` | Manager reviewing Branch 2 | M8 |
| 15 | report-overdue | `/reports/overdue` | Accountant (Peter Zayzay) | M8 |

Screens 01–03 and 05–15 show 12 Feb before Mariama Kollie's $500 payment. Screens 02 and 03 show that same payment taken two ways (officer in the field, cashier at the counter); the demo data records it through the cashier, and screen 04 is the receipt that results (14:52). After that payment her loan shows $940.00 owed.

## Design tokens taken from the mock-ups

| Token | Value | Use |
| --- | --- | --- |
| primary | `#32207E` | Buttons, links, active nav, mobile header |
| primary-dark | `#241660` | Desktop sidebar |
| primary-tint | `#E6E1F7` | Light text on purple, avatar fill |
| accent | `#FFE103` | Count badges only, with `#241660` text |
| surface / page | `#FFFFFF` / `#F1F5F9` | Cards / page background |
| border | `#E2E8F0` | Cards, tables, inputs `#CBD5E1` |
| text / muted | `#0F172A` / `#475569` | Body / secondary |
| status active | `#DCFCE7` / `#166534` | Badge bg / text |
| status due | `#DBEAFE` / `#1E3A8A` | |
| status overdue | `#FFEDD5` / `#7C2D12`, strong `#C2410C` | |
| status recovery | `#0F172A` / `#FFFFFF` | |
| status pending / closed | `#E2E8F0` / `#334155` | |
| radius | 10px controls, 14px cards, 999px badges | |
| type | Inter 400/500/600/700; numbers use tabular figures | |
| touch target | 40px desktop controls, 44–52px on `/field` | |

The logo always sits on a white tile. Never place it directly on purple.

## Not shown in the mock-ups (build from the spec, same visual language)

Login, customer and loan forms, payments list, remittance, recovery list, expenses, payees, other reports, ledger, settings, audit log, `/verify/[token]`, empty states, loading states, error states, confirmation dialogs.
