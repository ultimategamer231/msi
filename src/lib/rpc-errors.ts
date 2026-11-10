/*
 * Postgres functions raise 'CODE: message' (SPEC 8). The UI shows a friendly text per code from
 * messages/en.json ("errors.<CODE>") and never shows the raw database message.
 */
export const RPC_ERROR_CODES = [
  "FORBIDDEN",
  "SELF_APPROVAL",
  "OVERPAYMENT",
  "INSUFFICIENT_FUNDS",
  "REMITTANCE_MISMATCH",
  "DATE_NOT_ALLOWED",
  "JOURNAL_UNBALANCED",
  "PERIOD_LOCKED",
  "COLLATERAL_REQUIRED",
  "COLLATERAL_ALREADY_PLEDGED",
  "DUPLICATE_CUSTOMER",
  "INVALID_STATE",
  "REFERENCE_REQUIRED",
  "IMMUTABLE_RECORD",
  "INVALID_SETTING",
] as const;

/** Codes raised by the app itself (validation and auth administration), not by Postgres. */
export const APP_ERROR_CODES = ["INVALID_INPUT", "DUPLICATE_EMAIL", "UPLOAD_REJECTED", "UNKNOWN"] as const;

export type ErrorCode = (typeof RPC_ERROR_CODES)[number] | (typeof APP_ERROR_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set<string>(RPC_ERROR_CODES);

/** Extracts the error code from a Postgres/PostgREST error message, or UNKNOWN. */
export function errorCodeFrom(error: { message?: string } | null | undefined): ErrorCode {
  const match = /^([A-Z_]+):/.exec(error?.message ?? "");
  const code = match?.[1];
  return code !== undefined && KNOWN.has(code) ? (code as ErrorCode) : "UNKNOWN";
}
