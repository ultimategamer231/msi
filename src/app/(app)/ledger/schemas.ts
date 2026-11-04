import { z } from "zod";

import { parseDollarsToCents } from "@/lib/money-input";

/* Manual journal request form (R11). Messages are keys under "ledger.manual" or "settings.validation". */
const amount = z.string().trim();

export const manualLineSchema = z
  .object({
    account: z.string().regex(/^[0-9]{4}(-[A-Z][A-Z0-9]{1,9})?$/, { message: "accountRequired" }),
    debit: amount,
    credit: amount,
  })
  .refine(
    (line) => {
      const debit = line.debit === "" ? null : parseDollarsToCents(line.debit);
      const credit = line.credit === "" ? null : parseDollarsToCents(line.credit);
      const debitSet = debit !== null && debit > 0n;
      const creditSet = credit !== null && credit > 0n;
      const debitValid = line.debit === "" || debit !== null;
      const creditValid = line.credit === "" || credit !== null;
      return debitValid && creditValid && debitSet !== creditSet;
    },
    { message: "lineError", path: ["debit"] },
  );

export const manualJournalSchema = z.object({
  entryDate: z.iso.date({ message: "date" }),
  memo: z.string().trim().min(1, { message: "required" }).max(500, { message: "tooLong" }),
  branchId: z.union([z.literal(""), z.uuid()]),
  lines: z.array(manualLineSchema).min(2, { message: "minLines" }).max(30),
});

export type ManualJournalValues = z.infer<typeof manualJournalSchema>;
