"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { formatMoney } from "@/lib/format";
import type { ErrorCode } from "@/lib/rpc-errors";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { previewPayment, receivePayment, recordFieldPayment, type PreviewResult } from "./actions";
import { FIELD_METHODS, PAYMENT_METHODS, paymentSchema, type PaymentValues } from "./schemas";

type Preview = Extract<PreviewResult, { ok: true }>;

/*
 * The payment form: at the office (mock-up 03, receive_payment) and in the field (mock-up 02,
 * record_field_payment). The request key is made once when the page opens, so a double tap or a
 * retry after a lost connection returns the same receipt (T-12). The allocation preview is asked
 * from the database as the amount changes (SPEC 5.2). Both are dated today.
 */
export function PaymentForm({
  loanId,
  initial,
  variant = "office",
  cancelHref,
  todayLabel,
  handoverNote = false,
}: {
  loanId: string;
  initial: Preview;
  variant?: "office" | "field";
  cancelHref?: string;
  todayLabel?: string;
  handoverNote?: boolean;
}) {
  const field = variant === "field";
  const t = useTranslations("payments.receive");
  const tMethods = useTranslations("payments.methods");
  const tValidation = useTranslations("payments.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<Preview>(initial);
  const [previewError, setPreviewError] = useState<ErrorCode | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const [, startPreview] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { loanId, amount: "", method: "cash", reference: "", requestKey },
  });
  const method = useWatch({ control: form.control, name: "method" });
  const errors = form.formState.errors;
  const text = (key: string | undefined) => (key === undefined ? undefined : tValidation(key as "amount"));

  const askPreview = (amount: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startPreview(async () => {
        const result = await previewPayment(loanId, amount);
        if (result.ok) {
          setPreview(result);
          setPreviewError(null);
        } else {
          setPreviewError(result.code);
        }
      });
    }, 250);
  };

  const amountField = form.register("amount");
  const rows = [
    ["penalty", preview.allocation.penalty],
    ["interest", preview.allocation.interest],
    ["principal", preview.allocation.principal],
  ] as const;

  return (
    <form
      noValidate
      aria-label={t("formLabel")}
      className="grid gap-4 rounded-card border border-line bg-surface p-4"
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setError(null);
          startTransition(async () => {
            const result = await (field ? recordFieldPayment(values) : receivePayment(values));
            if (result.ok) router.push(`/receipts/${result.paymentId}`);
            else setError(result.code);
          });
        })(event)
      }
    >
      <div className={cn("grid gap-3", todayLabel !== undefined && "grid-cols-2")}>
        <Field
          id="payment-amount"
          label={t(field ? "fieldAmount" : "amount")}
          error={text(errors.amount?.message)}
        >
          <input
            id="payment-amount"
            inputMode="decimal"
            autoComplete="off"
            className={cn(inputClass, "tabular text-lg font-bold sm:text-lg")}
            {...describedBy("payment-amount", undefined, text(errors.amount?.message))}
            {...amountField}
            onChange={(event) => {
              void amountField.onChange(event);
              askPreview(event.target.value);
            }}
          />
        </Field>
        {todayLabel !== undefined ? (
          <Field id="payment-date" label={t("date")} help={t("dateHelp")}>
            <input
              id="payment-date"
              value={todayLabel}
              disabled
              readOnly
              className={inputClass}
              {...describedBy("payment-date", "help", undefined)}
            />
          </Field>
        ) : null}
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-xs font-semibold text-ink-muted">
          {t(field ? "fieldMethod" : "method")}
        </legend>
        <div className={cn("grid gap-2", field ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
          {(field ? FIELD_METHODS : PAYMENT_METHODS).map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-2 text-center text-sm font-semibold transition-colors duration-150 ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                method === option
                  ? "border-primary bg-primary text-white"
                  : "border-line-input bg-surface text-ink hover:bg-page",
              )}
            >
              <input type="radio" value={option} className="sr-only" {...form.register("method")} />
              {tMethods(option)}
            </label>
          ))}
        </div>
      </fieldset>

      {method !== "cash" ? (
        <Field
          id="payment-reference"
          label={t(method === "cheque" ? "chequeNumber" : "reference")}
          help={t(
            method === "cheque"
              ? "referenceHelpCheque"
              : method === "bank"
                ? "referenceHelpBank"
                : "referenceHelpMomo",
          )}
          error={text(errors.reference?.message)}
        >
          <input
            id="payment-reference"
            autoComplete="off"
            maxLength={100}
            className={inputClass}
            {...describedBy("payment-reference", "help", text(errors.reference?.message))}
            {...form.register("reference")}
          />
        </Field>
      ) : null}

      <section
        aria-labelledby="allocation-heading"
        aria-live="polite"
        className="rounded-control bg-subtle p-4"
      >
        <h3 id="allocation-heading" className="text-sm font-bold text-ink">
          {t(field ? "fieldPreview" : "preview")}
        </h3>
        <dl className="mt-2 grid gap-1.5 text-sm">
          {rows.map(([component, cents], index) => (
            <div key={component} className="flex justify-between gap-3">
              <dt className="text-ink">
                {field ? `${index + 1}. ` : ""}
                {t(`components.${component}`)}
              </dt>
              <dd className="tabular font-semibold text-ink">{formatMoney(cents)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-ink-muted">{t(field ? "fieldAfter" : "after")}</dt>
            <dd className="tabular text-base font-bold text-ink">{formatMoney(preview.afterCents)}</dd>
          </div>
        </dl>
        {preview.overpayment ? (
          <p className="mt-2 text-xs font-medium text-status-overdue-strong">
            {t("overpayment", { amount: formatMoney(preview.owed.total) })}
          </p>
        ) : null}
        {previewError !== null ? (
          <p className="mt-2 text-xs text-ink-muted">{t("previewUnavailable")}</p>
        ) : null}
      </section>

      {handoverNote && method === "cash" ? <Callout tone="warning">{t("fieldHandover")}</Callout> : null}

      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}

      <div className={cn("grid gap-3", cancelHref !== undefined && "grid-cols-[1fr_2fr]")}>
        {cancelHref !== undefined ? (
          <Link href={cancelHref} className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}>
            {t("cancel")}
          </Link>
        ) : null}
        <Button type="submit" disabled={pending} size={field ? "field" : "default"}>
          {pending ? t("saving") : t(field ? "fieldSubmit" : "submit")}
        </Button>
      </div>
    </form>
  );
}
