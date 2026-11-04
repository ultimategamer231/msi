import { describe, expect, it } from "vitest";

import { ageOf } from "./when";

const now = "2026-02-12T09:10:00Z";

describe("ageOf", () => {
  it("counts minutes and hours on the same day", () => {
    expect(ageOf("2026-02-12T09:09:40Z", now)).toEqual({ kind: "now" });
    expect(ageOf("2026-02-12T08:15:00Z", now)).toEqual({ kind: "minutes", count: 55 });
    expect(ageOf("2026-02-12T07:10:00Z", now)).toEqual({ kind: "hours", count: 2 });
  });

  it("names today, yesterday and older dates with the time", () => {
    expect(ageOf("2026-02-12T08:15:00Z", "2026-02-12T16:00:00Z")).toEqual({ kind: "today", time: "08:15" });
    expect(ageOf("2026-02-11T16:40:00Z", now)).toEqual({ kind: "yesterday", time: "16:40" });
    expect(ageOf("2026-02-10T09:20:00Z", now)).toEqual({ kind: "date", date: "10 Feb 2026", time: "09:20" });
    expect(ageOf("2026-02-28T09:00:00Z", "2026-03-01T09:00:00Z")).toEqual({
      kind: "yesterday",
      time: "09:00",
    });
  });
});
