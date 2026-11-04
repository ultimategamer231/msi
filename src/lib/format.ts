/*
 * The one shared formatter for money, rates, shares and dates (SPEC 3.1, D-12).
 *
 * Rules:
 *  - Money arrives as integer cents (number, bigint or a digit string from Postgres
 *    bigint). Formatting uses BigInt arithmetic only: no floats, no rounding.
 *  - Rates arrive as integer basis points (2000 = 20%).
 *  - Business dates are Postgres `date` values ("YYYY-MM-DD") and are formatted
 *    without any time-zone conversion. Event timestamps are shown in the business
 *    time zone, Africa/Monrovia (D-06).
 *  - Output: money "$1,234.56", dates "05 Feb 2026", times "14:52" (24-hour).
 *
 * This module formats only. It never calculates interest, penalties or balances;
 * those live in Postgres (SPEC 5.1).
 */

export const BUSINESS_TIME_ZONE = "Africa/Monrovia";

export type Cents = number | bigint | string;

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { USD: "$" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const INTEGER_STRING = /^-?\d+$/;
const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Convert an integer amount of cents to BigInt, rejecting anything that is not a whole number. */
export function toCents(value: Cents): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Money must be a whole number of cents, got ${String(value)}`);
    }
    return BigInt(value);
  }
  if (INTEGER_STRING.test(value)) return BigInt(value);
  throw new RangeError(`Money must be a whole number of cents, got "${value}"`);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "$1,234.56"; negative amounts as "-$45.00". */
export function formatMoney(cents: Cents, currency = "USD"): string {
  const value = toCents(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = groupThousands((abs / 100n).toString());
  const fraction = (abs % 100n).toString().padStart(2, "0");
  const symbol = CURRENCY_SYMBOLS[currency];
  const amount = symbol === undefined ? `${currency} ${whole}.${fraction}` : `${symbol}${whole}.${fraction}`;
  return negative ? `-${amount}` : amount;
}

/** Always shows the sign: "+$240.00", "-$45.00", "$0.00" for zero. */
export function formatMoneySigned(cents: Cents, currency = "USD"): string {
  const value = toCents(cents);
  if (value > 0n) return `+${formatMoney(value, currency)}`;
  return formatMoney(value, currency);
}

/** Basis points as a percentage without trailing zeros: 2000 → "20%", 2050 → "20.5%", 1234 → "12.34%". */
export function formatRateBps(bps: number): string {
  if (!Number.isSafeInteger(bps)) {
    throw new RangeError(`Rate must be whole basis points, got ${String(bps)}`);
  }
  const negative = bps < 0;
  const abs = negative ? -bps : bps;
  const whole = (abs - (abs % 100)) / 100; // exact: abs - remainder is a multiple of 100
  const fraction = (abs % 100).toString().padStart(2, "0").replace(/0+$/, "");
  const text = fraction === "" ? `${whole}%` : `${whole}.${fraction}%`;
  return negative ? `-${text}` : text;
}

/**
 * Share of `part` in `whole` as a percentage, rounded half up to `decimals`
 * places using integer arithmetic: formatShare(620928, 1016928, 1) → "61.1%".
 */
export function formatShare(part: Cents, whole: Cents, decimals: 0 | 1 | 2 = 1): string {
  const p = toCents(part);
  const w = toCents(whole);
  if (w <= 0n) throw new RangeError("Share needs a positive whole");
  if (p < 0n) throw new RangeError("Share needs a non-negative part");
  const scale = 10n ** BigInt(decimals);
  const scaled = (2n * p * 100n * scale + w) / (2n * w);
  const integer = (scaled / scale).toString();
  if (decimals === 0) return `${integer}%`;
  const fraction = (scaled % scale).toString().padStart(decimals, "0");
  return `${integer}.${fraction}%`;
}

interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parse a Postgres `date` ("YYYY-MM-DD"), rejecting impossible dates such as 2026-02-30. */
export function parseBusinessDate(value: string): DateParts {
  const match = BUSINESS_DATE.exec(value);
  if (match === null) throw new RangeError(`Business date must be YYYY-MM-DD, got "${value}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Business date does not exist: "${value}"`);
  }
  return { year, month, day };
}

function weekdayIndex({ year, month, day }: DateParts): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function partsToText({ year, month, day }: DateParts): string {
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1] ?? ""} ${year}`;
}

/** "2026-02-05" → "05 Feb 2026". */
export function formatDate(businessDate: string): string {
  return partsToText(parseBusinessDate(businessDate));
}

/** "2026-02-12" → "Thu 12 Feb 2026" (short) or "Thursday 12 Feb 2026" (long). */
export function formatWeekdayDate(businessDate: string, weekday: "short" | "long" = "short"): string {
  const parts = parseBusinessDate(businessDate);
  const index = weekdayIndex(parts);
  const name = weekday === "short" ? WEEKDAYS_SHORT[index] : WEEKDAYS_LONG[index];
  return `${name ?? ""} ${partsToText(parts)}`;
}

interface ZonedParts extends DateParts {
  hour: number;
  minute: number;
}

const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toZonedParts(timestamp: string | Date): ZonedParts {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a valid timestamp: "${String(timestamp)}"`);
  }
  const lookup: Record<string, number> = {};
  for (const part of zonedFormatter.formatToParts(date)) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  return {
    year: lookup.year ?? 0,
    month: lookup.month ?? 0,
    day: lookup.day ?? 0,
    hour: lookup.hour ?? 0,
    minute: lookup.minute ?? 0,
  };
}

/** The business date (Africa/Monrovia) of an event timestamp, as "YYYY-MM-DD". */
export function businessDateOf(timestamp: string | Date): string {
  const { year, month, day } = toZonedParts(timestamp);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Event time in Africa/Monrovia: "14:52". */
export function formatTime(timestamp: string | Date): string {
  const { hour, minute } = toZonedParts(timestamp);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Event date and time in Africa/Monrovia: "12 Feb 2026, 14:52". */
export function formatDateTime(timestamp: string | Date): string {
  const parts = toZonedParts(timestamp);
  return `${partsToText(parts)}, ${formatTime(timestamp)}`;
}
