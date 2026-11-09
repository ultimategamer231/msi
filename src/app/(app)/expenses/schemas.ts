import { z } from "zod";

import { parseDollarsToCents } from "@/lib/money-input";

/* Expense and payee forms (SPEC 7.6; FR-22). Messages are keys under "expenses.validation". */
export const PAYEE_TYPES = ["supplier", "landlord", "utility", "other"] as const;
const accountCode = /^[0-9]{4}(-[A-Z][A-Z0-9]{1,9})?$/;

export const expenseSchema = z
  .object({
    account: z.string().regex(/^5[0-9]{3}$/, { message: "account" }),
    amount: z
      .string()
      .trim()
      .refine(
        (value) => {
          const cents = parseDollarsToCents(value);
          return cents !== null && cents > 0n;
        },
        { message: "amount" },
      ),
    expenseDate: z.iso.date({ message: "date" }),
    description: z.string().trim().min(3, { message: "description" }).max(300, { message: "description" }),
    branchId: z.union([z.literal(""), z.uuid()]),
    payeeId: z.union([z.literal(""), z.uuid()]),
    paidNow: z.boolean(),
    paidFrom: z.union([z.literal(""), z.string().regex(accountCode)]),
  })
  .refine((values) => !values.paidNow || values.paidFrom !== "", { message: "paidFrom", path: ["paidFrom"] })
  .refine((values) => values.paidNow || values.payeeId !== "", { message: "payee", path: ["payeeId"] });

export type ExpenseValues = z.infer<typeof expenseSchema>;

export const payeeSchema = z.object({
  name: z.string().trim().min(2, { message: "name" }).max(120, { message: "name" }),
  type: z.enum(PAYEE_TYPES),
  phone: z.string().trim().max(30, { message: "phone" }),
  notes: z.string().trim().max(500, { message: "notes" }),
  active: z.boolean(),
});

export type PayeeValues = z.infer<typeof payeeSchema>;
