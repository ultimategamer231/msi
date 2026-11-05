/** Settings fields still waiting for the client hold "[pending]"; they print blank (SPEC 11 Branding). */
export function blankIfPending(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed === "[pending]" ? "" : trimmed;
}

/** Up to two initials for an avatar: "Rebecca Wolo" → "RW", "Grace" → "G". */
export function initials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
