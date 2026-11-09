"use client";

import { Button } from "@/components/ui/button";

/* Opens the browser's print dialog; the page's print styles decide what is printed. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
