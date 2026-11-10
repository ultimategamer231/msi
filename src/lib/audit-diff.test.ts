import { describe, expect, it } from "vitest";

import { auditChanges } from "./audit-diff";

describe("auditChanges", () => {
  it("lists only the fields that changed", () => {
    expect(
      auditChanges(
        { name: "Branch 4", phone: null, active: true, updated_at: "a" },
        { name: "Gbarnga", phone: null, active: true, updated_at: "b" },
      ),
    ).toEqual([{ field: "name", before: "Branch 4", after: "Gbarnga" }]);
  });

  it("shows created records as all fields from nothing", () => {
    expect(auditChanges(null, { code: "BR4", active: true })).toEqual([
      { field: "active", before: "", after: "true" },
      { field: "code", before: "", after: "BR4" },
    ]);
  });

  it("handles plain values such as a setting number", () => {
    expect(auditChanges(10000, 12500)).toEqual([{ field: "", before: "10000", after: "12500" }]);
    expect(auditChanges(null, null)).toEqual([]);
  });

  it("shows nested values compactly", () => {
    expect(auditChanges({ order: ["penalty", "interest"] }, { order: ["interest", "penalty"] })).toEqual([
      { field: "order", before: '["penalty","interest"]', after: '["interest","penalty"]' },
    ]);
  });
});
