import { formatDate } from "@/lib/format";

/*
 * Human-readable values of customer fields for the pending-change notice (mock-up 08) and the
 * approvals inbox (mock-up 12): IDs become names, codes become labels, dates are formatted.
 */
export interface Lookups {
  branches: ReadonlyMap<string, string>;
  people: ReadonlyMap<string, string>;
  idTypes: Readonly<Record<string, string>>;
  statuses: Readonly<Record<string, string>>;
  none: string;
}

export function describeCustomerValue(column: string, value: unknown, lookups: Lookups): string {
  if (value === null || value === undefined || value === "") return lookups.none;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  switch (column) {
    case "branch_id":
      return lookups.branches.get(text) ?? text;
    case "assigned_officer_id":
      return lookups.people.get(text) ?? text;
    case "id_type":
      return lookups.idTypes[text] ?? text;
    case "status":
      return lookups.statuses[text] ?? text;
    case "date_of_birth":
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? formatDate(text) : text;
    default:
      return text;
  }
}

export interface FieldChange {
  column: string;
  before: unknown;
  after: unknown;
}

/** The `changes` object of a customer edit request as a list, in form order. */
export function changesOf(payload: unknown): FieldChange[] {
  if (typeof payload !== "object" || payload === null) return [];
  const changes = (payload as { changes?: unknown }).changes;
  if (typeof changes !== "object" || changes === null) return [];
  return Object.entries(changes as Record<string, { before?: unknown; after?: unknown }>)
    .map(([column, change]) => ({ column, before: change.before ?? null, after: change.after ?? null }))
    .sort((a, b) => FIELD_ORDER.indexOf(a.column) - FIELD_ORDER.indexOf(b.column));
}

export const FIELD_ORDER = [
  "status",
  "first_name",
  "last_name",
  "business_name",
  "registration_no",
  "contact_person",
  "id_type",
  "id_number",
  "date_of_birth",
  "phone",
  "phone_alt",
  "address",
  "city",
  "occupation",
  "employer_or_business",
  "next_of_kin_name",
  "next_of_kin_relation",
  "next_of_kin_phone",
  "branch_id",
  "assigned_officer_id",
  "notes",
  "photo_path",
];
