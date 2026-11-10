"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, FormMessage, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { DOCUMENT_MAX_BYTES } from "@/lib/file-type";
import type { ErrorCode } from "@/lib/rpc-errors";
import { shrinkImage } from "@/lib/shrink-image";
import { zodResolver } from "@/lib/zod-resolver";

import { uploadCustomerFile } from "../customers/actions";
import { createExpense, settleExpense } from "./actions";
import { expenseSchema, type ExpenseValues } from "./schemas";

interface MoneyAccount {
  code: string;
  name: string;
  branchId: string | null;
}

type Status = { tone: "success"; text: string } | { tone: "error"; code: ErrorCode } | null;

/* New expense (SPEC 7.6, R9/R9b): paid now from cash, bank or mobile money, or on credit to a payee. */
export function ExpenseForm({
  today,
  expenseAccounts,
  moneyAccounts,
  branches,
  payees,
  defaultBranch,
}: {
  today: string;
  expenseAccounts: Array<{ code: string; name: string }>;
  moneyAccounts: MoneyAccount[];
  branches: Array<{ id: string; name: string }>;
  payees: Array<{ id: string; name: string }>;
  defaultBranch: string;
}) {
  const t = useTranslations("expenses.form");
  const tValidation = useTranslations("expenses.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);
  const [file, setFile] = useState<File | null>(null);
  const defaults: ExpenseValues = {
    account: "",
    amount: "",
    expenseDate: today,
    description: "",
    branchId: defaultBranch,
    payeeId: "",
    paidNow: true,
    paidFrom: "",
  };
  const form = useForm<ExpenseValues>({ resolver: zodResolver(expenseSchema), defaultValues: defaults });
  const errors = form.formState.errors;
  const paidNow = useWatch({ control: form.control, name: "paidNow" });
  const branchId = useWatch({ control: form.control, name: "branchId" });
  const text = (key: string | undefined) => (key === undefined ? undefined : tValidation(key as "amount"));
  const fromOptions = moneyAccounts.filter(
    (account) => account.branchId === null || account.branchId === branchId,
  );

  const submit = (values: ExpenseValues) => {
    setStatus(null);
    startTransition(async () => {
      let receipt: { storagePath: string; fileName: string } | null = null;
      if (file !== null) {
        const prepared = await shrinkImage(file);
        if (prepared.size > DOCUMENT_MAX_BYTES) {
          setStatus({ tone: "error", code: "UPLOAD_REJECTED" });
          return;
        }
        const body = new FormData();
        body.set("file", prepared);
        const upload = await uploadCustomerFile(body);
        if (!upload.ok) {
          setStatus({ tone: "error", code: upload.code });
          return;
        }
        receipt = { storagePath: upload.storagePath, fileName: upload.fileName };
      }
      const result = await createExpense(values, receipt);
      if (!result.ok) {
        setStatus({ tone: "error", code: result.code });
        return;
      }
      setStatus({
        tone: "success",
        text: t(result.data.status === "pending_approval" ? "sentForApproval" : "saved", {
          number: result.data.number,
        }),
      });
      form.reset({ ...defaults, branchId: values.branchId });
      setFile(null);
      router.refresh();
    });
  };

  return (
    <Panel id="expense-new" title={t("heading")}>
      <form noValidate className="grid gap-4" onSubmit={(event) => void form.handleSubmit(submit)(event)}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="expense-date" label={t("date")} error={text(errors.expenseDate?.message)}>
            <input
              id="expense-date"
              type="date"
              max={today}
              className={inputClass}
              {...form.register("expenseDate")}
            />
          </Field>
          <Field id="expense-account" label={t("account")} error={text(errors.account?.message)}>
            <select
              id="expense-account"
              className={inputClass}
              {...describedBy("expense-account", undefined, text(errors.account?.message))}
              {...form.register("account")}
            >
              <option value="">{t("chooseAccount")}</option>
              {expenseAccounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="expense-amount" label={t("amount")} error={text(errors.amount?.message)}>
            <input
              id="expense-amount"
              inputMode="decimal"
              autoComplete="off"
              className={`${inputClass} tabular text-right`}
              {...describedBy("expense-amount", undefined, text(errors.amount?.message))}
              {...form.register("amount")}
            />
          </Field>
          <Field id="expense-branch" label={t("branch")} error={text(errors.branchId?.message)}>
            <select id="expense-branch" className={inputClass} {...form.register("branchId")}>
              <option value="">{t("chooseBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="expense-description" label={t("description")} error={text(errors.description?.message)}>
          <input
            id="expense-description"
            autoComplete="off"
            className={inputClass}
            {...describedBy("expense-description", undefined, text(errors.description?.message))}
            {...form.register("description")}
          />
        </Field>
        <fieldset className="grid gap-2">
          <legend className="text-xs font-semibold text-ink-muted">{t("howPaid")}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                checked={paidNow}
                onChange={() => form.setValue("paidNow", true)}
                className="size-4 accent-primary"
              />
              {t("paidNow")}
            </label>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                checked={!paidNow}
                onChange={() => form.setValue("paidNow", false)}
                className="size-4 accent-primary"
              />
              {t("onCredit")}
            </label>
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          {paidNow ? (
            <Field id="expense-from" label={t("paidFrom")} error={text(errors.paidFrom?.message)}>
              <select
                id="expense-from"
                className={inputClass}
                {...describedBy("expense-from", undefined, text(errors.paidFrom?.message))}
                {...form.register("paidFrom")}
              >
                <option value="">{t("chooseFrom")}</option>
                {fromOptions.map((account) => (
                  <option key={account.code} value={account.code}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            id="expense-payee"
            label={paidNow ? t("payeeOptional") : t("payee")}
            error={text(errors.payeeId?.message)}
          >
            <select
              id="expense-payee"
              className={inputClass}
              {...describedBy("expense-payee", undefined, text(errors.payeeId?.message))}
              {...form.register("payeeId")}
            >
              <option value="">{t("noPayee")}</option>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.id}>
                  {payee.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="expense-receipt" label={t("receipt")}>
            <input
              id="expense-receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="min-h-11 text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        {status?.tone === "success" ? <FormMessage tone="success">{status.text}</FormMessage> : null}
        {status?.tone === "error" ? <FormMessage tone="error">{tErrors(status.code)}</FormMessage> : null}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/* Pay a payee for an expense taken on credit (R9c). */
export function SettleForm({
  expenseId,
  expenseNo,
  accounts,
}: {
  expenseId: string;
  expenseNo: string;
  accounts: MoneyAccount[];
}) {
  const t = useTranslations("expenses.settle");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [account, setAccount] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const id = `settle-${expenseId}`;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (account === "") return;
        setError(null);
        startTransition(async () => {
          const result = await settleExpense(expenseId, account);
          if (result.ok) router.refresh();
          else setError(result.code);
        });
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("from", { number: expenseNo })}
      </label>
      <select
        id={id}
        value={account}
        onChange={(event) => setAccount(event.target.value)}
        className={`${inputClass} w-auto`}
      >
        <option value="">{t("choose")}</option>
        {accounts.map((option) => (
          <option key={option.code} value={option.code}>
            {option.code}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" disabled={pending || account === ""}>
        {t("pay")}
      </Button>
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
    </form>
  );
}
