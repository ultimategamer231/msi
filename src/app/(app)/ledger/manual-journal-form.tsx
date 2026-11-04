"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { Field, FormMessage, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/money-input";
import type { ErrorCode } from "@/lib/rpc-errors";
import { zodResolver } from "@/lib/zod-resolver";

import { requestManualJournal } from "./actions";
import { manualJournalSchema, type ManualJournalValues } from "./schemas";

export interface AccountOption {
  code: string;
  name: string;
}

export interface BranchOption {
  id: string;
  label: string;
}

const EMPTY_LINE = { account: "", debit: "", credit: "" };

/* Sum of what was typed, for the live "balanced" hint only. The server validates and posts. */
function sumCents(values: string[]): bigint {
  return values.reduce(
    (sum, value) => sum + (value.trim() === "" ? 0n : (parseDollarsToCents(value) ?? 0n)),
    0n,
  );
}

export function ManualJournalForm({
  accounts,
  branches,
  today,
}: {
  accounts: AccountOption[];
  branches: BranchOption[];
  today: string;
}) {
  const t = useTranslations("ledger.manual");
  const tValidation = useTranslations("settings.validation");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ tone: "success" } | { tone: "error"; code: ErrorCode } | null>(null);

  const defaults: ManualJournalValues = {
    entryDate: today,
    memo: "",
    branchId: "",
    lines: [EMPTY_LINE, EMPTY_LINE],
  };
  const form = useForm<ManualJournalValues>({
    resolver: zodResolver(manualJournalSchema),
    defaultValues: defaults,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = useWatch({ control: form.control, name: "lines" }) ?? [];
  const debit = sumCents(lines.map((line) => line.debit));
  const credit = sumCents(lines.map((line) => line.credit));
  const difference = debit > credit ? debit - credit : credit - debit;

  const text = (key: string | undefined) => {
    if (key === undefined) return undefined;
    if (["accountRequired", "lineError", "minLines"].includes(key)) return t(key as "lineError");
    return tValidation(key as "required");
  };
  const errors = form.formState.errors;

  return (
    <Panel id="manual-heading" title={t("heading")} intro={t("intro")}>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={form.handleSubmit((values) => {
          setStatus(null);
          startTransition(async () => {
            const result = await requestManualJournal(values);
            if (result.ok) {
              setStatus({ tone: "success" });
              form.reset(defaults);
            } else {
              setStatus({ tone: "error", code: result.code });
            }
          });
        })}
      >
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id="manual-date" label={t("date")} error={text(errors.entryDate?.message)}>
            <input
              id="manual-date"
              type="date"
              max={today}
              className={inputClass}
              {...form.register("entryDate")}
            />
          </Field>
          <Field id="manual-branch" label={t("branch")}>
            <select id="manual-branch" className={inputClass} {...form.register("branchId")}>
              <option value="">{t("noBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="manual-memo" label={t("memo")} error={text(errors.memo?.message)}>
          <textarea
            id="manual-memo"
            rows={2}
            className={`${inputClass} py-2 leading-6`}
            {...describedBy("manual-memo", undefined, text(errors.memo?.message))}
            {...form.register("memo")}
          />
        </Field>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">{t("linesLabel")}</legend>
          {fields.map((field, index) => {
            const lineError = errors.lines?.[index];
            const message = text(lineError?.account?.message ?? lineError?.debit?.message);
            return (
              <div
                key={field.id}
                className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end sm:border-0 sm:p-0"
              >
                <Field
                  id={`line-${index}-account`}
                  label={`${t("lineLabel", { number: index + 1 })}: ${t("account")}`}
                >
                  <select
                    id={`line-${index}-account`}
                    className={inputClass}
                    {...form.register(`lines.${index}.account`)}
                  >
                    <option value="">{t("chooseAccount")}</option>
                    {accounts.map((account) => (
                      <option key={account.code} value={account.code}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={`line-${index}-debit`} label={t("debit")}>
                  <input
                    id={`line-${index}-debit`}
                    inputMode="decimal"
                    autoComplete="off"
                    className={`${inputClass} tabular text-right`}
                    {...form.register(`lines.${index}.debit`)}
                  />
                </Field>
                <Field id={`line-${index}-credit`} label={t("credit")}>
                  <input
                    id={`line-${index}-credit`}
                    inputMode="decimal"
                    autoComplete="off"
                    className={`${inputClass} tabular text-right`}
                    {...form.register(`lines.${index}.credit`)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={fields.length <= 2}
                  onClick={() => remove(index)}
                  aria-label={t("removeLine", { number: index + 1 })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
                {message !== undefined ? (
                  <p className="text-xs font-medium text-status-overdue-strong sm:col-span-4">{message}</p>
                ) : null}
              </div>
            );
          })}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => append(EMPTY_LINE)}>
              <Plus aria-hidden="true" />
              {t("addLine")}
            </Button>
          </div>
          <p className="tabular text-sm text-ink-muted" aria-live="polite">
            {t("totals", { debit: formatMoney(debit), credit: formatMoney(credit) })}
            {debit === 0n && credit === 0n ? null : (
              <>
                {" · "}
                {difference === 0n ? (
                  <span className="font-semibold text-status-active-fg">{t("balanced")}</span>
                ) : (
                  <span className="font-semibold text-status-overdue-strong">
                    {t("difference", { difference: formatMoney(difference) })}
                  </span>
                )}
              </>
            )}
          </p>
        </fieldset>

        {status?.tone === "success" ? <FormMessage tone="success">{t("sent")}</FormMessage> : null}
        {status?.tone === "error" ? <FormMessage tone="error">{tErrors(status.code)}</FormMessage> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
