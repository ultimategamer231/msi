import { z } from "zod";

/*
 * Customer form (SPEC 5.11, 7.2; FR-03), shared by the new-customer form, the edit request and the
 * server actions. The database validates again (validate_customer); these checks only give early,
 * field-level feedback. Messages are keys under "customers.validation".
 */
export const ID_TYPES = ["national_id", "passport", "voter_card", "drivers_license", "other"] as const;
export const CUSTOMER_STATUSES = ["active", "blacklisted", "archived"] as const;
export const DOCUMENT_KINDS = ["photo", "id_document", "proof_of_address", "other"] as const;

const text = (max: number) => z.string().trim().max(max, { message: "tooLong" });
const phoneDigits = (value: string) => value.replace(/\D/g, "").length;
const phone = z
  .string()
  .trim()
  .max(40, { message: "tooLong" })
  .refine((value) => value === "" || (phoneDigits(value) >= 7 && phoneDigits(value) <= 15), {
    message: "phone",
  });

export const customerSchema = z
  .object({
    type: z.enum(["individual", "business"]),
    firstName: text(120),
    lastName: text(120),
    businessName: text(120),
    registrationNo: text(120),
    contactPerson: text(120),
    phone: phone.refine((value) => value !== "", { message: "required" }),
    phoneAlt: phone,
    address: text(300),
    city: text(120),
    idType: z.union([z.literal(""), z.enum(ID_TYPES)]),
    idNumber: text(120),
    dateOfBirth: z.union([z.literal(""), z.iso.date({ message: "date" })]),
    occupation: text(120),
    employerOrBusiness: text(120),
    nextOfKinName: text(120),
    nextOfKinPhone: phone,
    nextOfKinRelation: text(120),
    branchId: z.union([z.literal(""), z.uuid()]),
    assignedOfficerId: z.union([z.literal(""), z.uuid()]),
    notes: text(1000),
  })
  .superRefine((values, context) => {
    const require = (field: keyof typeof values) => {
      if (values[field] === "") context.addIssue({ code: "custom", path: [field], message: "required" });
    };
    if (values.type === "individual") {
      require("firstName");
      require("lastName");
      require("idType");
      require("idNumber");
    } else {
      require("businessName");
      require("contactPerson");
      if ((values.idType === "") !== (values.idNumber === "")) {
        require(values.idType === "" ? "idType" : "idNumber");
      }
    }
  });

export type CustomerValues = z.infer<typeof customerSchema>;

export const emptyCustomer: CustomerValues = {
  type: "individual",
  firstName: "",
  lastName: "",
  businessName: "",
  registrationNo: "",
  contactPerson: "",
  phone: "",
  phoneAlt: "",
  address: "",
  city: "",
  idType: "",
  idNumber: "",
  dateOfBirth: "",
  occupation: "",
  employerOrBusiness: "",
  nextOfKinName: "",
  nextOfKinPhone: "",
  nextOfKinRelation: "",
  branchId: "",
  assignedOfficerId: "",
  notes: "",
};

/** Form field name to database column (SPEC 7.2). */
export const CUSTOMER_COLUMNS = {
  firstName: "first_name",
  lastName: "last_name",
  businessName: "business_name",
  registrationNo: "registration_no",
  contactPerson: "contact_person",
  phone: "phone",
  phoneAlt: "phone_alt",
  address: "address",
  city: "city",
  idType: "id_type",
  idNumber: "id_number",
  dateOfBirth: "date_of_birth",
  occupation: "occupation",
  employerOrBusiness: "employer_or_business",
  nextOfKinName: "next_of_kin_name",
  nextOfKinPhone: "next_of_kin_phone",
  nextOfKinRelation: "next_of_kin_relation",
  branchId: "branch_id",
  assignedOfficerId: "assigned_officer_id",
  notes: "notes",
} as const satisfies Record<Exclude<keyof CustomerValues, "type">, string>;

/** RPC payload: database column names, blanks as null. Business fields are dropped for individuals and vice versa. */
export function customerPayload(values: CustomerValues): Record<string, string | null> {
  const skip: ReadonlySet<string> =
    values.type === "individual"
      ? new Set(["businessName", "registrationNo", "contactPerson"])
      : new Set(["firstName", "lastName", "dateOfBirth"]);
  const payload: Record<string, string | null> = {};
  for (const [field, column] of Object.entries(CUSTOMER_COLUMNS)) {
    const value = values[field as keyof typeof CUSTOMER_COLUMNS].trim();
    payload[column] = skip.has(field) || value === "" ? null : value;
  }
  return payload;
}

export const duplicateOverrideSchema = z.object({
  reason: z.string().trim().min(1, { message: "required" }).max(300, { message: "tooLong" }),
});

/** A record listed by the duplicate warning (from the DUPLICATE_CUSTOMER error detail). */
export interface DuplicateMatch {
  id: string;
  code: string;
  name: string;
  status: string;
  match: "phone" | "id_number";
}

export function parseDuplicateMatches(details: string | null | undefined): DuplicateMatch[] {
  if (details === null || details === undefined || details === "") return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const { id, code, name, status, match } = record;
      if (
        typeof id !== "string" ||
        typeof code !== "string" ||
        typeof name !== "string" ||
        typeof status !== "string" ||
        (match !== "phone" && match !== "id_number")
      ) {
        return [];
      }
      return [{ id, code, name, status, match }];
    });
  } catch {
    return [];
  }
}
