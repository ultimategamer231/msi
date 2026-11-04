import { describe, expect, it } from "vitest";

import { customerPayload, customerSchema, emptyCustomer, parseDuplicateMatches } from "./schemas";

const individual = {
  ...emptyCustomer,
  firstName: "Mariama",
  lastName: "Kollie",
  phone: "0770 555 010",
  idType: "national_id" as const,
  idNumber: "LR-0012345",
};

function errorPaths(values: unknown): string[] {
  const result = customerSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("customerSchema", () => {
  it("accepts a complete individual", () => {
    expect(errorPaths(individual)).toEqual([]);
  });

  it("requires names and an ID for an individual", () => {
    expect(errorPaths({ ...individual, lastName: " ", idType: "", idNumber: "" }).sort()).toEqual([
      "idNumber",
      "idType",
      "lastName",
    ]);
  });

  it("requires a business name and contact person for a business, ID optional but paired", () => {
    const business = { ...emptyCustomer, type: "business", phone: "0770 555 020" };
    expect(errorPaths(business).sort()).toEqual(["businessName", "contactPerson"]);
    expect(
      errorPaths({ ...business, businessName: "Dolo & Sons Trading", contactPerson: "J. Dolo" }),
    ).toEqual([]);
    expect(
      errorPaths({ ...business, businessName: "Dolo", contactPerson: "J. Dolo", idNumber: "X1" }),
    ).toEqual(["idType"]);
  });

  it("checks phone numbers by their digits", () => {
    expect(errorPaths({ ...individual, phone: "" })).toEqual(["phone"]);
    expect(errorPaths({ ...individual, phone: "12-34" })).toEqual(["phone"]);
    expect(errorPaths({ ...individual, phone: "+231 770 555 010", phoneAlt: "0886 000 111" })).toEqual([]);
    expect(errorPaths({ ...individual, nextOfKinPhone: "abc" })).toEqual(["nextOfKinPhone"]);
  });

  it("checks the date of birth format", () => {
    expect(errorPaths({ ...individual, dateOfBirth: "12/02/1990" })).toEqual(["dateOfBirth"]);
    expect(errorPaths({ ...individual, dateOfBirth: "1990-02-12" })).toEqual([]);
  });
});

describe("customerPayload", () => {
  it("uses column names, turns blanks into null and drops fields of the other type", () => {
    const payload = customerPayload({ ...individual, businessName: "left over", city: "  Monrovia " });
    expect(payload).toMatchObject({
      first_name: "Mariama",
      last_name: "Kollie",
      phone: "0770 555 010",
      id_type: "national_id",
      city: "Monrovia",
      address: null,
      business_name: null,
      branch_id: null,
    });
  });
});

describe("parseDuplicateMatches", () => {
  it("reads the matches from the error detail and ignores anything malformed", () => {
    const detail = JSON.stringify([
      { id: "a1", code: "CU-000008", name: "Mariama Kollie", status: "active", match: "phone" },
      { id: "a2", code: "CU-000009", name: 3, status: "active", match: "phone" },
    ]);
    expect(parseDuplicateMatches(detail)).toEqual([
      { id: "a1", code: "CU-000008", name: "Mariama Kollie", status: "active", match: "phone" },
    ]);
    expect(parseDuplicateMatches("not json")).toEqual([]);
    expect(parseDuplicateMatches(null)).toEqual([]);
  });
});
