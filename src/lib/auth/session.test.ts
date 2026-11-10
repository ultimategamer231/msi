import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_SECONDS, isSessionExpired, signedInAt } from "./session";

const SIGNED_IN = 1_770_888_600; // 12 Feb 2026, 09:30 UTC

describe("signedInAt", () => {
  it("reads the most recent authentication timestamp", () => {
    expect(signedInAt({ amr: [{ method: "password", timestamp: SIGNED_IN }] })).toBe(SIGNED_IN);
    expect(
      signedInAt({
        amr: [
          { method: "password", timestamp: SIGNED_IN - 100 },
          { method: "otp", timestamp: SIGNED_IN },
        ],
      }),
    ).toBe(SIGNED_IN);
  });

  it("ignores RFC 8176 string entries without timestamps", () => {
    expect(signedInAt({ amr: ["pwd"] })).toBeUndefined();
    expect(signedInAt({})).toBeUndefined();
  });
});

describe("isSessionExpired (SPEC 11: 12 hours)", () => {
  const claims = { amr: [{ method: "password", timestamp: SIGNED_IN }] };

  it("is valid just before 12 hours", () => {
    expect(isSessionExpired(claims, SIGNED_IN + SESSION_MAX_AGE_SECONDS - 1)).toBe(false);
  });

  it("expires at exactly 12 hours", () => {
    expect(isSessionExpired(claims, SIGNED_IN + SESSION_MAX_AGE_SECONDS)).toBe(true);
  });

  it("treats a token without a sign-in time as expired", () => {
    expect(isSessionExpired({}, SIGNED_IN)).toBe(true);
  });
});
