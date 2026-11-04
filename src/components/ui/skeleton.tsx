import { cn } from "@/lib/utils";

/* Loading placeholder shaped like the content it replaces (SPEC 11 Motion: skeleton loaders). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-line/70", className)} />;
}
