import "server-only";

/*
 * Server-side error log (SPEC 11 Observability): error code and user id only, never personal data,
 * request bodies or secrets. One JSON line per event so a log drain can parse it.
 */
export function logServerError(event: { code: string; userId?: string | null; where: string }): void {
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      where: event.where,
      code: event.code,
      userId: event.userId ?? null,
    }),
  );
}
