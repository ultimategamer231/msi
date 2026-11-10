"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Field, FormMessage, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";
import { zodResolver } from "@/lib/zod-resolver";

import { requestCapitalIn } from "./actions";
import type { AccountOption } from "./manual-journal-form";
import { capitalInSchema, type CapitalInValues } from "./schemas";

/* Capital in (recipe R10, R-14): sent for a manager's approval, posted only when approved. */
export function CapitalInForm({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const t = useTranslations("ledger.capital");
  const tManual = useTranslations("ledger.manual");
  const tValidation = useTranslations("settings.validation");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "success" } | { tone: "error"; code: ErrorCode } | null>(null);
  const defaults: CapitalInValues = { entryDate: today, account: "", amount: "", memo: "", reference: "" };
  const form = useForm<CapitalInValues>({ resolver: zodResolver(capitalInSchema), defaultValues: defaults });
  const errors = form.formState.errors;
  const text = (key: string | undefined) => {
    if (key === undefined) return undefined;
    if (key === "accountRequired") return tManual("accountRequired");
    return tValidation(key as "required");
  };

  return (
    <Panel id="capital-heading" title={t("heading")} intro={t("intro")}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            setStatus(null);
            startTransition(async () => {
              const result = await requestCapitalIn(values);
              if (result.ok) {
                setStatus({ tone: "success" });
                form.reset(defaults);
              } else {
                setStatus({ tone: "error", code: result.code });
              }
            });
          })(event)
        }
      >
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr_10rem]">
          <Field id="capital-date" label={t("date")} error={text(errors.entryDate?.message)}>
            <input
              id="capital-date"
              type="date"
              max={today}
              className={inputClass}
              {...form.register("entryDate")}
            />
          </Field>
          <Field id="capital-account" label={t("account")} error={text(errors.account?.message)}>
            <select
              id="capital-account"
              className={inputClass}
              {...describedBy("capital-account", undefined, text(errors.account?.message))}
              {...form.register("account")}
            >
              <option value="">{tManual("chooseAccount")}</option>
              {accounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="capital-amount" label={t("amount")} error={text(errors.amount?.message)}>
            <input
              id="capital-amount"
              inputMode="decimal"
              autoComplete="off"
              className={`${inputClass} tabular text-right`}
              {...describedBy("capital-amount", undefined, text(errors.amount?.message))}
              {...form.register("amount")}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <Field id="capital-memo" label={t("memo")} error={text(errors.memo?.message)}>
            <input
              id="capital-memo"
              autoComplete="off"
              className={inputClass}
              {...describedBy("capital-memo", undefined, text(errors.memo?.message))}
              {...form.register("memo")}
            />
          </Field>
          <Field id="capital-reference" label={t("reference")} error={text(errors.reference?.message)}>
            <input
              id="capital-reference"
              autoComplete="off"
              className={inputClass}
              {...form.register("reference")}
            />
          </Field>
        </div>
        {status?.tone === "success" ? <FormMessage tone="success">{tManual("sent")}</FormMessage> : null}
        {status?.tone === "error" ? <FormMessage tone="error">{tErrors(status.code)}</FormMessage> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? tManual("submitting") : tManual("submit")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
