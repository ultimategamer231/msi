# LoanDesk: open questions and key decisions (after M3)

Date: 05 Nov 2026 · Status: M0–M3 complete and in review on PR #1 · M4 (Payments) waiting for approval

**How to answer:** reply "accept all recommended", or list the IDs you want changed with your choice. Full detail for each B-item is in `docs/QUESTIONS.md`; every decision is logged in `docs/DECISIONS.md`.

---

## 1. Questions for you

### 1.1 Needed for M4 (Payments)

| ID | Question | Options | Recommended |
| --- | --- | --- | --- |
| **B-09** | Can loan officers take **mobile money or bank** payments in the field? Mock-up 02 shows this; the spec says field payments are cash only, held until handed to the cashier. | **(a)** Cash goes to field cash and must be handed over; mobile money and bank go straight to those accounts with a reference, no handover. **(b)** Cash only on the field screen. | **(a)** |
| **B-10** | When a cashier pays out or receives money for **another branch's loan**, whose cash account and receipt numbers are used? | **(a)** The cashier's own branch (as built for payouts). **(b)** The loan's branch. | **(a)** |
| **B-12** | Add a way to **reverse a wrong journal** with approval? The spec lists the approval type but no function for it. Payments are voided separately. | Yes / No | **Yes** |
| **B-19** | **"Share on WhatsApp"** button on receipts (mock-up 04)? It's not in the spec, so it would be a small scope addition. | Yes / No | **Yes** |
| **B-08** | Receipt header while MSI's address and phone are missing. | **(a)** Leave them out until supplied. **(b)** Print "[Address] · [Phone]". | **(a)** |

### 1.2 Needed for M5–M8 (can wait)

| ID | Question | Recommended |
| --- | --- | --- |
| **B-07** | "Due soon" list: due in **7 days** (spec) or 14 (mock-up 11)? | 7, kept as a setting |
| **B-15** | How penalties are computed when the daily job runs late (more than one period behind) | The exact rule in `docs/QUESTIONS.md`, plus a new test (T-33b) |
| **B-16** | Mock-up wording "He would owe…" (gender isn't recorded) | "The borrower would owe…" |
| **B-18** | Overdue groups | 1–7, 8–30, 31+ days; label "31+ days" everywhere |
| **B-04** | Recovery case numbers | RC-000001 |
| **B-05** | Add a "Case opened" stage before "Notice sent" | Yes |
| **B-06** | Where day closes are reviewed | On the Day close screen only, not in the approvals inbox |
| **B-13** | Default list windows | Open items, plus this year's (loans) or the last 30 days (collateral), each with a "show older" option |
| **B-17** | Expense category label | "Legal and recovery costs" |

### 1.3 Confirm what is already built (defaults applied)

| ID | Question | Recommended |
| --- | --- | --- |
| **B-24** | Can staff add documents to a customer without approval? A new photo still needs approval. | Yes (as built) |
| **B-25** | Who sees that a customer change is waiting? | Managers, the CEO and the person who asked (as built) |
| **B-14** | Navigation and approvals count follow the role rules, not the mock-ups (for example, the accountant's count shows nothing to decide) | As built |
| **Term** | Longest loan term for the standard product | 3 months (placeholder), or MSI's figure |
| **Capital** | Demo opening cash: Main $5,000, Branch 2 $10,000, Branch 3 $3,000 | Placeholders until the M8 reconciliation |
| **Mock-ups** | Accept the differences listed in the M2 and M3 reports (top-bar search and branch switcher not built; loan, collateral and payment panels arriving with their milestones; CSV export in M8) | Yes |
| **B-21** | Send `tools/audit.py` if you want it in the repo | Not needed |

### 1.4 Information only MSI can give (no rush; defaults apply)

1. Names and addresses of the three branches (the demo uses "Main", "Branch 2", "Branch 3").
2. Head-office address, phone and email, for receipts and letters.
3. How borrowers pay and how loans are paid out: cash, Orange Money, MTN MoMo, bank.
4. Collateral types accepted, where items are stored, and documents held.
5. Any loan fees, and the term range offered beyond 1 month.
6. Printers in use (A4, thermal 80 mm).
7. Whether the compounding penalty (A-06: 20% of the amount owed every 7 days, up to 4 times) fits the CBL licence terms.
8. A lawyer's wording for the loan agreement and the demand notice (the current text is a marked placeholder).
9. Currencies in use and the exchange-rate method (A-01; USD only for now).
10. Budget, target start date and the decision contact.

---

## 2. Key decisions made so far

### 2.1 Approved by you

| ID | Decision |
| --- | --- |
| B-01 | Demo business clock (`clock.override_at`), allowed only in demo and test databases |
| B-02 | One global loan counter with the branch in the number; admin can continue paper numbering before go-live |
| B-03 | Expense numbers have 6 digits (EXP-BR2-000031) |
| B-11 | Managers may have no branch (they oversee all branches) |
| B-20 | Push when a block or phase is done; wait for approval only before the next phase |
| B-22 | The logo may appear on public pages (only the logo bucket is public) |
| R-12 | Supabase database checker runs in CI and fails on warnings |
| R-14 | Owner capital entry (R10), approved like a manual journal |

### 2.2 Made by me (spec or recommended default)

1. **Audit trail:** journals and the audit log are hash-chained, so any edit made behind the app's back can be detected. Posted records can never be changed; for B-23 both layers of protection are kept.
2. **Money rules live only in the database.** Amounts are whole cents and rates whole basis points, with no decimals anywhere. Interest and due dates match `tools/vectors.py` exactly (T-01, T-02, T-09).
3. **Ledger access:** officers and cashiers see loan balances and loan history, but not the ledger itself. Only finance roles can read the ledger (T-31).
4. **Duplicate check:** phone numbers are compared by their digits, so "+231 770…" and "0770…" match. The second phone and the ID number are checked too. Only a manager can create a duplicate, and must give a reason, which is recorded (T-32).
5. **Customer details:** individuals must have an ID type and number; businesses need a contact person.
6. **Customer changes:** only one change per customer can wait for approval at a time. If the record changed after the request, the approval is refused. Blacklisting is an approved change with a reason (T-29).
7. **Loan branch:** loans belong to the customer's branch. A loan officer only applies for customers of their own branch.
8. **Loan approval:** the loan's rules and interest are fixed when it is sent for approval. Up to $2,000 a manager approves; above that, the CEO. The person who created a loan can never approve it (T-17, T-18, T-19).
9. **Payout:** only a cashier pays out a loan. Cash comes from the cashier's own branch account (B-10 default). Payouts are dated today and refused on a closed day or when the account doesn't hold enough (T-23, T-35).
10. **Collateral:** the new-loan form requires it (A-10). One item secures only one open loan at a time.
11. **Loan agreement:** numbered AGR-<loan number>. A reprint gives the same number and verification code. The legal text is a marked placeholder for MSI's lawyer.
12. **Demo data:** every demo record goes through the same functions staff use, at the DEMO_DATA dates. Customer, loan and collateral numbers match DEMO_DATA.
13. **Bug fixed in M3:** the final ledger balance check now runs with full rights. Before, a cashier's payout was refused when it was saved, because the check couldn't see the new lines under the cashier's limited rights. A regression test covers it.

---

## 3. Next

**M4 Payments** (FR-10, FR-11, FR-20; tests T-06 allocation, T-10, T-11, T-12, T-25, T-28, T-36, T-37) starts after your approval. B-09 is needed by block M4.2 (field payments).
