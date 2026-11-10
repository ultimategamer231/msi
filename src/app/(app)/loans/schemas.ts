import { z } from "zod";

import { guarantorsSchema } from "@/lib/guarantors";
import { parseDollarsToCents } from "@/lib/money-input";

/*
 * New loan wizard (SPEC 9 /loans/new; FR-07). The database checks everything again
 * (check_loan_application, submit_loan); these rules give early feedback per step. Messages are
 * keys under "loans.validation".
 */
export const COLLATERAL_TYPES = [
  "vehicle",
  "land_document",
  "gold",
  "valuables",
  "electronics",
  "goods",
  "savings_lien",
  "other",
] as const;

const money = z
  .string()
  .trim()
  .refine(
    (value) => {
      const cents = parseDollarsToCents(value);
      return cents !== null && cents > 0n;
    },
    { message: "amount" },
  );

export const termsSchema = z.object({
  productId: z.uuid({ message: "required" }),
  principal: money,
  termMonths: z.string().regex(/^\d{1,2}$/, { message: "term" }),
  purpose: z.string().trim().max(300, { message: "tooLong" }),
});
export type TermsValues = z.infer<typeof termsSchema>;

export const newCollateralSchema = z.object({
  type: z.enum(COLLATERAL_TYPES),
  description: z.string().trim().min(1, { message: "required" }).max(200, { message: "tooLong" }),
  serialNo: z.string().trim().max(80, { message: "tooLong" }),
  plateNo: z.string().trim().max(40, { message: "tooLong" }),
  documentNo: z.string().trim().max(80, { message: "tooLong" }),
  value: money,
  location: z.string().trim().max(200, { message: "tooLong" }),
});
export type NewCollateralValues = z.infer<typeof newCollateralSchema>;

export const emptyCollateral: NewCollateralValues = {
  type: "electronics",
  description: "",
  serialNo: "",
  plateNo: "",
  documentNo: "",
  value: "",
  location: "",
};

export const applicationSchema = z.object({
  customerId: z.uuid(),
  officerId: z.union([z.literal(""), z.uuid()]),
  terms: termsSchema,
  collateralIds: z.array(z.uuid()).max(5),
  newCollateral: z.array(newCollateralSchema).max(5),
  guarantors: guarantorsSchema,
  guarantorDocs: z
    .array(z.union([z.null(), z.object({ storagePath: z.string(), fileName: z.string() })]))
    .max(3),
});
export type ApplicationValues = z.infer<typeof applicationSchema>;
