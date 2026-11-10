import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Horizontal scroller for wide tables on phones. It is keyboard-focusable with a name so people
 * who do not use a mouse or touch can scroll it (WCAG 2.1.1; axe "scrollable-region-focusable").
 * `relative` keeps visually-hidden labels inside from widening the page.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}
