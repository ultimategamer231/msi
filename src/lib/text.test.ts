import { describe, expect, it } from "vitest";

import { blankIfPending, initials } from "./text";

describe("blankIfPending", () => {
  it("prints pending and missing fields as blank", () => {
    expect(blankIfPending("[pending]")).toBe("");
    expect(blankIfPending(" [pending] ")).toBe("");
    expect(blankIfPending(null)).toBe("");
    expect(blankIfPending(42)).toBe("");
  });

  it("keeps real values, trimmed", () => {
    expect(blankIfPending(" Broad Street, Monrovia ")).toBe("Broad Street, Monrovia");
  });
});

describe("initials", () => {
  it.each([
    ["Rebecca Wolo", "RW"],
    ["Joseph B. Gbessay", "JG"],
    ["Grace", "G"],
    ["  peter   zayzay ", "PZ"],
    ["", ""],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
