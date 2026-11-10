/*
 * Session age rule (SPEC 11 Security: "session max 12 hours"). Supabase's session timebox enforces
 * the same limit where the plan supports it; this check enforces it in the app on every plan.
 * The sign-in time comes from the access token's `amr` claim (authentication method + timestamp),
 * which survives token refreshes. A token without it is treated as expired.
 */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

interface AmrEntry {
  method?: string;
  timestamp?: number;
}

export interface SessionClaims {
  amr?: ReadonlyArray<AmrEntry | string>;
}

/** Seconds since the epoch when the user last signed in, or undefined if the token does not say. */
export function signedInAt(claims: SessionClaims): number | undefined {
  const timestamps = (claims.amr ?? [])
    .filter((entry): entry is AmrEntry => typeof entry === "object")
    .map((entry) => entry.timestamp)
    .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value));
  if (timestamps.length === 0) return undefined;
  return Math.max(...timestamps);
}

export function isSessionExpired(claims: SessionClaims, nowSeconds: number): boolean {
  const since = signedInAt(claims);
  if (since === undefined) return true;
  return nowSeconds - since >= SESSION_MAX_AGE_SECONDS;
}
