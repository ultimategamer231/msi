"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import type { ErrorCode } from "@/lib/rpc-errors";

import { uploadFiles } from "../collateral/[id]/item-forms";
import {
  openCase,
  paySurplus,
  previewSale,
  recordSale,
  recordStep,
  requestWriteOff,
  type ActionResult,
  type SalePreview,
} from "./actions";

type Result = { tone: "success" } | { tone: "error"; code: ErrorCode } | null;

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const run = (action: () => Promise<ActionResult>, onDone?: (outcome: ActionResult) => void) => {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome.ok ? { tone: "success" } : { tone: "error", code: outcome.code });
      if (outcome.ok) {
        onDone?.(outcome);
        router.refresh();
      }
    });
  };
  return { pending, result, run, router };
}

function Outcome({ result, success }: { result: Result; success?: string }) {
  const tErrors = useTranslations("errors");
  if (result === null) return null;
  if (result.tone === "error") return <FormMessage tone="error">{tErrors(result.code)}</FormMessage>;
  return success === undefined ? null : <FormMessage tone="success">{success}</FormMessage>;
}

function Panel({
  id,
  title,
  children,
  onCancel,
  cancel,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  cancel: string;
}) {
  return (
    <div
      role="dialog"
      aria-labelledby={id}
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h3 id={id} className="text-sm font-bold text-ink">
        {title}
      </h3>
      {children}
      <div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </div>
  );
}

/* Open a recovery case (SPEC 5.7): manager or CEO, loan eligible. */
export function OpenCaseForm({ loanId }: { loanId: string }) {
  const t = useTranslations("recovery.open");
  const { pending, result, run, router } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
    );
  return (
    <Panel id={`open-${loanId}`} title={t("heading")} onCancel={() => setOpen(false)} cancel={t("cancel")}>
      <p className="text-sm text-ink-muted">{t("intro")}</p>
      <Field id={`open-note-${loanId}`} label={t("note")}>
        <input
          id={`open-note-${loanId}`}
          className={inputClass}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <Outcome result={result} />
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => openCase(loanId, note),
              (outcome) => {
                if (outcome.ok && outcome.id !== undefined) router.push(`/recovery/${outcome.id}`);
              },
            )
          }
        >
          {pending ? t("saving") : t("confirm")}
        </Button>
      </div>
    </Panel>
  );
}

/* Record the next court step with a note, a reference and an optional document. */
export function StepForm({ caseId, stages }: { caseId: string; stages: readonly string[] }) {
  const t = useTranslations("recovery.step");
  const tStages = useTranslations("approvals.recoveryStages");
  const { pending, result, run } = useRun();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState(stages[0] ?? "");
  const [note, setNote] = useState("");
  const [courtRef, setCourtRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [missing, setMissing] = useState(false);
  if (stages.length === 0) return null;
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
    );
  return (
    <Panel id={`step-${caseId}`} title={t("heading")} onCancel={() => setOpen(false)} cancel={t("cancel")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="step-stage" label={t("stage")}>
          <select
            id="step-stage"
            className={inputClass}
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {stages.map((option) => (
              <option key={option} value={option}>
                {tStages(option as "notice_sent")}
              </option>
            ))}
          </select>
        </Field>
        <Field id="step-ref" label={t("courtRef")}>
          <input
            id="step-ref"
            className={inputClass}
            value={courtRef}
            maxLength={100}
            onChange={(event) => setCourtRef(event.target.value)}
          />
        </Field>
        <Field
          id="step-note"
          label={t("note")}
          error={missing ? t("noteRequired") : undefined}
          className="sm:col-span-2"
        >
          <input
            id="step-note"
            className={inputClass}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            {...describedBy("step-note", undefined, missing ? t("noteRequired") : undefined)}
          />
        </Field>
        <Field id="step-file" label={t("file")} className="sm:col-span-2">
          <input
            id="step-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <Outcome result={result} success={t("saved")} />
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (note.trim() === "") {
              setMissing(true);
              return;
            }
            setMissing(false);
            run(
              async () => {
                let upload = null;
                if (file !== null) {
                  const uploaded = await uploadFiles([file], "other");
                  if (!uploaded.ok) return uploaded;
                  upload = uploaded.files[0] ?? null;
                }
                return recordStep(caseId, stage, note, courtRef, upload);
              },
              () => setOpen(false),
            );
          }}
        >
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </Panel>
  );
}

export interface SeizedItem {
  id: string;
  code: string;
  description: string;
}

type Preview = Extract<SalePreview, { ok: true }>;

/* Sale with a live preview from the database (mock-up 13 "Sale preview"). */
export function SaleForm({
  caseId,
  loanId,
  items,
  initial,
}: {
  caseId: string;
  loanId: string;
  items: SeizedItem[];
  initial: Preview;
}) {
  const t = useTranslations("recovery.sale");
  const tMethods = useTranslations("payments.methods");
  const { pending, result, run } = useRun();
  const [, startPreview] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [preview, setPreview] = useState<Preview>(initial);
  const [values, setValues] = useState({
    collateralId: items[0]?.id ?? "",
    amount: "",
    buyer: "",
    method: "cash",
    courtRef: "",
  });
  const [confirming, setConfirming] = useState(false);
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const ask = (amount: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startPreview(async () => {
        const next = await previewSale(caseId, amount);
        if (next.ok) setPreview(next);
      });
    }, 250);
  };
  const rows = [
    ["penalty", preview.allocation.penalty],
    ["interest", preview.allocation.interest],
    ["principal", preview.allocation.principal],
  ] as const;
  const total =
    BigInt(preview.allocation.penalty) +
    BigInt(preview.allocation.interest) +
    BigInt(preview.allocation.principal);

  return (
    <section
      aria-labelledby="sale-heading"
      className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <h3 id="sale-heading" className="text-base font-bold text-ink">
        {t("heading")}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noItems")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sale-item" label={t("item")}>
              <select
                id="sale-item"
                className={inputClass}
                value={values.collateralId}
                onChange={(event) => set("collateralId", event.target.value)}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="sale-amount" label={t("amount")}>
              <input
                id="sale-amount"
                inputMode="decimal"
                className={`${inputClass} tabular`}
                value={values.amount}
                onChange={(event) => {
                  set("amount", event.target.value);
                  ask(event.target.value);
                }}
              />
            </Field>
            <Field id="sale-buyer" label={t("buyer")}>
              <input
                id="sale-buyer"
                className={inputClass}
                value={values.buyer}
                maxLength={120}
                onChange={(event) => set("buyer", event.target.value)}
              />
            </Field>
            <Field id="sale-method" label={t("method")}>
              <select
                id="sale-method"
                className={inputClass}
                value={values.method}
                onChange={(event) => set("method", event.target.value)}
              >
                {(["cash", "bank", "mobile_money"] as const).map((method) => (
                  <option key={method} value={method}>
                    {tMethods(method)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="sale-ref" label={t("courtRef")} className="sm:col-span-2">
              <input
                id="sale-ref"
                className={inputClass}
                value={values.courtRef}
                maxLength={100}
                onChange={(event) => set("courtRef", event.target.value)}
              />
            </Field>
          </div>
          <p className="text-sm text-ink-muted">{t("order")}</p>
          <dl aria-live="polite" className="grid gap-1.5 text-sm">
            {rows.map(([component, cents]) => (
              <div key={component} className="flex justify-between gap-3 border-b border-page py-1">
                <dt>{t(`components.${component}`)}</dt>
                <dd className="tabular">{formatMoney(cents)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-1 font-bold">
              <dt>{t("applied")}</dt>
              <dd className="tabular">{formatMoney(total)}</dd>
            </div>
          </dl>
          {BigInt(preview.shortfallCents) > 0n && values.amount.trim() !== "" ? (
            <p className="rounded-control bg-warning-bg px-3 py-2 text-sm text-status-overdue-fg">
              {t("shortfall", { amount: formatMoney(preview.shortfallCents) })}
            </p>
          ) : null}
          {BigInt(preview.surplusCents) > 0n ? (
            <p className="rounded-control bg-subtle px-3 py-2 text-sm text-ink">
              {t("surplus", { amount: formatMoney(preview.surplusCents) })}
            </p>
          ) : null}
          <Outcome result={result} success={t("done")} />
          {confirming ? (
            <div
              role="alertdialog"
              aria-labelledby="sale-confirm"
              className="grid gap-2 rounded-control bg-subtle p-3"
            >
              <p id="sale-confirm" className="text-sm font-semibold text-ink">
                {t("confirm", { amount: values.amount, buyer: values.buyer })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => recordSale(caseId, loanId, values),
                      () => setConfirming(false),
                    )
                  }
                >
                  {pending ? t("saving") : t("yes")}
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={values.amount.trim() === "" || values.buyer.trim() === ""}
                onClick={() => setConfirming(true)}
              >
                {t("record")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* Pay the surplus to the borrower (R7b). */
export function SurplusForm({
  caseId,
  loanId,
  surplus,
}: {
  caseId: string;
  loanId: string;
  surplus: string;
}) {
  const t = useTranslations("recovery.surplus");
  const tMethods = useTranslations("payments.methods");
  const { pending, result, run } = useRun();
  const [method, setMethod] = useState("cash");
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <Field id="surplus-method" label={t("method")}>
        <select
          id="surplus-method"
          className={inputClass}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
        >
          {(["cash", "bank", "mobile_money"] as const).map((option) => (
            <option key={option} value={option}>
              {tMethods(option)}
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => paySurplus(caseId, loanId, surplus, method))}
      >
        {pending ? t("saving") : t("pay", { amount: surplus })}
      </Button>
      <div className="sm:col-span-2">
        <Outcome result={result} success={t("done")} />
      </div>
    </div>
  );
}

/* Ask for a write-off (SPEC 5.8); the CEO decides with the board reference. */
export function WriteOffForm({ loanId, override }: { loanId: string; override: boolean }) {
  const t = useTranslations("recovery.writeOff");
  const { pending, result, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const minimum = override ? 20 : 1;
  if (!open)
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("button")}
      </Button>
    );
  return (
    <Panel
      id={`write-off-${loanId}`}
      title={t("heading")}
      onCancel={() => setOpen(false)}
      cancel={t("cancel")}
    >
      <p className="text-sm text-ink-muted">{t(override ? "introOverride" : "intro")}</p>
      <Field
        id="write-off-reason"
        label={t("reason")}
        error={missing ? t(override ? "reasonLong" : "reasonRequired") : undefined}
      >
        <input
          id="write-off-reason"
          className={inputClass}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          {...describedBy("write-off-reason", undefined, missing ? t("reasonRequired") : undefined)}
        />
      </Field>
      <Outcome result={result} success={t("sent")} />
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (reason.trim().length < minimum) {
              setMissing(true);
              return;
            }
            setMissing(false);
            run(() => requestWriteOff(loanId, reason));
          }}
        >
          {pending ? t("saving") : t("send")}
        </Button>
      </div>
    </Panel>
  );
}
