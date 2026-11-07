"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { ErrorCode } from "@/lib/rpc-errors";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { previewPayment, receivePayment, type PreviewResult } from "../actions";
import { PAYMENT_METHODS, paymentSchema, type PaymentValues } from "../schemas";

type Preview = Extract<PreviewResult, { ok: true }>;

/*
 * The receive-payment form (mock-up 03). The request key is made once when the page opens, so a
 * double tap or a retry after a lost connection returns the same receipt (T-12). The allocation
 * preview is asked from the database as the amount changes (SPEC 5.2).
 */
export function PaymentForm({
  loanId,
  cancelHref,
  todayLabel,
  initial,
}: {
  loanId: string;
  cancelHref: string;
  todayLabel: string;
  initial: Preview;
}) {
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
            const result = await receivePayment(values);
            if (result.ok) router.push(`/receipts/${result.paymentId}`);
            else setError(result.code);
          });
        })(event)
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id="payment-amount" label={t("amount")} error={text(errors.amount?.message)}>
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
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-xs font-semibold text-ink-muted">{t("method")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_METHODS.map((option) => (
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
          label={t("reference")}
          help={t(method === "bank" ? "referenceHelpBank" : "referenceHelpMomo")}
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
          {t("preview")}
        </h3>
        <dl className="mt-2 grid gap-1.5 text-sm">
          {rows.map(([component, cents]) => (
            <div key={component} className="flex justify-between gap-3">
              <dt className="text-ink">{t(`components.${component}`)}</dt>
              <dd className="tabular font-semibold text-ink">{formatMoney(cents)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-ink-muted">{t("after")}</dt>
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

      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Link href={cancelHref} className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}>
          {t("cancel")}
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
