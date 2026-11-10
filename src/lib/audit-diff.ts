/*
 * Turns an audit row's before/after JSON into a list of changed fields for display. Top-level
 * fields only; nested values are shown as compact JSON. Bookkeeping fields are left out.
 */
export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

const HIDDEN = new Set(["updated_at", "updated_by", "created_at", "created_by"]);

function show(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function auditChanges(before: unknown, after: unknown): FieldChange[] {
  if (!isRecord(before) && !isRecord(after)) {
    if (
      before === after ||
      (before === null && after === null) ||
      (before === undefined && after === undefined)
    )
      return [];
    return [{ field: "", before: show(before), after: show(after) }];
  }
  const from = isRecord(before) ? before : {};
  const to = isRecord(after) ? after : {};
  const fields = [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((field) => !HIDDEN.has(field))
    .sort();
  return fields
    .filter((field) => JSON.stringify(from[field]) !== JSON.stringify(to[field]))
    .map((field) => ({ field, before: show(from[field]), after: show(to[field]) }));
}
