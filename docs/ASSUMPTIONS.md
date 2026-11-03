# Assumptions awaiting client sign-off

Generated from SPEC section 2.3. Each row is a default the system implements until MSI confirms or corrects it. Do not hard-code any of them.

| ID | Assumption (default implemented) | Setting key | Needs sign-off from | Client decision | Date |
| --- | --- | --- | --- | --- | --- |
| A-01 | Operating currency is USD (`$`). LRD not enabled in MVP | `currency.base`=`USD` | CEO |  |  |
| A-02 | Default term is 1 month; `due_date = disbursed_on + term_months` calendar months, clamped to month end (31 Jan + 1 month = 28 Feb) | `product.default_term_months`=1 | Manager |  |  |
| A-03 | Interest = `principal × rate_bps/10000 × term_months`, flat, charged in full at disbursement and recognised as income then (accrual basis) | `product.interest_rate_bps`=2000 | Accountant |  |  |
| A-04 | Repayment is flexible: any number of partial payments before or after due date; no instalment schedule | n/a | Manager |  |  |
| A-05 | Allocation order: penalties, then interest, then principal. Overpayment is rejected | `payments.allocation_order` | Accountant |  |  |
| A-06 | Penalty = 20% (`penalty_rate_bps`=2000) of the **outstanding total due** at each 7-day mark after due date (compounding), maximum 4 charges | `product.penalty_base`=`outstanding_total`, `penalty_period_days`=7, `penalty_max_periods`=4 | CEO + lawyer |  |  |
| A-07 | Loans ≤ `$2,000` approved by manager; above, by CEO. Creator cannot approve own loan | `approvals.loan_manager_limit_cents`=200000 | CEO |  |  |
| A-08 | Recovery becomes eligible 30 days after due date; a manager opens the case. Penalties stop after the 4th charge or when a case opens, whichever is first | `product.recovery_after_days`=30 | CEO |  |  |
| A-09 | Extension: manager approves; adds `principal_outstanding × rate_bps × extra_months` as interest; due date moves by `extra_months`; accrued penalties stay; penalty counter resets to 0 | `extension.enabled`=true | Manager |  |  |
| A-10 | Collateral is mandatory for every loan; guarantors optional; one collateral item secures one active loan at a time | `loans.collateral_required`=true, `collateral.multi_loan`=false | Manager |  |  |
| A-11 | Loan officers and managers may create customers directly; any edit to an existing customer goes through approval (manager) | n/a | Manager |  |  |
| A-12 | Field collections post to "Field Cash (unremitted)" until the cashier confirms handover; receipts to the borrower are issued immediately | `field.require_remittance`=true | Manager |  |  |
| A-13 | Write-off posts the whole outstanding to Bad Debts Expense (direct write-off, no allowance); needs CEO approval and board reference text | n/a | Accountant |  |  |
| A-14 | Collateral sale proceeds apply in allocation order; surplus is recorded as a liability owed to the borrower (account 2100); shortfall remains outstanding until written off | n/a | CEO |  |  |
| A-15 | Accounting basis: accrual (interest at disbursement, penalties when charged). Accountant to confirm vs cash basis | `accounting.basis`=`accrual` | Accountant |  |  |
| A-16 | Receipt/document numbering is per branch and sequential, never reused | n/a | Manager |  |  |
| A-17 | No loan fees in MVP (processing/application) | `product.fees`=[] | Manager |  |  |
| A-18 | Day close is mandatory per branch per day (submitted by the cashier); an approved close locks that date for the branch; a manager can reopen it with a reason | `daycloses.enforce`=true | Manager |  |  |
| A-19 | Back-dated entry allowed only for roles admin/accountant, only before `go_live_date`; after that all postings are dated today | `migration.go_live_date` | Accountant |  |  |
| A-20 | Expenses above `$100` need manager approval; below, accountant records directly | `approvals.expense_limit_cents`=10000 | Manager |  |  |
