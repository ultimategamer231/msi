"use client";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@/lib/zod-resolver";

import { saveRules, setClock } from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import {
  clockSchema,
  rulesSchema,
  type AllocationComponent,
  type ClockValues,
  type RulesValues,
} from "./schemas";

const COMPONENTS: readonly AllocationComponent[] = ["penalty", "interest", "principal"];
const POSITIONS = ["first", "second", "third"] as const;

export function RulesPanel({
  rules,
  currency,
  clock,
}: {
  rules: RulesValues;
  currency: string;
  clock: { allowed: boolean; now: string; values: ClockValues };
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:gap-5">
      <RulesForm rules={rules} currency={currency} />
      {clock.allowed ? <ClockForm now={clock.now} values={clock.values} /> : null}
    </div>
  );
}

function RulesForm({ rules, currency }: { rules: RulesValues; currency: string }) {
  const t = useTranslations("settings");
  const validation = useValidationText();
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<RulesValues>({ resolver: zodResolver(rulesSchema), defaultValues: rules });
  const errors = form.formState.errors;

  const money = (name: "loanManagerLimit" | "expenseLimit", label: string, help?: string) => {
    const error = validation(errors[name]?.message);
    return (
      <Field id={`rules-${name}`} label={label} help={help} error={error}>
        <div className="relative max-w-56">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted"
          >
            $
          </span>
          <input
            id={`rules-${name}`}
            inputMode="decimal"
            autoComplete="off"
            className={`${inputClass} tabular pl-7`}
            {...describedBy(`rules-${name}`, help, error)}
            {...form.register(name)}
          />
        </div>
      </Field>
    );
  };

  const toggle = (
    name: Exclude<
      keyof RulesValues,
      "loanManagerLimit" | "expenseLimit" | "allocationOrder" | "goLiveDate" | "dueUpcomingDays"
    >,
    label: string,
  ) => <CheckboxRow id={`rules-${name}`} label={label} {...form.register(name)} />;

  const allocationError = validation(
    errors.allocationOrder?.message ?? errors.allocationOrder?.root?.message,
  );

  return (
    <Panel id="rules-heading" title={t("rules.heading")} intro={t("rules.intro")}>
      <form
        noValidate
        className="grid gap-6"
        onSubmit={form.handleSubmit((values) => {
          setStatus(null);
          startTransition(async () => {
            const result = await saveRules(values);
            setStatus(result.ok ? { tone: "success" } : { tone: "error", code: result.code });
            if (result.ok) form.reset(values);
          });
        })}
      >
        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-bold text-ink">{t("rules.approvalsHeading")}</legend>
          {money("loanManagerLimit", t("rules.loanManagerLimit"), t("rules.loanManagerLimitHelp"))}
          {money("expenseLimit", t("rules.expenseLimit"))}
        </fieldset>

        <fieldset className="grid gap-0.5">
          <legend className="mb-2 text-sm font-bold text-ink">{t("rules.controlsHeading")}</legend>
          {toggle("collateralRequired", t("rules.collateralRequired"))}
          {toggle("multiLoan", t("rules.multiLoan"))}
          {toggle("extensionEnabled", t("rules.extensionEnabled"))}
          {toggle("requireRemittance", t("rules.requireRemittance"))}
          {toggle("dayClosesEnforce", t("rules.dayClosesEnforce"))}
          {toggle("checkFunds", t("rules.checkFunds"))}
        </fieldset>

        <Field
          id="rules-dueUpcomingDays"
          label={t("rules.dueUpcomingDays")}
          help={t("rules.dueUpcomingDaysHelp")}
          error={validation(errors.dueUpcomingDays?.message)}
        >
          <input
            id="rules-dueUpcomingDays"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputClass} tabular max-w-24`}
            {...describedBy(
              "rules-dueUpcomingDays",
              t("rules.dueUpcomingDaysHelp"),
              validation(errors.dueUpcomingDays?.message),
            )}
            {...form.register("dueUpcomingDays")}
          />
        </Field>

        <fieldset
          className="grid gap-3"
          aria-describedby={allocationError !== undefined ? "rules-allocation-error" : undefined}
        >
          <legend className="mb-1 text-sm font-bold text-ink">{t("rules.allocationHeading")}</legend>
          <p className="text-sm text-ink-muted">{t("rules.allocationIntro")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {POSITIONS.map((position, index) => (
              <Field key={position} id={`rules-allocation-${index}`} label={t(`rules.${position}`)}>
                <select
                  id={`rules-allocation-${index}`}
                  className={inputClass}
                  {...form.register(`allocationOrder.${index}`)}
                >
                  {COMPONENTS.map((component) => (
                    <option key={component} value={component}>
                      {t(`rules.component.${component}`)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          {allocationError !== undefined ? (
            <p id="rules-allocation-error" className="text-xs font-medium text-status-overdue-strong">
              {allocationError}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-bold text-ink">{t("rules.migrationHeading")}</legend>
          <Field
            id="rules-goLiveDate"
            label={t("rules.goLiveDate")}
            help={t("rules.goLiveHelp")}
            error={validation(errors.goLiveDate?.message)}
          >
            <input
              id="rules-goLiveDate"
              type="date"
              className={`${inputClass} max-w-56`}
              {...describedBy(
                "rules-goLiveDate",
                t("rules.goLiveHelp"),
                validation(errors.goLiveDate?.message),
              )}
              {...form.register("goLiveDate")}
            />
          </Field>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">{t("rules.fixedHeading")}</legend>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-muted">{t("rules.currency")}</dt>
            <dd className="font-semibold text-ink">{currency}</dd>
            <dt className="text-ink-muted">{t("rules.accountingBasis")}</dt>
            <dd className="font-semibold text-ink">{t("rules.accrual")}</dd>
          </dl>
        </fieldset>

        <StatusMessage status={status} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ClockForm({ now, values }: { now: string; values: ClockValues }) {
  const t = useTranslations("settings");
  const validation = useValidationText();
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<ClockValues>({ resolver: zodResolver(clockSchema), defaultValues: values });
  const atError = validation(form.formState.errors.at?.message);

  const submit = (useRealTime: boolean) =>
    form.handleSubmit((input) => {
      setStatus(null);
      startTransition(async () => {
        const result = await setClock({ ...input, useRealTime });
        setStatus(result.ok ? { tone: "success" } : { tone: "error", code: result.code });
      });
    });

  return (
    <Panel id="clock-heading" title={t("rules.clockHeading")} intro={t("rules.clockIntro")}>
      <form noValidate className="grid gap-4" onSubmit={submit(false)}>
        <p className="text-sm font-semibold text-ink" data-testid="clock-now">
          {t("rules.clockCurrent", { time: now })}
        </p>
        <Field id="clock-at" label={t("rules.clockAt")} error={atError}>
          <input
            id="clock-at"
            type="datetime-local"
            className={`${inputClass} max-w-64`}
            {...describedBy("clock-at", undefined, atError)}
            {...form.register("at")}
          />
        </Field>
        <CheckboxRow id="clock-frozen" label={t("rules.clockFrozen")} {...form.register("frozen")} />
        <StatusMessage status={status} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {t("rules.clockSet")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={submit(true)}>
            {t("rules.clockReal")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
