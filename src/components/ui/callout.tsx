import type * as React from "react";

import { cn } from "@/lib/utils";

/* Inline notices in the mock-up style: warning (orange, e.g. mock-up 08 banner) and info (purple tint). */
export function Callout({
  tone = "info",
  role = "status",
  className,
  children,
}: {
  tone?: "info" | "warning";
  role?: "status" | "alert";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      role={role}
      className={cn(
        "rounded-control border px-4 py-3 text-sm leading-6",
        tone === "warning"
          ? "border-warning-border bg-warning-bg text-status-overdue-fg"
          : "border-transparent bg-primary-tint text-primary-dark",
        className,
      )}
    >
      {children}
    </p>
  );
}
