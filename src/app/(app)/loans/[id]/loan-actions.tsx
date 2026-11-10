"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";

import { cancelLoan, disburseLoan, requestExtension, submitDraft } from "../actions";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ErrorCode | null>(null);
  const run = (action: () => Promise<{ ok: true } | { ok: false; code: ErrorCode }>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onDone?.();
        router.refresh();
      } else {
        setError(result.code);
      }
    });
  };
  return { pending, error, run };
}

function ErrorText({ error }: { error: ErrorCode | null }) {
  const tErrors = useTranslations("errors");
  return error === null ? null : <FormMessage tone="error">{tErrors(error)}</FormMessage>;
}

/* The draft's creator sends it for approval (SPEC 5.3). */
export function SubmitDraftButton({ loanId }: { loanId: string }) {
  const t = useTranslations("loans.detail.actions");
  const { pending, error, run } = useAction();
  return (
    <div className="grid gap-2">
      <div>
        <Button type="button" disabled={pending} onClick={() => run(() => submitDraft(loanId))}>
          {pending ? t("sending") : t("submit")}
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

/* Cancel with a confirmation and a reason (SPEC 9: destructive actions confirm). */
export function CancelLoanForm({
  loanId,
  loanNo,
  needsReason,
}: {
  loanId: string;
  loanNo: string;
  needsReason: boolean;
}) {
  const t = useTranslations("loans.detail.actions");
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  if (!open) {
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {t("cancel")}
        </Button>
      </div>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-labelledby="cancel-loan-title"
      className="grid gap-3 rounded-control border border-warning-border bg-warning-bg p-4 text-status-overdue-fg"
    >
      <p id="cancel-loan-title" className="text-sm font-semibold">
        {t("cancelConfirm", { loan: loanNo })}
      </p>
      <Field
        id="cancel-reason"
        label={needsReason ? t("cancelReason") : t("cancelReasonOptional")}
        error={missing ? t("reasonRequired") : undefined}
      >
        <input
          id="cancel-reason"
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          {...describedBy("cancel-reason", undefined, missing ? t("reasonRequired") : undefined)}
        />
      </Field>
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (needsReason && reason.trim() === "") {
              setMissing(true);
              return;
            }
            setMissing(false);
            run(
              () => cancelLoan(loanId, reason),
              () => setOpen(false),
            );
          }}
        >
          {pending ? t("sending") : t("yesCancel")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("keep")}
        </Button>
      </div>
    </div>
  );
}

/* Cashier pays out an approved loan (R1). The account follows the method; today's date. */
export function DisburseForm({
  loanId,
  amount,
  cashAccount,
}: {
  loanId: string;
  amount: string;
  cashAccount: string;
}) {
  const t = useTranslations("loans.detail.actions");
  const { pending, error, run } = useAction();
  const [method, setMethod] = useState<"cash" | "mobile_money" | "bank" | "cheque">("cash");
  const [confirming, setConfirming] = useState(false);
  const [cheque, setCheque] = useState("");
  const [chequeMissing, setChequeMissing] = useState(false);
  const accountLabel =
    method === "cash"
      ? cashAccount
      : method === "bank" || method === "cheque"
        ? t("bankAccount")
        : t("momoAccount");
  return (
    <div className="grid gap-3 rounded-control border border-line p-4">
      <h3 className="text-sm font-bold text-ink">{t("disburseHeading")}</h3>
      <Field id="disburse-method" label={t("method")} help={t("paidFrom", { account: accountLabel })}>
        <select
          id="disburse-method"
          className={inputClass}
          value={method}
          onChange={(event) => {
            setMethod(event.target.value as "cash" | "mobile_money" | "bank" | "cheque");
            setConfirming(false);
          }}
          {...describedBy("disburse-method", "help", undefined)}
        >
          <option value="cash">{t("methods.cash")}</option>
          <option value="mobile_money">{t("methods.mobile_money")}</option>
          <option value="cheque">{t("methods.cheque")}</option>
          <option value="bank">{t("methods.bank")}</option>
        </select>
      </Field>
      {method === "cheque" ? (
        <Field
          id="disburse-cheque"
          label={t("chequeNumber")}
          error={chequeMissing ? t("chequeMissing") : undefined}
        >
          <input
            id="disburse-cheque"
            autoComplete="off"
            maxLength={100}
            value={cheque}
            onChange={(event) => {
              setCheque(event.target.value);
              setChequeMissing(false);
            }}
            className={inputClass}
            {...describedBy("disburse-cheque", undefined, chequeMissing ? t("chequeMissing") : undefined)}
          />
        </Field>
      ) : null}
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="disburse-confirm"
          className="grid gap-3 rounded-control bg-subtle p-3"
        >
          <p id="disburse-confirm" className="text-sm font-semibold text-ink">
            {t("disburseConfirm", { amount, account: accountLabel })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => disburseLoan(loanId, method, method === "cheque" ? cheque.trim() : ""),
                  () => setConfirming(false),
                )
              }
            >
              {pending ? t("sending") : t("yesDisburse")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              {t("keep")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            onClick={() => {
              if (method === "cheque" && cheque.trim().length < 4) {
                setChequeMissing(true);
                return;
              }
              setConfirming(true);
            }}
          >
            {t("disburse")}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/* Ask for more time (SPEC 5.6; FR-18): extra months and a reason; another manager or the CEO decides. */
export function ExtendLoanForm({ loanId, maxMonths }: { loanId: string; maxMonths: number }) {
  const t = useTranslations("loans.detail.extend");
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(1);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
    );
  }
  return (
    <div
      role="dialog"
      aria-labelledby="extend-title"
      className="grid gap-3 rounded-control border border-line bg-surface p-4"
    >
      <h3 id="extend-title" className="text-sm font-bold text-ink">
        {t("heading")}
      </h3>
      <p className="text-sm text-ink-muted">{t("intro")}</p>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field id="extend-months" label={t("months")}>
          <select
            id="extend-months"
            className={inputClass}
            value={months}
            onChange={(event) => setMonths(Number(event.target.value))}
          >
            {Array.from({ length: maxMonths }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {t("monthsOption", { count: value })}
              </option>
            ))}
          </select>
        </Field>
        <Field id="extend-reason" label={t("reason")} error={missing ? t("reasonRequired") : undefined}>
          <input
            id="extend-reason"
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
            {...describedBy("extend-reason", undefined, missing ? t("reasonRequired") : undefined)}
          />
        </Field>
      </div>
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            if (reason.trim() === "") {
              setMissing(true);
              return;
            }
            setMissing(false);
            run(
              () => requestExtension(loanId, months, reason),
              () => setOpen(false),
            );
          }}
        >
          {pending ? t("sending") : t("send")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
