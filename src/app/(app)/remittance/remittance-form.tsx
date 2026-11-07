"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/money-input";
import type { ErrorCode } from "@/lib/rpc-errors";

import { confirmRemittance } from "../payments/actions";

export interface PendingCollection {
  id: string;
  receiptNo: string;
  customer: string;
  loanNo: string;
  amountCents: string;
  receivedOn: string;
}

export interface CollectorGroup {
  officerId: string;
  officer: string;
  items: PendingCollection[];
}

/*
 * Confirm field cash handed over (SPEC 5.4.3, 9 /remittance): tick the collections in the officer's
 * hand, count the cash, enter the counted total. The database refuses a total that does not match
 * the selection (T-36) and posts nothing.
 */
export function RemittanceForm({ groups }: { groups: CollectorGroup[] }) {
  const t = useTranslations("remittance");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [countError, setCountError] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const all = groups.flatMap((group) => group.items);
  const selectedTotal = all
    .filter((item) => selected.has(item.id))
    .reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
  const toggle = (ids: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setDone(null);
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const cents = parseDollarsToCents(counted);
        if (cents === null || cents <= 0n) {
          setCountError(true);
          return;
        }
        setCountError(false);
        setError(null);
        startTransition(async () => {
          const ids = [...selected];
          const result = await confirmRemittance(ids, counted);
          if (result.ok) {
            setDone(formatMoney(cents));
            setSelected(new Set());
            setCounted("");
            router.refresh();
          } else {
            setError(result.code);
          }
        });
      }}
    >
      {groups.map((group) => {
        const ids = group.items.map((item) => item.id);
        const total = group.items.reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <fieldset key={group.officerId} className="rounded-card border border-line bg-surface">
            <legend className="sr-only">{group.officer}</legend>
            <div className="flex items-center justify-between gap-3 border-b border-page px-4 py-3">
              <label className="flex min-h-11 items-center gap-3 font-bold text-ink">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={allOn}
                  onChange={(event) => toggle(ids, event.target.checked)}
                />
                {t("officerLine", { name: group.officer, count: group.items.length })}
              </label>
              <span className="tabular font-bold text-ink">{formatMoney(total)}</span>
            </div>
            <ul className="divide-y divide-page">
              {group.items.map((item) => (
                <li key={item.id}>
                  <label className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={selected.has(item.id)}
                      onChange={(event) => toggle([item.id], event.target.checked)}
                    />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-semibold">{item.customer}</span>
                      <span className="tabular text-ink-muted">
                        {item.receiptNo} · {item.loanNo} · {formatDate(item.receivedOn)}
                      </span>
                    </span>
                    <span className="tabular font-semibold">{formatMoney(item.amountCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}

      <div className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1">
          <p className="text-xs font-semibold text-ink-muted">{t("selected", { count: selected.size })}</p>
          <p className="tabular text-xl font-bold text-ink">{formatMoney(selectedTotal)}</p>
        </div>
        <Field
          id="remittance-counted"
          label={t("counted")}
          error={countError ? t("countedRequired") : undefined}
        >
          <input
            id="remittance-counted"
            inputMode="decimal"
            autoComplete="off"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            className={`${inputClass} tabular text-right`}
            {...describedBy("remittance-counted", undefined, countError ? t("countedRequired") : undefined)}
          />
        </Field>
        <Button type="submit" disabled={pending || selected.size === 0}>
          {pending ? t("confirming") : t("confirm")}
        </Button>
      </div>
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
      {done !== null ? <FormMessage tone="success">{t("done", { amount: done })}</FormMessage> : null}
    </form>
  );
}
