import { businessDateOf, formatDate, formatTime } from "@/lib/format";

/*
 * How long ago something was requested, against the business clock (B-01), in the mock-up style:
 * "12 minutes ago", "2 hours ago", "Today, 08:15", "Yesterday, 16:40", "10 Feb 2026, 09:20".
 * The caller turns the result into text through the "when" messages.
 */
export type Age =
  | { kind: "now" }
  | { kind: "minutes"; count: number }
  | { kind: "hours"; count: number }
  | { kind: "today"; time: string }
  | { kind: "yesterday"; time: string }
  | { kind: "date"; date: string; time: string };

const MINUTE = 60_000;

function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

export function ageOf(at: string, now: string): Age {
  const elapsed = new Date(now).getTime() - new Date(at).getTime();
  const minutes = Math.floor(elapsed / MINUTE);
  if (minutes < 1) return { kind: "now" };
  if (minutes < 60) return { kind: "minutes", count: minutes };
  if (minutes < 6 * 60 && businessDateOf(at) === businessDateOf(now)) {
    return { kind: "hours", count: Math.floor(minutes / 60) };
  }
  const time = formatTime(at);
  if (businessDateOf(at) === businessDateOf(now)) return { kind: "today", time };
  if (businessDateOf(at) === previousDay(businessDateOf(now))) return { kind: "yesterday", time };
  return { kind: "date", date: formatDate(businessDateOf(at)), time };
}
