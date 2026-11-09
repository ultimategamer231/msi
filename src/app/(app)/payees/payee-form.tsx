"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, FormMessage, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";
import { zodResolver } from "@/lib/zod-resolver";

import { savePayee } from "../expenses/actions";
import { PAYEE_TYPES, payeeSchema, type PayeeValues } from "../expenses/schemas";

/* New payee (a panel) or an edit (opens in place from the list). */
export function PayeeForm({ payee }: { payee: (PayeeValues & { id: string }) | null }) {
  const t = useTranslations("payees.form");
  const tTypes = useTranslations("payees.types");
  const tValidation = useTranslations("expenses.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(payee === null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "success" } | { tone: "error"; code: ErrorCode } | null>(null);
  const defaults: PayeeValues = payee ?? { name: "", type: "supplier", phone: "", notes: "", active: true };
  const form = useForm<PayeeValues>({ resolver: zodResolver(payeeSchema), defaultValues: defaults });
  const errors = form.formState.errors;
  const prefix = payee === null ? "payee-new" : `payee-${payee.id}`;
  const text = (key: string | undefined) => (key === undefined ? undefined : tValidation(key as "name"));

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={t("editLabel", { name: payee?.name ?? "" })}
      >
        {t("edit")}
      </Button>
    );
  }

  const body = (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setStatus(null);
          startTransition(async () => {
            const result = await savePayee(payee?.id ?? null, values);
            if (!result.ok) {
              setStatus({ tone: "error", code: result.code });
              return;
            }
            setStatus({ tone: "success" });
            if (payee === null) form.reset(defaults);
            else setOpen(false);
            router.refresh();
          });
        })(event)
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${prefix}-name`} label={t("name")} error={text(errors.name?.message)}>
          <input
            id={`${prefix}-name`}
            autoComplete="off"
            className={inputClass}
            {...describedBy(`${prefix}-name`, undefined, text(errors.name?.message))}
            {...form.register("name")}
          />
        </Field>
        <Field id={`${prefix}-type`} label={t("type")}>
          <select id={`${prefix}-type`} className={inputClass} {...form.register("type")}>
            {PAYEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {tTypes(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${prefix}-phone`} label={t("phone")} error={text(errors.phone?.message)}>
          <input
            id={`${prefix}-phone`}
            type="tel"
            autoComplete="off"
            className={inputClass}
            {...form.register("phone")}
          />
        </Field>
      </div>
      <Field id={`${prefix}-notes`} label={t("notes")} error={text(errors.notes?.message)}>
        <input id={`${prefix}-notes`} autoComplete="off" className={inputClass} {...form.register("notes")} />
      </Field>
      {payee !== null ? (
        <CheckboxRow id={`${prefix}-active`} label={t("active")} {...form.register("active")} />
      ) : null}
      {status?.tone === "success" && payee === null ? (
        <FormMessage tone="success">{t("saved")}</FormMessage>
      ) : null}
      {status?.tone === "error" ? <FormMessage tone="error">{tErrors(status.code)}</FormMessage> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {payee !== null ? (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
  return payee === null ? (
    <Panel id="payee-new-heading" title={t("heading")}>
      {body}
    </Panel>
  ) : (
    body
  );
}
