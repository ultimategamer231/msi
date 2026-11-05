/*
 * Converts what people type into integer cents, without floats (CLAUDE.md rule 1).
 * Accepts "2000", "2,000", "2000.5", "2,000.50", "$2,000.50". Rejects negatives, more than two
 * decimals, exponents and anything else. Returns null when the text is not a valid amount.
 */
const AMOUNT = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export function parseDollarsToCents(input: string): bigint | null {
  const match = AMOUNT.exec(input.trim());
  if (match === null) return null;
  const whole = (match[1] ?? "").replace(/,/g, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return BigInt(whole) * 100n + BigInt(fraction === "" ? "0" : fraction);
}

/** Integer cents to the plain text an input field shows: 200000 → "2000.00". */
export function centsToInput(cents: number | bigint | string): string {
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const text = `${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/*
 * Percentages to whole basis points, without floats: "20" → 2000, "20.5" → 2050, "12.34" → 1234,
 * "20%" → 2000. At most two decimals; returns null for anything else.
 */
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%?$/;

export function parsePercentToBps(input: string): number | null {
  const match = PERCENT.exec(input.trim());
  if (match === null) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number.parseInt(match[1] ?? "0", 10) * 100 + Number.parseInt(fraction === "" ? "0" : fraction, 10);
}

/** Basis points to the plain text an input shows: 2000 → "20", 2050 → "20.5", 1234 → "12.34". */
export function bpsToInput(bps: number): string {
  const whole = (bps - (bps % 100)) / 100;
  const fraction = (bps % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}` : `${whole}.${fraction}`;
}
