import { describe, expect, it } from "vitest";

import { amountInWords, wholeNumberToWords } from "./amount-words";

describe("amountInWords", () => {
  it.each([
    [50000n, "Five hundred US dollars only"],
    [144000n, "One thousand four hundred forty US dollars only"],
    [144050n, "One thousand four hundred forty US dollars and 50/100"],
    [103680n, "One thousand thirty-six US dollars and 80/100"],
    [5n, "Zero US dollars and 05/100"],
    [101101101n, "One million eleven thousand eleven US dollars and 01/100"],
    ["2000000000000", "Twenty billion US dollars only"],
  ])("%s cents → %s", (cents, words) => {
    expect(amountInWords(cents)).toBe(words);
  });

  it("writes tens and teens", () => {
    expect(wholeNumberToWords(19n)).toBe("nineteen");
    expect(wholeNumberToWords(90n)).toBe("ninety");
    expect(wholeNumberToWords(999n)).toBe("nine hundred ninety-nine");
  });

  it("refuses negative amounts", () => {
    expect(() => amountInWords(-1n)).toThrow(RangeError);
  });
});
