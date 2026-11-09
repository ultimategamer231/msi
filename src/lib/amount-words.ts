/*
 * An amount in words for receipts ("The sum of …", as on MSI's paper voucher), from integer cents
 * without floats: 50000 → "Five hundred US dollars only", 144050 → "One thousand four hundred
 * forty US dollars and 50/100". English only, like the rest of the printed documents for now.
 */
const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: Array<[bigint, string]> = [
  [1_000_000_000_000n, "trillion"],
  [1_000_000_000n, "billion"],
  [1_000_000n, "million"],
  [1_000n, "thousand"],
];

function underThousand(value: bigint): string {
  const n = Number(value); // < 1000, exact
  const parts: string[] = [];
  const hundreds = (n - (n % 100)) / 100;
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0 && rest < 20) parts.push(ONES[rest] ?? "");
  if (rest >= 20) {
    const ten = (rest - (rest % 10)) / 10;
    parts.push(rest % 10 === 0 ? (TENS[ten] ?? "") : `${TENS[ten] ?? ""}-${ONES[rest % 10] ?? ""}`);
  }
  return parts.join(" ");
}

export function wholeNumberToWords(value: bigint): string {
  if (value < 0n) throw new RangeError("Amounts in words must not be negative");
  if (value === 0n) return "zero";
  const parts: string[] = [];
  let rest = value;
  for (const [size, name] of SCALES) {
    if (rest >= size) {
      parts.push(`${wholeNumberToWords(rest / size)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0n) parts.push(underThousand(rest));
  return parts.join(" ");
}

export function amountInWords(cents: bigint | number | string, currencyName = "US dollars"): string {
  const value = BigInt(cents);
  if (value < 0n) throw new RangeError("Amounts in words must not be negative");
  const dollars = value / 100n;
  const fraction = value % 100n;
  const words = wholeNumberToWords(dollars);
  const text = `${words} ${currencyName}${fraction === 0n ? " only" : ` and ${fraction.toString().padStart(2, "0")}/100`}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
