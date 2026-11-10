"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";

import { requestVoid } from "./actions";

/*
 * Ask for a payment to be voided (SPEC 5.4.9, FR-20): a reason is required, and another manager or
 * the CEO approves it in the inbox. Nothing changes until then.
 */
export function VoidRequest({ paymentId, receiptNo }: { paymentId: string; receiptNo: string }) {
  const t = useTranslations("payments.void");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) return <FormMessage tone="success">{t("sent")}</FormMessage>;
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("openLabel", { receipt: receiptNo })}
        onClick={() => setOpen(true)}
      >
        {t("open")}
      </Button>
    );
  }
  const inputId = `${id}-reason`;
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      className="grid min-w-64 gap-3 rounded-control border border-warning-border bg-warning-bg p-3 text-left text-status-overdue-fg"
    >
      <p id={`${id}-title`} className="text-sm font-semibold">
        {t("confirm", { receipt: receiptNo })}
      </p>
      <Field id={inputId} label={t("reason")} error={missing ? t("reasonRequired") : undefined}>
        <input
          id={inputId}
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          {...describedBy(inputId, undefined, missing ? t("reasonRequired") : undefined)}
        />
      </Field>
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (reason.trim() === "") {
              setMissing(true);
              return;
            }
            setMissing(false);
            setError(null);
            startTransition(async () => {
              const result = await requestVoid(paymentId, reason);
              if (result.ok) {
                setSent(true);
                router.refresh();
              } else {
                setError(result.code);
              }
            });
          }}
        >
          {pending ? t("sending") : t("send")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          {t("keep")}
        </Button>
      </div>
    </div>
  );
}
