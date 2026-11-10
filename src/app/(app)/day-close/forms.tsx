"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatMoneySigned } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/money-input";
import type { ErrorCode } from "@/lib/rpc-errors";
import { cn } from "@/lib/utils";

import { reopenDayClose, submitDayClose } from "./actions";

/* The cashier's count (mock-up 14): live variance, a reason when it is not zero, then Close day. */
export function CountForm({
  branchId,
  date,
  expectedCents,
}: {
  branchId: string;
  date: string;
  expectedCents: string;
}) {
  const t = useTranslations("dayClose.count");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<ErrorCode | "noteRequired" | "countRequired" | null>(null);
  const cents = parseDollarsToCents(counted);
  const variance = cents === null ? null : cents - BigInt(expectedCents);
  const needsNote = variance !== null && variance !== 0n;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (cents === null) return setError("countRequired");
        if (needsNote && note.trim() === "") return setError("noteRequired");
        setError(null);
        startTransition(async () => {
          const result = await submitDayClose(branchId, date, counted, note);
          if (result.ok) router.refresh();
          else setError(result.code);
        });
      }}
    >
      <Field
        id="count-cash"
        label={t("counted")}
        error={error === "countRequired" ? t("countRequired") : undefined}
      >
        <input
          id="count-cash"
          inputMode="decimal"
          autoComplete="off"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          className={`${inputClass} tabular`}
          {...describedBy(
            "count-cash",
            undefined,
            error === "countRequired" ? t("countRequired") : undefined,
          )}
        />
      </Field>
      <div className="flex items-center justify-between text-base font-bold" aria-live="polite">
        <span>{t("variance")}</span>
        <span className={cn("tabular", variance !== null && variance < 0n && "text-status-overdue-strong")}>
          {variance === null ? "–" : formatMoneySigned(variance)}
        </span>
      </div>
      <Field
        id="count-note"
        label={needsNote ? t("noteRequired") : t("noteOptional")}
        error={error === "noteRequired" ? t("noteMissing") : undefined}
      >
        <textarea
          id="count-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={`${inputClass} py-2`}
          {...describedBy("count-note", undefined, error === "noteRequired" ? t("noteMissing") : undefined)}
        />
      </Field>
      {error !== null && error !== "noteRequired" && error !== "countRequired" ? (
        <FormMessage tone="error">{tErrors(error)}</FormMessage>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("closing") : t("close")}
      </Button>
      <p className="text-xs leading-5 text-ink-muted">{t("lockNote")}</p>
    </form>
  );
}

/* A manager or the CEO reopens a closed day with a reason (SPEC 5.10). */
export function ReopenForm({ closeId }: { closeId: string }) {
  const t = useTranslations("dayClose.reopen");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="print:hidden">
        {t("open")}
      </Button>
    );
  }
  return (
    <form
      className="grid gap-3 print:hidden"
      aria-label={t("open")}
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() === "") return;
        startTransition(async () => {
          const result = await reopenDayClose(closeId, reason);
          if (result.ok) router.refresh();
          else setError(result.code);
        });
      }}
    >
      <Field id="reopen-reason" label={t("reason")}>
        <textarea
          id="reopen-reason"
          rows={2}
          maxLength={500}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={`${inputClass} py-2`}
        />
      </Field>
      <p className="text-xs leading-5 text-ink-muted">{t("note")}</p>
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || reason.trim() === ""}>
          {t("confirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
