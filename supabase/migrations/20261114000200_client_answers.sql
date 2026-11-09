-- Client answers 2026-11-09 (docs/QUESTIONS.md client items 4, 8, 9):
--  * head-office contact for receipts and letters (address from MSI; phone, WhatsApp and email from MSI's
--    paper voucher, confirmed by Foday);
--  * collateral types: valuables, gold, cars (vehicle) and land deeds (land document): adds gold and
--    valuables;
--  * standard legal wording for the loan agreement and the demand notice ("any standard applicable
--    wordings") replaces the marked placeholders. Only placeholder or pending values are replaced, so
--    anything an admin already changed in Settings is kept.

update public.settings
   set value = value || jsonb_build_object(
         'address', 'Peace Community, Mamba District #1, Margibi County, Liberia',
         'phone', '+231 776 821 919 · WhatsApp +231 880 318 575',
         'email', 'gbeimiem@gmail.com')
 where key = 'company' and value ->> 'address' = '[pending]';

update public.settings
   set value = value || jsonb_build_object('loan_agreement', '1. Repayment. The borrower shall repay the total of {total} (the amount lent plus interest) to {company} on or before the due date shown above. Part payments may be made at any time and are applied first to penalties, then to interest, then to the amount lent.
2. Interest and fees. Interest is charged once, when the loan is paid out, and is included in the total above. No other fee is charged.
3. Late payment. If any amount remains unpaid after the due date, a penalty of {penalty_rate} of the amount then owed is added every {penalty_days} days, up to {penalty_max} times. After that, {company} may begin recovery.
4. Collateral. The borrower pledges the collateral listed below as security for this loan. {company} holds it until the loan is repaid in full and then returns it to the borrower. If the loan is not repaid, {company} may, after written notice, recover the debt under its recovery procedure, including by selling the collateral. Any amount left after the debt and the costs of recovery are paid is returned to the borrower; any shortfall remains owed.
5. Guarantors. Each guarantor named below agrees to pay what the borrower owes under this agreement if the borrower does not.
6. Borrower''s statements. The borrower confirms that the information given is true, that the collateral is the borrower''s own property and free of other claims, and that the borrower will tell {company} of any change of address or phone number.
7. Governing law. This agreement is governed by the laws of the Republic of Liberia. By signing below, the parties confirm that they have read and understood it.')
 where key = 'templates' and value ->> 'loan_agreement' like '[PLACEHOLDER%';
update public.settings
   set value = value || jsonb_build_object('demand_notice', 'Our records show that loan {loan_no} was due for repayment on {due_date} and is now {days_overdue} days overdue. The total amount now owed is {outstanding}, including penalties of {penalties}.
You are hereby required to pay the full amount at {branch} on or before {deadline}.
If payment is not received by that date, {company} will take further steps under the loan agreement to recover the debt, which may include taking possession of and selling the collateral listed below and legal action, without further notice. The costs of recovery may be added to the amount owed.
If you have already paid, please disregard this notice and bring your receipt to the branch.')
 where key = 'templates' and value ->> 'demand_notice' like '[PLACEHOLDER%';

alter table public.collaterals drop constraint collaterals_type_check;
alter table public.collaterals add constraint collaterals_type_check
  check (type in ('vehicle', 'land_document', 'gold', 'valuables', 'electronics', 'goods', 'savings_lien', 'other'));
