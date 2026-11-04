import { z } from "zod";

import { ROLES } from "@/lib/permissions";

/*
 * Form schemas shared by the settings forms (client validation) and the server actions (which
 * validate again). Messages are keys under "settings.validation".
 */
const required = (max: number) =>
  z.string().trim().min(1, { message: "required" }).max(max, { message: "tooLong" });
const optional = (max: number) => z.string().trim().max(max, { message: "tooLong" });
const amount = z
  .string()
  .trim()
  .regex(/^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/, { message: "amount" });

export const companySchema = z.object({
  name: required(120),
  shortName: required(20),
  address: optional(300),
  phone: optional(60),
  email: z.union([z.literal(""), z.email({ message: "email" }).max(200, { message: "tooLong" })]),
  receiptFooter: optional(200),
});
export type CompanyValues = z.infer<typeof companySchema>;

export const templatesSchema = z.object({
  reminder: required(2000),
  reminderOverdue: required(2000),
});
export type TemplatesValues = z.infer<typeof templatesSchema>;

export const branchSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, { message: "code" })),
  name: required(100),
  address: optional(300),
  phone: optional(40),
  active: z.boolean(),
});
export type BranchValues = z.input<typeof branchSchema>;

const COMPONENTS = ["penalty", "interest", "principal"] as const;
export type AllocationComponent = (typeof COMPONENTS)[number];

export const rulesSchema = z.object({
  loanManagerLimit: amount,
  expenseLimit: amount,
  collateralRequired: z.boolean(),
  multiLoan: z.boolean(),
  extensionEnabled: z.boolean(),
  requireRemittance: z.boolean(),
  dayClosesEnforce: z.boolean(),
  checkFunds: z.boolean(),
  allocationOrder: z
    .array(z.enum(COMPONENTS))
    .length(3)
    .refine((order) => new Set(order).size === 3, { message: "allocation" }),
  goLiveDate: z.union([z.literal(""), z.iso.date({ message: "date" })]),
});
export type RulesValues = z.infer<typeof rulesSchema>;

export const clockSchema = z
  .object({
    useRealTime: z.boolean(),
    at: z.string(),
    frozen: z.boolean(),
  })
  .refine((value) => value.useRealTime || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.at), {
    message: "timestamp",
    path: ["at"],
  });
export type ClockValues = z.infer<typeof clockSchema>;

const userFields = {
  fullName: required(120),
  phone: optional(40),
  role: z.enum(ROLES),
  branchId: z.union([z.literal(""), z.uuid()]),
};

const branchRule = <T extends { role: (typeof ROLES)[number]; branchId: string }>(value: T) =>
  value.branchId !== "" || !["cashier", "loan_officer"].includes(value.role);

export const newUserSchema = z
  .object({ ...userFields, email: z.email({ message: "email" }).max(200, { message: "tooLong" }) })
  .refine(branchRule, { message: "branchRequired", path: ["branchId"] });
export type NewUserValues = z.infer<typeof newUserSchema>;

export const userSchema = z
  .object({ ...userFields, id: z.uuid(), active: z.boolean() })
  .refine(branchRule, { message: "branchRequired", path: ["branchId"] });
export type UserValues = z.infer<typeof userSchema>;
