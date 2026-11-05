import { describe, expect, it } from "vitest";

import {
  businessDateOf,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneySigned,
  formatRateBps,
  formatShare,
  formatTime,
  formatWeekdayDate,
  parseBusinessDate,
  toCents,
} from "./format";

describe("formatMoney", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [50, "$0.50"],
    [100, "$1.00"],
    [123456, "$1,234.56"],
    [144000, "$1,440.00"],
    [1016928, "$10,169.28"],
    [-1000, "-$10.00"],
    [-4500, "-$45.00"],
  ])("formats %s cents as %s", (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });

  it("formats values beyond the safe integer range when given as bigint or string", () => {
    expect(formatMoney(123456789012345678n)).toBe("$1,234,567,890,123,456.78");
    expect(formatMoney("900719925474099199")).toBe("$9,007,199,254,740,991.99");
  });

  it("accepts Postgres bigint values returned as strings", () => {
    expect(formatMoney("248832")).toBe("$2,488.32");
    expect(formatMoney("-1000")).toBe("-$10.00");
  });

  it("rejects anything that is not whole cents", () => {
    expect(() => formatMoney(12.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => formatMoney("12.50")).toThrow(RangeError);
    expect(() => formatMoney("1e3")).toThrow(RangeError);
    expect(() => formatMoney("")).toThrow(RangeError);
  });

  it("uses the currency code for currencies without a symbol", () => {
    expect(formatMoney(150000, "LRD")).toBe("LRD 1,500.00");
  });
});

describe("formatMoneySigned", () => {
  it("shows a plus sign for positive amounts only", () => {
    expect(formatMoneySigned(24000)).toBe("+$240.00");
    expect(formatMoneySigned(-4500)).toBe("-$45.00");
    expect(formatMoneySigned(0)).toBe("$0.00");
  });
});

describe("toCents", () => {
  it("returns a bigint for each accepted input", () => {
    expect(toCents(42)).toBe(42n);
    expect(toCents(42n)).toBe(42n);
    expect(toCents("-42")).toBe(-42n);
  });
});

describe("formatRateBps", () => {
  it.each([
    [2000, "20%"],
    [2050, "20.5%"],
    [1234, "12.34%"],
    [5, "0.05%"],
    [0, "0%"],
    [10000, "100%"],
  ])("formats %s bps as %s", (bps, expected) => {
    expect(formatRateBps(bps)).toBe(expected);
  });

  it("rejects fractional basis points", () => {
    expect(() => formatRateBps(20.5)).toThrow(RangeError);
  });
});

describe("formatShare", () => {
  it("matches the demo figures (DEMO_DATA, mock-ups 05 and 15)", () => {
    expect(formatShare(620928, 1016928)).toBe("61.1%");
    expect(formatShare(144000, 620928)).toBe("23.2%");
    expect(formatShare(103680, 620928)).toBe("16.7%");
    expect(formatShare(373248, 620928)).toBe("60.1%");
    expect(formatShare(140000, 144000, 0)).toBe("97%");
    expect(formatShare(620928, 620928, 0)).toBe("100%");
  });

  it("rounds half up", () => {
    expect(formatShare(1, 8, 1)).toBe("12.5%");
    expect(formatShare(1, 16, 1)).toBe("6.3%");
    expect(formatShare(1, 3, 2)).toBe("33.33%");
    expect(formatShare(2, 3, 0)).toBe("67%");
  });

  it("rejects a zero whole and a negative part", () => {
    expect(() => formatShare(1, 0)).toThrow(RangeError);
    expect(() => formatShare(-1, 10)).toThrow(RangeError);
  });
});

describe("business dates", () => {
  it("formats Postgres dates without time-zone shifts", () => {
    expect(formatDate("2026-02-05")).toBe("05 Feb 2026");
    expect(formatDate("2026-02-28")).toBe("28 Feb 2026");
    expect(formatDate("2025-12-10")).toBe("10 Dec 2025");
    expect(formatDate("2026-09-01")).toBe("01 Sep 2026");
  });

  it("adds the weekday", () => {
    expect(formatWeekdayDate("2026-02-12")).toBe("Thu 12 Feb 2026");
    expect(formatWeekdayDate("2026-02-11", "long")).toBe("Wednesday 11 Feb 2026");
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => parseBusinessDate("2026-02-30")).toThrow(RangeError);
    expect(() => parseBusinessDate("2026-13-01")).toThrow(RangeError);
    expect(() => parseBusinessDate("12/02/2026")).toThrow(RangeError);
    expect(() => parseBusinessDate("2026-2-5")).toThrow(RangeError);
  });

  it("accepts 29 February only in leap years", () => {
    expect(formatDate("2028-02-29")).toBe("29 Feb 2028");
    expect(() => parseBusinessDate("2026-02-29")).toThrow(RangeError);
  });
});

describe("event timestamps in Africa/Monrovia", () => {
  it("formats time and date-time on a 24-hour clock", () => {
    expect(formatTime("2026-02-12T14:52:00Z")).toBe("14:52");
    expect(formatDateTime("2026-02-12T14:52:00Z")).toBe("12 Feb 2026, 14:52");
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 5, 9, 5)))).toBe("05 Jan 2026, 09:05");
  });

  it("converts offsets to Monrovia time (UTC+0)", () => {
    expect(formatDateTime("2026-02-12T01:30:00+02:00")).toBe("11 Feb 2026, 23:30");
    expect(businessDateOf("2026-02-12T01:30:00+02:00")).toBe("2026-02-11");
  });

  it("formats midnight as 00:00", () => {
    expect(formatTime("2026-02-12T00:00:00Z")).toBe("00:00");
  });

  it("rejects invalid timestamps", () => {
    expect(() => formatTime("not a date")).toThrow(RangeError);
  });
});
