import { describe, expect, it } from "vitest";
import { z } from "zod";

import { nestIssues, zodResolver } from "./zod-resolver";

describe("nestIssues", () => {
  it("nests array and object paths the way react-hook-form reads them", () => {
    const tree = nestIssues([
      { path: ["memo"], code: "too_small", message: "required" },
      { path: ["lines", 1, "debit"], code: "custom", message: "lineError" },
      { path: ["lines", 1, "debit"], code: "custom", message: "second" },
    ]) as Record<string, unknown>;
    expect(tree.memo).toEqual({ type: "too_small", message: "required" });
    const lines = tree.lines as unknown[];
    expect(Array.isArray(lines)).toBe(true);
    expect(lines[0]).toBeUndefined();
    expect(lines[1]).toEqual({ debit: { type: "custom", message: "lineError" } });
  });
});

describe("zodResolver", () => {
  const schema = z.object({
    name: z.string().min(1, { message: "required" }),
    items: z.array(z.object({ qty: z.number().min(1, { message: "min" }) })),
  });

  it("returns values when valid", async () => {
    const result = await zodResolver(schema)({ name: "x", items: [{ qty: 2 }] }, undefined, {
      fields: {},
      shouldUseNativeValidation: undefined,
    });
    expect(result.errors).toEqual({});
  });

  it("returns nested errors when invalid", async () => {
    const result = await zodResolver(schema)({ name: "", items: [{ qty: 2 }, { qty: 0 }] }, undefined, {
      fields: {},
      shouldUseNativeValidation: undefined,
    });
    const errors = result.errors as unknown as {
      name: { message: string };
      items: Array<{ qty?: { message: string } }>;
    };
    expect(errors.name.message).toBe("required");
    expect(errors.items[1]?.qty?.message).toBe("min");
  });
});
