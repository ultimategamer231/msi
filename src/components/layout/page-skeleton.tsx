import { Skeleton } from "@/components/ui/skeleton";

/* Loading state for a page inside the app shell: header bar plus content blocks. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      <div className="bg-primary px-4 pt-5 pb-4 lg:border-b lg:border-line lg:bg-surface lg:px-6 lg:py-3.5">
        <Skeleton className="h-3.5 w-48 bg-white/20 lg:hidden" />
        <Skeleton className="mt-2 h-6 w-36 bg-white/25 lg:mt-0 lg:bg-line/70" />
      </div>
      <div className="grid gap-4 p-4 lg:p-6">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}
