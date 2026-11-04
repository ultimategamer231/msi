import type * as React from "react";

import { cn } from "@/lib/utils";

/* Status pills from the mock-ups (999px radius, status colour pairs). */
export type BadgeTone = "active" | "due" | "overdue" | "recovery" | "pending";

const TONES: Record<BadgeTone, string> = {
  active: "bg-status-active-bg text-status-active-fg",
  due: "bg-status-due-bg text-status-due-fg",
  overdue: "bg-status-overdue-bg text-status-overdue-fg",
  recovery: "bg-status-recovery-bg text-status-recovery-fg",
  pending: "bg-status-pending-bg text-status-pending-fg",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-badge px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export const CUSTOMER_STATUS_TONE: Record<string, BadgeTone> = {
  active: "active",
  blacklisted: "recovery",
  archived: "pending",
};
