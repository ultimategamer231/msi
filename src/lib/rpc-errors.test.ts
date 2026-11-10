import { describe, expect, it } from "vitest";

import messages from "../../messages/en.json";

import { APP_ERROR_CODES, RPC_ERROR_CODES, errorCodeFrom } from "./rpc-errors";

describe("errorCodeFrom", () => {
  it("reads the code from 'CODE: message'", () => {
    expect(errorCodeFrom({ message: "FORBIDDEN: this action is not allowed for your role" })).toBe(
      "FORBIDDEN",
    );
    expect(errorCodeFrom({ message: "INVALID_SETTING: approvals.expense_limit_cents must be ..." })).toBe(
      "INVALID_SETTING",
    );
  });

  it("returns UNKNOWN for anything else", () => {
    expect(errorCodeFrom({ message: "permission denied for table settings" })).toBe("UNKNOWN");
    expect(errorCodeFrom({ message: "NOT_A_CODE: x" })).toBe("UNKNOWN");
    expect(errorCodeFrom(null)).toBe("UNKNOWN");
  });
});

describe("error messages", () => {
  it("has a friendly text for every error code (CLAUDE.md: no unhandled RPC error codes)", () => {
    const errors = messages.errors as Record<string, string>;
    for (const code of [...RPC_ERROR_CODES, ...APP_ERROR_CODES]) {
      expect(errors[code], code).toBeTypeOf("string");
    }
  });
});
