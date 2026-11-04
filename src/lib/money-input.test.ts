import { describe, expect, it } from "vitest";

import { bpsToInput, centsToInput, parseDollarsToCents, parsePercentToBps } from "./money-input";

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

describe("parsePercentToBps and bpsToInput", () => {
  it("turns percentages into whole basis points", () => {
    expect(parsePercentToBps("20")).toBe(2000);
    expect(parsePercentToBps("20.5")).toBe(2050);
    expect(parsePercentToBps("12.34 %")).toBe(1234);
    expect(parsePercentToBps("0.05")).toBe(5);
    expect(parsePercentToBps("100")).toBe(10000);
  });

  it("refuses more than two decimals, negatives and text", () => {
    for (const bad of ["20.555", "-5", "", "abc", "1e3", "20,5"]) expect(parsePercentToBps(bad)).toBeNull();
  });

  it("shows basis points without trailing zeros", () => {
    expect(bpsToInput(2000)).toBe("20");
    expect(bpsToInput(2050)).toBe("20.5");
    expect(bpsToInput(1234)).toBe("12.34");
    expect(bpsToInput(5)).toBe("0.05");
  });
});
