import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Form building blocks in the mock-up style: label above the input, help text, error below
 * (never placeholder-as-label). 40px controls on desktop, 44px on phones.
 */
export const inputClass =
  "border-line-input bg-surface text-ink rounded-control min-h-11 w-full border px-3 text-base sm:text-sm lg:min-h-10 aria-[invalid=true]:border-status-overdue-strong disabled:bg-page disabled:text-ink-muted";

export function Field({
  id,
  label,
  help,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-semibold text-ink-muted">
        {label}
      </label>
      {children}
      {help !== undefined ? (
        <p id={`${id}-help`} className="text-xs leading-5 text-ink-soft">
          {help}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs font-medium text-status-overdue-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria attributes that connect an input to its help and error text. */
export function describedBy(id: string, help?: string, error?: string) {
  const ids = [help !== undefined ? `${id}-help` : null, error !== undefined ? `${id}-error` : null].filter(
    Boolean,
  );
  return {
    "aria-invalid": error !== undefined ? true : undefined,
    "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
  } as const;
}

export function CheckboxRow({
  id,
  label,
  ...props
}: { id: string; label: string } & Omit<React.ComponentProps<"input">, "type" | "id">) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink lg:min-h-10"
    >
      <input id={id} type="checkbox" className="size-4.5 shrink-0 accent-primary" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function FormMessage({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-control px-3 py-2 text-sm font-medium",
        tone === "error"
          ? "border border-warning-border bg-warning-bg text-status-overdue-fg"
          : "bg-status-active-bg text-status-active-fg",
      )}
    >
      {children}
    </p>
  );
}

export function Panel({
  title,
  intro,
  children,
  id,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 id={id} className="text-base font-bold text-ink">
        {title}
      </h2>
      {intro !== undefined ? (
        <p className="mt-1 max-w-[70ch] text-sm leading-6 text-ink-muted">{intro}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
