import { z } from "zod";

import { parseDollarsToCents } from "@/lib/money-input";

/*
 * Receive payment (SPEC 9 /payments/new; FR-10). The database checks everything again
 * (receive_payment: amount, method, reference, overpayment, date); these rules give early
 * feedback. Messages are keys under "payments.validation".
 */
export const PAYMENT_METHODS = ["cash", "mobile_money", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const paymentSchema = z
  .object({
    loanId: z.string().regex(/^[0-9a-f-]{36}$/, { message: "loan" }),
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
    method: z.enum(PAYMENT_METHODS, { message: "method" }),
    reference: z.string().trim().max(100, { message: "referenceLong" }),
    requestKey: z.string().min(8).max(100),
  })
  .refine((values) => values.method === "cash" || values.reference.length >= 4, {
    message: "reference",
    path: ["reference"],
  });

export type PaymentValues = z.input<typeof paymentSchema>;
