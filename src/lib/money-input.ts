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
