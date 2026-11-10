# LoanDesk User Guide

**Method Solutions Inc. · Staff handbook**

This handbook explains how to do your daily work in LoanDesk. Read Part 1 first. After that, go straight to the part for your job, and keep the handbook nearby for the tasks you do less often.

| If you are a… | Read |
| --- | --- |
| Loan officer | Parts 1, 2, 3, 4, 6, 7 |
| Cashier | Parts 1, 3, 5, 6, 8, 12 |
| Manager | Parts 1 to 13 (you approve most requests) |
| CEO | Parts 1, 10, 11, 14 |
| Accountant | Parts 1, 11, 13, 14, 15 |
| Administrator | Parts 1 and 16 |

---

## Part 1. The basics

### Signing in

1. Open LoanDesk in your browser: Chrome, Edge or Safari, on a computer or a phone.
2. Enter your work email and password, then press **Sign in**.

Some things to know:

- **No sign-up page.** The administrator creates every account. If you have no account, or have forgotten your password, ask the administrator.
- **Lockout.** After five wrong passwords in a row, the account is locked for 15 minutes. Wait, then try again.
- **12-hour sessions.** You are signed out automatically after 12 hours. Sign in again at the start of each working day.
- **Signing out.** Press the sign-out icon next to your name, in the bottom-left corner of a computer screen or under **More** on a phone. Always sign out on a shared computer.

### Finding your way around

**On a computer**, the menu is on the left. **On a phone**, the main pages are in the bar at the bottom, and everything else is under **More**. You only see the pages your role can use.

The top of every page shows:

- **Your branch.** Staff without a branch see "All branches".
- **Approvals.** The number tells you how many requests are waiting for you to decide.

### Money and dates

- **Money** is shown in US dollars, for example `$1,234.56`. Type amounts without the dollar sign: `1234.56` or `1,234.56` both work.
- **Dates** look like `05 Feb 2026`, in Liberia time.
- **The system's date.** Everything is dated "today", the business date shown on your dashboard.

### Nothing is ever deleted

LoanDesk keeps a full history:

- A wrong payment is **voided**: it is reversed, and the receipt is marked VOID.
- A wrong journal is **reversed**.
- Collateral movements stay in the custody log forever.

Most corrections need a second person to approve them. This protects both you and the company.

### When something needs approval

Some actions are not final until someone else approves them:

- new loans;
- customer changes;
- extensions;
- voids;
- write-offs;
- large expenses;
- day closes.

After you send a request, the screen tells you it is waiting. You cannot approve your own request, even as a manager.

---

## Part 2. Customers

### Registering a new customer

*Loan officers and managers.*

1. Go to **Customers** and press **New customer**.
2. Choose **Individual** or **Business**.
3. Fill in the name, phone number and ID type and number. Fields marked optional can be left empty.
4. Add the customer's photo and a scan of their ID if you have them. Photos taken with a phone are fine.
5. Press **Save customer**. The new customer's page opens with their customer number, for example `CU-000123`.

**If the system warns about a possible duplicate**, a customer with the same phone or ID number already exists. Open the existing record instead of creating a second one. Only a manager can save a duplicate, and must give a reason.

### Changing a customer's details

You cannot edit a customer directly; every change is checked by a manager.

1. Open the customer and press **Request edit**.
2. Change what is needed, give the reason, and send.
3. The change appears once a manager approves it in **Approvals**.

To find a customer, type part of their name, phone number, ID number or customer number into the search box on **Customers**.

---

## Part 3. Loans

### Applying for a loan

*Loan officers and managers.*

1. Open the customer and press **New loan**.
   - Or go to **Loans** → **New loan** and pick the customer.
2. **Amount and term.** Enter the amount to lend.
   - The box on the right shows the interest, the total to repay, the due date and the first penalty if the loan is late.
   - It also says whether a manager or the CEO must approve it.
3. **Collateral.** Every loan needs at least one item.
   - Pick an item the customer already has with us, or press **Add a new item**.
   - Enter its type, description, any serial, plate or document number, its estimated value and where it is kept.
4. **Guarantors** are optional. Add their name, phone and relationship, and a scan of their ID if you have one.
5. **Check and send.** Read everything once more, then press **Send for approval**.

**Approval limits.** A manager approves loans up to $2,000.00. Larger loans go to the CEO. The person who prepared the loan can never approve it.

### Approving a loan

*Managers and the CEO.*

1. Open **Approvals**. Each request is a card.
2. Read the loan card: borrower, amount and collateral. Open the loan if you need more detail.
3. Press **Approve**, or **Reject** with a reason. A rejection asks you to confirm.

### Paying out an approved loan

*Cashiers.*

1. Open the loan. Its status reads "Approved, not paid out".
2. Under **Pay out this loan**, choose how it is paid: **Cash**, **Mobile money**, **Bank** or **Cheque**.
   - Cash comes from your branch drawer.
   - Bank and cheque payouts come from the bank account (1020).
   - Mobile money comes from 1030.
   - For a cheque, type the cheque number. It is kept with the payout.
3. Press **Pay out**, check the amount and account in the message, then press **Yes, pay out**.

The loan becomes **Active**. Interest is charged once, at payout, and the due date is set: one month after payout for the standard product.

### Reading the loan page

The loan page shows everything about one loan:

- **Amount lent**, **Interest**, **Penalties** and **Paid so far**.
- **Outstanding:** what is owed now, split into principal, interest and penalties. If the loan is late, it also shows the date and amount of the next penalty.
- **Activity:** every movement, newest first.
- **Collateral** and **Guarantors**.
- **Documents:** the loan agreement, the statement of account and, for late loans, the demand notice. All are PDFs with a QR code.

### Cancelling a loan

A loan that has not been paid out can be cancelled with **Cancel loan**. After approval, a reason is required. A paid-out loan cannot be cancelled.

---

## Part 4. Penalties, due dates and extensions

### How penalties work

If a loan is not fully paid by its due date:

- **It becomes overdue** the next day.
- **Each penalty** is 20% of everything owed at that moment.
- **When penalties are charged:** on day 7 after the due date, and again on days 14, 21 and 28. That is four penalties at most.
- **After that, recovery:** from day 30 the loan can be moved to recovery (Part 10).

The system charges penalties by itself every night at 01:00. Nobody needs to press anything.

**Payments are applied in a fixed order:** penalties first, then interest, then the amount lent.

### The due and overdue list

**Due and overdue** has three tabs: due today, due soon (next 7 days) and overdue. Each row has the amount owed and buttons to call or send a WhatsApp reminder.

- **Reminder** opens WhatsApp on your phone with a ready-made, polite message. Check it, then press send in WhatsApp. The system only notes that a reminder was opened; nothing is sent automatically.

### Extending a loan

*Loan officers (own branch) and managers.*

1. Open the loan and press **Extend loan**.
2. Choose the extra time and give the reason, then press **Send for approval**.
3. Another manager or the CEO approves it. On approval:
   - interest for the extra months is added on the amount lent still owed;
   - the due date moves;
   - penalties already charged stay.

Only special arrangements go beyond one month. Discuss them with the manager first.

---

## Part 5. Receiving payments

*Cashiers and managers.*

### At the counter

1. Open the loan and press **Receive payment**, or go to **Payments** → **Receive payment** and find the loan.
2. Enter the amount received.
   - The **Allocation preview** shows how it will be split: penalty, interest, then the amount lent.
   - You cannot take more than is owed. The system refuses an overpayment.
3. Choose the method:
   - **Cash**
   - **Mobile money** (Orange Money or MTN MoMo): type the transaction ID.
   - **Bank**: type the slip or transfer reference.
   - **Cheque**: type the cheque number. The money goes to the bank account.
4. Press **Receive payment**. The receipt opens.

### The receipt

The receipt shows:

- the receipt number, date, borrower and loan;
- the method and the amount, also written out in words ("The sum of…");
- the purpose, and how the amount was applied;
- the balance after the payment;
- signature lines and a QR code.

To print it, use the buttons under the receipt:

- **Print A5**: half an A4 sheet. Use it with the office A4 printer.
- **Print 80 mm**: for a receipt printer, if one is added later.
- **PDF**: to save or send.

Give the borrower the receipt. They can scan the QR code at any time to check that it is genuine.

### Voiding a wrong payment

If a payment was entered on the wrong loan or for the wrong amount:

1. Go to **Payments**, find the receipt and press **Request void**.
2. Give the reason and press **Send for approval**.
3. A different manager or the CEO approves it. The payment is reversed, and the receipt prints with a VOID stamp.

Then enter the payment again correctly.

---

## Part 6. Field collections

### Loan officers: collecting in the field

1. Open **Today**. It lists your borrowers who are due today or overdue, with what each owes.
2. At the customer, press **Collect**, enter the amount and method, and press **Save payment and issue receipt**.
   - Cash, mobile money and bank transfers are accepted in the field.
   - **Cheques are taken at the office only.**
3. The borrower gets a receipt straight away: show it on your phone or print it later.

Cash you collect stays "with you" until the cashier confirms you handed it over. **Today** shows how much field cash you are holding. Hand it over the same day.

### Cashiers: confirming the handover

1. Go to **Field cash**.
2. Tick the collections the officer is handing over.
3. Count the cash, enter the total in **Counted cash** and press **Confirm handover**.

The total must match the ticked receipts. If it does not, count again before confirming.

---

## Part 7. Collateral

### Registering an item

*Loan officers, cashiers and managers.*

Items are usually added while applying for a loan (Part 3). To add one on its own:

1. Go to **Collateral** → **Register collateral**.
2. Choose the owner and the type:
   - **Vehicle**: cars, motorbikes.
   - **Land document**: land deeds.
   - **Gold**.
   - **Valuables**: jewellery and similar.
   - **Electronics**, **Goods** or **Other**.
3. Enter the description, any identifying number (serial, plate, chassis or deed number), its estimated value and where it is kept. Add photos.

If the same plate, serial or document number is already on another active item, the screen warns you. Check before continuing: one item can only secure one active loan.

### The custody log

Every item has a log of what happened to it:

- received;
- moved (from where, to where, with a witness);
- valued;
- seized;
- returned or sold.

To add an entry, open the item, press **Add custody event**, choose the event and save. Only a manager can change the value or mark an item lost. Entries can never be edited or removed.

### Returning an item to its owner

*Cashiers and managers.*

Once every loan the item secured is closed:

1. Open the item and press **Return to owner**.
2. Enter who collected it, then press **Confirm return**.

### Printouts

Under **Printouts** on the item page:

- **Collateral receipt (PDF):** give it to the owner when you take the item.
- **Release letter (PDF):** available once the item is returned.

---

## Part 8. Day close

At the end of each day, the cashier counts the drawer and closes the day.

### Cashier

1. Go to **Day close**. The page shows:
   - **Opening cash**;
   - every cash movement of the day (receipts, payouts, expenses);
   - **Expected in drawer**.
2. Count the cash in the drawer and type it in **Cash counted in drawer**.
3. The **Variance** shows straight away. If it is not zero, write the reason, for example "Short change given on a repayment".
4. Press **Close day**.

Field cash still with officers is listed under "Not in the drawer". It is not part of today's count until you confirm the handover.

### Manager

1. Open **Day close** (choose the branch and day), or the card in **Approvals**.
2. Check the count and the reason for any variance, then press **Approve** or **Reject**.

Approving **locks** that day for the branch: nothing more can be entered for it.

**If a payment for a closed day turns up later:**

1. The manager opens that day and presses **Reopen day**, with a reason.
2. The cashier enters the payment.
3. The cashier closes the day again.

---

## Part 9. Expenses and payees

*Managers and the accountant.*

### Recording an expense

1. Go to **Expenses** and fill in the **New expense** form:
   - date, expense account, amount and branch;
   - a description;
   - how it was paid.
2. Choose **Paid now** and where the money came from (branch cash, bank or mobile money), or **On credit** if the supplier will be paid later. On credit needs a payee.
3. Attach the receipt if you have it, then press **Save expense**.

Expenses up to **$100.00** are recorded at once. Larger ones wait for a manager who did not record them, or for the CEO.

### Paying a supplier for an expense on credit

1. In **Expenses**, open the **Owed to payees** tab.
2. Choose where the money comes from on that row, and press **Pay payee**.

### Payees

From **Expenses**, follow the **Payees** link:

- to add suppliers, landlords and utilities;
- to correct their details;
- to see how much each one is owed.

---

## Part 10. Recovery and write-off

*Managers and the CEO.*

### Opening a recovery case

From 30 days after the due date, the loan page shows **Open recovery case**. Opening a case:

- **stops** further penalties;
- marks the collateral as seized;
- creates a case, numbered RC-000001 and up.

### Working the case

The case page shows what is owed and the stages:

1. Case opened
2. Demand notice sent
3. Court filed
4. Judgment
5. Disposal: collateral sold, loan settled or written off
6. Closed

Record each step with **Record court step**: what was done, plus an optional court reference and document.

- **Demand notice (PDF).** Print it from the case or the loan page. It states the amount owed and the deadline to pay: 7 days, a setting.

### Selling the collateral

1. Under **Sell collateral**, enter the sale price and the buyer's name.
2. The preview shows how the money will be applied, and whether there is a shortfall or a surplus.
3. Press **Record sale**, then confirm.

- **Surplus.** If the sale brings in more than is owed, the extra belongs to the borrower. Pay it from the case page.
- **Shortfall.** If the sale does not cover the debt, the rest stays on the loan.

### Writing off a loan

1. A manager or the accountant presses **Request write-off** and gives the reason.
2. **Only the CEO** can approve it, and must enter the board reference in the approval box.

If the customer pays later, take the money as a normal payment. It is recorded as a recovery of a written-off loan.

---

## Part 11. Approvals

*Managers and the CEO.*

**Approvals** collects every request in one place:

- loans;
- customer changes;
- extensions;
- payment voids;
- journal reversals;
- manual journals and capital;
- expenses;
- write-offs;
- day closes.

To decide a request:

1. Read the card. It shows who asked, when, and the details of the request.
2. Press **Approve**, or **Reject** with a reason.

Some rules:

- **Own requests.** You never see your own requests as something to decide.
- **CEO only.** Loans above $2,000.00 and all write-offs go to the CEO.
- **Requesters.** Staff who are not approvers use the same page to follow their own requests.

---

## Part 12. Documents and checking them

All official documents are PDFs with a number and a QR code:

| Document | Where to print it |
| --- | --- |
| Loan agreement | Loan page → Documents |
| Statement of account | Loan page, or the customer page for all their loans |
| Demand notice | Loan page (overdue loans) or the recovery case |
| Collateral receipt and release letter | Collateral item → Printouts |
| Receipt | After each payment, or from Payments |

Anyone holding a printed document can scan its QR code to confirm it is genuine. The check page shows only:

- the document number and date;
- the amount;
- the customer's name, partly hidden;
- whether the document was voided.

---

## Part 13. The ledger

*Accountants, managers, the CEO and the administrator.*

**Ledger** lists every journal in posting order. Open one to see its lines.

**Manual journal.** For corrections that have no screen of their own:

1. The accountant fills in the lines (debits must equal credits) and the reason.
2. A manager approves it.

**Record owner capital.** For money the owners put into a cash, bank or mobile money account. It also needs a manager's approval.

**Opening balances.** Only before go-live (Part 16).

---

## Part 14. Reports

*The CEO, managers, the accountant and the administrator.*

Go to **Reports** and choose one:

| Report | What it shows |
| --- | --- |
| Daily collections | Payments received, by method, branch and officer |
| Daily payments (money out) | Payouts, expenses, payee payments, surplus payouts |
| Due loans | Loans due today and in the next days, with phone numbers |
| Overdue balances | Late loans by age (1–7, 8–30, 31+ days) with their collateral |
| Profit and loss | Income and expenses for a period |
| Balance sheet | What the company owns and owes on a date |
| Trial balance | Debit and credit totals of every account |
| Cash position | Cash in each drawer, with officers, in the bank and on mobile money |
| Collateral register | Every item with its status, location, loan and value |

On each report:

1. Set the dates or the branch, then press **Show**.
2. Use **Export CSV** to open the figures in Excel.
3. Use **Print / PDF** for a paper copy.

**Green and red banners.** The balance sheet and the trial balance show a green banner when the books balance. A red banner means something is wrong: stop and tell the accountant.

---

## Part 15. The dashboard

When you sign in, the **Dashboard** shows what matters for your role:

| Role | What you see |
| --- | --- |
| Loan officer | Your loans due today and overdue, and the field cash you still hold |
| Cashier | Today's collections, cash expected in the drawer, field cash not yet confirmed |
| Manager and CEO | Total outstanding, overdue by age, yesterday's collections, approvals waiting, and a **Needs attention** list (recovery cases, large loans waiting for the CEO, day closes, field cash not handed over) |
| Accountant | Cash by account, income this month, expenses waiting, amounts owed to payees |
| Administrator | Go-live date, last nightly run, number of users |

---

## Part 16. Administration

*The administrator only.*

**Settings** has five sections:

- **Company:** name, address, phone, email, logo and the receipt footer. These print on every receipt and document.
- **Branches:** branch names, addresses and phone numbers.
- **Loan products:** interest rate, term, penalty rate and penalty limits.
- **Rules:**
  - approval limits;
  - the expense limit;
  - the due-soon window;
  - the demand-notice deadline;
  - the go-live date;
  - the wording of the loan agreement, demand notice and reminders.
- **Users:**
  - create accounts and give each person one role and, where needed, a branch;
  - deactivate staff who leave: their history stays;
  - reset a forgotten password.

**Audit log.** Every change made in the system is recorded with who, when, and the values before and after. Managers, the CEO and the administrator can read it. Nobody can change it.

### Going live

Before the go-live date:

1. The accountant enters the **opening balances** under **Ledger → Opening balances**: cash, bank, mobile money, amounts owed and capital, from the old books.
2. Existing loans are entered as loans, with their original payout date and each payment received since. Only the accountant and the administrator can use past dates, and only before go-live.
3. Check the trial balance and the balance sheet against the old books.
4. Set the **go-live date** in Settings → Rules.

From that day, every entry is dated today and the old dates are closed.

---

## Daily checklists

**Loan officer**

- [ ] Check **Today** and plan your visits.
- [ ] Send reminders to borrowers due today.
- [ ] Hand all field cash to the cashier before the end of the day.

**Cashier**

- [ ] Take payments and pay out approved loans as they come.
- [ ] Confirm field cash handovers.
- [ ] Count the drawer and **close the day**.

**Manager**

- [ ] Clear **Approvals** during the day.
- [ ] Review and approve each branch's day close.
- [ ] Look at **Needs attention** and the overdue list.

**Accountant**

- [ ] Record expenses with their receipts.
- [ ] Check the trial balance at least once a week, and at month end.

---

## Common questions

**The system says the day is closed.**
The manager must reopen that day first (Part 8).

**It says the amount is more than what is owed.**
Check the amount. A customer cannot pay more than the balance.

**It asks for a reference.**
Mobile money, bank and cheque payments need the transaction ID, slip reference or cheque number.

**I cannot see a page my colleague uses.**
Pages follow your role. Ask the administrator if your role is wrong.

**I approved something by mistake.**
Approvals cannot be undone directly. For a payment, request a void. For a journal, ask the accountant for a reversal. Tell your manager.

**A customer says their receipt is fake.**
Scan the QR code on it. The check page shows whether we issued it and whether it was voided.

**I forgot my password, or I'm locked out.**
After five wrong tries, wait 15 minutes. If you have forgotten your password, ask the administrator to reset it.

*Keep this handbook with the branch. Report anything unclear or wrong to the administrator so the next edition can be corrected.*
