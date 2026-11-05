import { describe, expect, it } from "vitest";

import { emptyGuarantor, guarantorPayload, guarantorSchema, guarantorsSchema } from "./guarantors";

const joseph = {
  ...emptyGuarantor,
  fullName: "Joseph Kollie",
  phone: "0770 555 014",
  relationship: "Brother",
};

function errorPaths(values: unknown): string[] {
  const result = guarantorSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("guarantorSchema", () => {
  it("needs a name and a phone; the rest is optional", () => {
    expect(errorPaths(joseph)).toEqual([]);
    expect(errorPaths({ ...emptyGuarantor }).sort()).toEqual(["fullName", "phone"]);
  });

  it("keeps the ID type and number together", () => {
    expect(errorPaths({ ...joseph, idType: "national_id" })).toEqual(["idNumber"]);
    expect(errorPaths({ ...joseph, idNumber: "LR-1" })).toEqual(["idType"]);
    expect(errorPaths({ ...joseph, idType: "passport", idNumber: "P123" })).toEqual([]);
  });

  it("allows at most 3 guarantors", () => {
    expect(guarantorsSchema.safeParse([joseph, joseph, joseph]).success).toBe(true);
    expect(guarantorsSchema.safeParse([joseph, joseph, joseph, joseph]).success).toBe(false);
  });
});

describe("guarantorPayload", () => {
  it("uses column names and turns blanks into null", () => {
    expect(guarantorPayload({ ...joseph, address: "  " })).toEqual({
      full_name: "Joseph Kollie",
      phone: "0770 555 014",
      relationship: "Brother",
      address: null,
      id_type: null,
      id_number: null,
    });
  });
});
