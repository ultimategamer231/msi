import { describe, expect, it } from "vitest";

import { centsToInput, parseDollarsToCents } from "./money-input";

describe("parseDollarsToCents", () => {
  it.each([
    ["2000", 200000n],
    ["2,000", 200000n],
    ["2000.5", 200050n],
    ["2,000.50", 200050n],
    ["$2,000.50", 200050n],
    [" 100 ", 10000n],
    ["0", 0n],
    ["0.05", 5n],
    ["1,234,567.89", 123456789n],
  ])("%s → %s cents", (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1e3", "12.345", "1,23", "2,0000", "12.", ".5", "1 000", "NaN", "Infinity"])(
    "rejects %s",
    (input) => {
      expect(parseDollarsToCents(input)).toBeNull();
    },
  );
});

describe("centsToInput", () => {
  it("formats cents for an input field", () => {
    expect(centsToInput(200000)).toBe("2000.00");
    expect(centsToInput(5)).toBe("0.05");
    expect(centsToInput("10000")).toBe("100.00");
    expect(centsToInput(-1000n)).toBe("-10.00");
  });

  it("round-trips with the parser", () => {
    for (const cents of [0n, 1n, 99n, 100n, 123456n, 200000n]) {
      expect(parseDollarsToCents(centsToInput(cents))).toBe(cents);
    }
  });
});
