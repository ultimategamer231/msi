import { z } from "zod";

/*
 * Guarantors of a loan (SPEC 7.2; FR-05): optional, at most 3. Same rules as clean_guarantors()
 * in SQL, which validates again. Messages are keys under "guarantors.validation".
 */
export const GUARANTOR_ID_TYPES = [
  "national_id",
  "passport",
  "voter_card",
  "drivers_license",
  "other",
] as const;
export const MAX_GUARANTORS = 3;

const digits = (value: string) => value.replace(/\D/g, "").length;

export const guarantorSchema = z
  .object({
    fullName: z.string().trim().min(1, { message: "required" }).max(120, { message: "tooLong" }),
    phone: z
      .string()
      .trim()
      .refine((value) => digits(value) >= 7 && digits(value) <= 15, { message: "phone" }),
    relationship: z.string().trim().max(60, { message: "tooLong" }),
    address: z.string().trim().max(300, { message: "tooLong" }),
    idType: z.union([z.literal(""), z.enum(GUARANTOR_ID_TYPES)]),
    idNumber: z.string().trim().max(120, { message: "tooLong" }),
  })
  .superRefine((values, context) => {
    if (values.idType !== "" && values.idNumber === "") {
      context.addIssue({ code: "custom", path: ["idNumber"], message: "required" });
    }
    if (values.idType === "" && values.idNumber !== "") {
      context.addIssue({ code: "custom", path: ["idType"], message: "required" });
    }
  });

export const guarantorsSchema = z.array(guarantorSchema).max(MAX_GUARANTORS, { message: "tooMany" });

export type GuarantorValues = z.infer<typeof guarantorSchema>;

export const emptyGuarantor: GuarantorValues = {
  fullName: "",
  phone: "",
  relationship: "",
  address: "",
  idType: "",
  idNumber: "",
};

/** RPC payload for clean_guarantors(): column names, blanks as null. */
export function guarantorPayload(values: GuarantorValues) {
  const blank = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    full_name: values.fullName.trim(),
    phone: values.phone.trim(),
    relationship: blank(values.relationship),
    address: blank(values.address),
    id_type: values.idType === "" ? null : values.idType,
    id_number: blank(values.idNumber),
  };
}
