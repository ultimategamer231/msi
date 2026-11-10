# Demo dataset (`pnpm seed:demo`)

This is the hand-checked dataset behind every mock-up and the M8 report acceptance. All names and numbers are fictional.

## Rules

- **Anchor date.** The seed takes `--as-of <date>` (default: today). Every date below is written relative to the anchor **A = 12 Feb 2026** and shifts with it, so the relationships hold (for example "due A−7"). Screenshots for mock-up comparison use `--as-of 2026-02-12`. Due dates are fixed relative to A; each paid-out date is its due date minus the loan term (1 month), so for other anchors the paid-out offsets can differ by a day or two while every status (due today, 7 and 21 days overdue, recovery eligibility) still holds.
- **How it is built.** The seed writes history only through the RPCs (`disburse_loan`, `receive_payment`, `record_field_payment`, `run_daily_accruals` for each past day, and so on) with the pre-go-live back-dating allowance. It never inserts journals directly, so the ledger, balances and audit log are real.
- **Seeded state.** The morning of A, before 09:10. Mariama Kollie's $500 payment at 14:52 is **not** seeded; it is the e2e script `e2e/demo-payment.spec.ts`, which must take her loan from $1,440.00 to $940.00 and issue RCT-BR2-000123.
- **Passwords.** Generated at seed time, printed once to the console, never committed.
- **Reproducible.** Running the seed twice on an empty database gives identical numbers, document numbers and statuses.

## Branches

| Code | Name | Opening cash on A−1 |
| --- | --- | --- |
| BR1 | Jallah Town Branch (main) | $5,000.00 |
| BR2 | Margibi Branch | $2,000.00 |
| BR3 | Nimba Branch | $3,000.00 |

Names and addresses from MSI (09 Nov 2026). The mock-ups were drawn with the earlier placeholder names ("Main", "Branch 2", "Branch 3"); screens now show MSI's names.

## Users

| Name | Role | Branch |
| --- | --- | --- |
| Musa Kanneh | CEO | All |
| Rebecca Wolo | Manager | All |
| Grace Flomo | Cashier | BR2 |
| Emmanuel Tarpeh | Loan officer | BR2 |
| Ruth Browne | Loan officer | BR1 |
| David Kerkula | Loan officer | BR3 |
| Peter Zayzay | Accountant | All |
| Corex Admin | Admin | All |

## Loans (state on the morning of A)

Product: Standard 1-month, 20% flat. Penalty: 20% of the amount owed on each 7th day after the due date, up to 4.

| Loan | Customer | Officer | Lent | Paid out | Due | Status on A | Penalties charged | Owes |
| --- | --- | --- | ---: | --- | --- | --- | --- | ---: |
| LN-BR1-00014 | Kpanah Mulbah | Ruth Browne | 2,500.00 | – | – | Pending CEO approval (above the $2,000 manager limit) | – | 0.00 |
| LN-BR2-00010 | Hawa Dukuly | Emmanuel Tarpeh | 500.00 | A−1 | A+27 (11 Mar) | Active | – | 600.00 |
| LN-BR2-00009 | Mariama Kollie (CU-000008) | Emmanuel Tarpeh | 1,000.00 | A−38 (05 Jan) | A−7 (05 Feb) | Overdue 7 days | 240.00 on A | 1,440.00 |
| LN-BR2-00008 | Esther Toe | Emmanuel Tarpeh | 500.00 | A−52 (22 Dec) | A−21 (22 Jan) | Overdue 21 days | 120.00 (A−14), 144.00 (A−7), 172.80 (A) | 1,036.80 |
| LN-BR2-00007 | Joseph B. Gbessay | Emmanuel Tarpeh | 600.00 | A−31 (12 Jan) | A (12 Feb) | Due today | – | 720.00 |
| LN-BR3-00005 | Fatu Kamara | David Kerkula | 400.00 | A−23 (20 Jan) | A+8 (20 Feb) | Active | – | 480.00 |
| LN-BR3-00004 | Mohammed Sheriff | David Kerkula | 1,500.00 | A−69 (05 Dec) | A−38 (05 Jan) | Recovery (case RC-000001) | 360.00, 432.00, 518.40, 622.08 (A−31, A−24, A−17, A−10) | 3,732.48 |
| LN-BR1-00013 | Dolo & Sons Trading (business) | Ruth Browne | 1,800.00 | A−15 (28 Jan) | A+16 (28 Feb) | Active | – | 2,160.00 |
| LN-BR1-00011 | Prince Karmo | Ruth Browne | 700.00 | A−59 (15 Dec) | A−28 (15 Jan) | Closed A−28 | – | 0.00 |
| LN-BR2-00012 | Alieu Sesay | Emmanuel Tarpeh | 250.00 | A−32 (11 Jan) | A−1 (11 Feb) | Closed A−1 | – | 0.00 |
| LN-BR2-00006 | Musu Freeman | Emmanuel Tarpeh | 500.00 | A−30 (13 Jan) | A+1 (13 Feb) | Closed A−1 | – | 0.00 |
| LN-BR2-00003 | Comfort Weah | Emmanuel Tarpeh | 125.00 | A−33 (10 Jan) | A−2 (10 Feb) | Closed A−1 (paid 1 day late, before any penalty) | – | 0.00 |
| LN-BR2-00002 | Mariama Kollie | Emmanuel Tarpeh | 300.00 | Nov 2025 | 10 Dec 2025 | Closed Dec 2025 | – | 0.00 |

Totals on A: **7 open loans, $10,169.28 outstanding**. Overdue including recovery: **$6,209.28 (61.1%)** across Mariama, Esther and Mohammed. Overdue excluding recovery: $2,476.80. In recovery: $3,732.48.

Overdue by age: 1–7 days $1,440.00 (principal 1,000, interest 200, penalties 240); 8–30 days $1,036.80 (500, 100, 436.80); 31+ days $3,732.48 (1,500, 300, 1,932.48). Totals: principal 3,000.00, interest 600.00, penalties 2,609.28.

Penalty bases follow the as-of rule (SPEC 5.2). Esther: 600 → 720 → 864 → 1,036.80. Mohammed: 1,800 → 2,160 → 2,592 → 3,110.40 → 3,732.48 (4 of 4, penalties stop).

## Payments

| Receipt | Date and time | Loan | Amount | Method | Taken by | Note |
| --- | --- | --- | ---: | --- | --- | --- |
| (earlier receipts) | before A−1 | LN-BR1-00011 840.00; LN-BR2-00012 100.00; LN-BR2-00006 250.00; LN-BR2-00002 360.00 | | cash | | Numbers below 000120, any order |
| RCT-BR2-000120 | A−1 | LN-BR2-00006 Musu Freeman | 350.00 | cash, field | Emmanuel Tarpeh | Final repayment; **not yet remitted** (cash still with the officer) |
| RCT-BR2-000121 | A−1 09:20 | LN-BR2-00012 Alieu Sesay | 200.00 | cash | Grace Flomo | Final repayment |
| RCT-BR2-000122 | A−1 15:10 | LN-BR2-00003 Comfort Weah | 150.00 | cash | Grace Flomo | Final repayment |
| RCT-BR2-000123 | A 14:52 | LN-BR2-00009 Mariama Kollie | 500.00 | mobile money, ref OM-7731904 | Grace Flomo | **e2e script only**; allocates penalty 240.00, interest 200.00, principal 60.00; owes 940.00 after |

Collected on A−1: $700.00 in 3 receipts, $350.00 of it still with the officer.

## Collateral

| Item | Description | Identifier | Owner | Loan | Location | Value | Status |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| COL-000034 | Land deed | Deed no. D-4410 | Kpanah Mulbah | LN-BR1-00014 | Main vault | 5,500.00 | Held |
| COL-000033 | Sewing machine | S/N SM-7712 | Hawa Dukuly | LN-BR2-00010 | Branch 2 safe | 700.00 | Held |
| COL-000032 | Rice, 40 bags | none | Joseph B. Gbessay | LN-BR2-00007 | Branch 2 store | 1,100.00 | Held |
| COL-000031 | Honda EU22i generator | S/N GA-1000231 | Mariama Kollie | LN-BR2-00009 | Branch 2 safe, shelf B2 | 1,400.00 | Held |
| COL-000030 | Toyota Corolla 2008 | Plate BRK 4821 | Mohammed Sheriff | LN-BR3-00004 | Branch 3 yard | 4,200.00 | In recovery |
| COL-000029 | Land deed | Deed no. D-2217 | Dolo & Sons Trading | LN-BR1-00013 | Main vault | 6,000.00 | Held |
| COL-000028 | Flat-screen TV, 55 in | S/N TV-55-80412 | Esther Toe | LN-BR2-00008 | Branch 2 safe | 450.00 | Held |
| COL-000027 | Motorbike | Plate MB 3307 | Fatu Kamara | LN-BR3-00005 | Branch 3 office | 900.00 | Held |
| COL-000026 | Laptop | S/N LT-5521-9 | Prince Karmo | LN-BR1-00011 | Returned A−23 | 600.00 | Released |
| COL-000025 | Chest freezer | S/N CF-20931 | Alieu Sesay | LN-BR2-00012 | Returned A−1 | 400.00 | Released |
| COL-000024 | Mobile phone | IMEI 3561 0902 7781 | Comfort Weah | LN-BR2-00003 | Returned A−1 | 200.00 | Released |
| COL-000022 | Sewing machine | S/N SM-4410 | Musu Freeman | LN-BR2-00006 | Branch 2 safe | 650.00 | Ready to return |
| COL-000019 | Mobile phone | – | Mariama Kollie | LN-BR2-00002 | Returned Dec 2025 | 250.00 | Released |

Custody log for COL-000031 (A−38): 14:10 received from Mariama Kollie by Grace Flomo; 14:25 valued at $1,400.00 by Rebecca Wolo; 15:00 moved from office desk to Branch 2 safe, shelf B2 by Grace Flomo.

## Customer details used on screens

Mariama Kollie: phone 0770 555 010, Montserrado County, National ID LR-0012345, market trader, registered 02 Oct 2025, next of kin and guarantor Joseph Kollie (brother) 0770 555 014. Phones for others: Esther Toe 0770 555 021, Joseph B. Gbessay 0770 555 033, Fatu Kamara 0770 555 047.

## Approvals waiting on A

| Type | Subject | Requested by | When | For |
| --- | --- | --- | --- | --- |
| Customer edit | Mariama Kollie phone 0770 555 010 → 0770 555 011 | Emmanuel Tarpeh | A, about 07:10 | Manager |
| Extension | LN-BR2-00007, 1 month (due A → A+28), reason "Shop stock delayed at port"; adds $120.00 | Emmanuel Tarpeh | A−1 16:40 | Manager |
| Expense | Court filing fee $240.00, LN-BR3-00004, Branch 3 cash (above the $100 limit) | Peter Zayzay | A 08:15 | Manager |
| Loan | LN-BR1-00014 Kpanah Mulbah $2,500.00 | Ruth Browne | A−1 | CEO |

## Recovery case RC-000001 (Mohammed Sheriff, LN-BR3-00004)

Opened A−8 (04 Feb) by Rebecca Wolo, the first eligible day (due + 30). Demand notice sent A−5 by David Kerkula, delivered by hand. Next stage: court filed (waiting on the $240.00 expense). Sale preview at $3,000.00 allocates penalty 1,932.48, interest 300.00, principal 767.52, leaving a $732.48 shortfall.

## Day close, Branch 2, A−1 (not yet closed)

Opening 2,000.00 + cash receipts 350.00 (RCT-BR2-000121, 000122) − disbursement 500.00 (LN-BR2-00010) − expense 45.00 (EXP-BR2-000031, office supplies, 13:40) = **expected 1,805.00**. Counted 1,795.00, variance −10.00, reason "Short change given on a repayment, to be checked with the cashier." Field cash of 350.00 (RCT-BR2-000120) is excluded until remitted.
