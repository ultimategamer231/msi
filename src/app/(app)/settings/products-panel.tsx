"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRateBps } from "@/lib/format";
import { bpsToInput } from "@/lib/money-input";
import { zodResolver } from "@/lib/zod-resolver";

import { saveProduct } from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import { productSchema, type ProductValues } from "./schemas";

/* Loan products (SPEC 7.1; FR-06): loans copy these rules when they are submitted. */
export interface ProductRow {
  id: string;
  name: string;
  interestRateBps: number;
  defaultTermMonths: number;
  maxTermMonths: number;
  penaltyRateBps: number;
  penaltyPeriodDays: number;
  penaltyBase: "outstanding_total" | "original_due";
  penaltyMaxPeriods: number;
  recoveryAfterDays: number;
  active: boolean;
}

const EMPTY: ProductValues = {
  name: "",
  interestRate: "20",
  defaultTermMonths: "1",
  maxTermMonths: "3",
  penaltyRate: "20",
  penaltyPeriodDays: "7",
  penaltyBase: "outstanding_total",
  penaltyMaxPeriods: "4",
  recoveryAfterDays: "30",
  active: true,
};

function toValues(product: ProductRow): ProductValues {
  return {
    id: product.id,
    name: product.name,
    interestRate: bpsToInput(product.interestRateBps),
    defaultTermMonths: String(product.defaultTermMonths),
    maxTermMonths: String(product.maxTermMonths),
    penaltyRate: bpsToInput(product.penaltyRateBps),
    penaltyPeriodDays: String(product.penaltyPeriodDays),
    penaltyBase: product.penaltyBase,
    penaltyMaxPeriods: String(product.penaltyMaxPeriods),
    recoveryAfterDays: String(product.recoveryAfterDays),
    active: product.active,
  };
}

export function ProductsPanel({ products }: { products: ProductRow[] }) {
  const t = useTranslations("settings.products");
  const tSettings = useTranslations("settings");
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null);

  return (
    <Panel id="products-heading" title={t("heading")} intro={t("intro")}>
      {products.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("empty")}</p>
      ) : (
        <ScrollRegion
          label={t("heading")}
          className="-mx-4 border-y border-line sm:mx-0 sm:rounded-control sm:border"
        >
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-subtle text-left text-xs font-semibold text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2.5">
                  {t("name")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("interest")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("term")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("penalty")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t("status")}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">{tSettings("edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-page">
                  <td className="px-3 py-3 font-semibold">{product.name}</td>
                  <td className="px-3 py-3">
                    {t("interestValue", { rate: formatRateBps(product.interestRateBps) })}
                  </td>
                  <td className="px-3 py-3">
                    {t("termValue", { term: product.defaultTermMonths, max: product.maxTermMonths })}
                  </td>
                  <td className="px-3 py-3">
                    {t("penaltyValue", {
                      rate: formatRateBps(product.penaltyRateBps),
                      days: product.penaltyPeriodDays,
                      max: product.penaltyMaxPeriods,
                    })}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={product.active ? "active" : "pending"}>
                      {product.active ? t("active") : t("inactive")}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(product)}>
                      {tSettings("edit")}
                      <span className="sr-only"> {product.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <div className="mt-4">
        {editing === null ? (
          <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
            {t("add")}
          </Button>
        ) : (
          <ProductForm
            key={editing === "new" ? "new" : editing.id}
            product={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}

const NUMBER_FIELDS = [
  ["interestRate", "decimal"],
  ["defaultTermMonths", "numeric"],
  ["maxTermMonths", "numeric"],
  ["penaltyRate", "decimal"],
  ["penaltyPeriodDays", "numeric"],
  ["penaltyMaxPeriods", "numeric"],
  ["recoveryAfterDays", "numeric"],
] as const;

function ProductForm({ product, onDone }: { product: ProductRow | null; onDone: () => void }) {
  const t = useTranslations("settings.products");
  const tSettings = useTranslations("settings");
  const validation = useValidationText();
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: product === null ? EMPTY : toValues(product),
  });
  const error = (name: keyof ProductValues) => {
    const key = form.formState.errors[name]?.message;
    if (key === "percent" || key === "wholeNumber" || key === "termOrder") return t(`validation.${key}`);
    return validation(key);
  };

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setStatus(null);
          startTransition(async () => {
            const result = await saveProduct(product === null ? values : { ...values, id: product.id });
            if (result.ok) onDone();
            else setStatus({ tone: "error", code: result.code });
          });
        })(event)
      }
    >
      <h3 className="text-sm font-bold text-ink">
        {product === null ? t("addHeading") : t("editHeading", { name: product.name })}
      </h3>
      <Field id="product-name" label={t("fields.name")} error={error("name")}>
        <input
          id="product-name"
          className={inputClass}
          {...describedBy("product-name", undefined, error("name"))}
          {...form.register("name")}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        {NUMBER_FIELDS.map(([name, inputMode]) => (
          <Field key={name} id={`product-${name}`} label={t(`fields.${name}`)} error={error(name)}>
            <input
              id={`product-${name}`}
              inputMode={inputMode}
              autoComplete="off"
              className={`${inputClass} tabular`}
              {...describedBy(`product-${name}`, undefined, error(name))}
              {...form.register(name)}
            />
          </Field>
        ))}
        <Field id="product-penaltyBase" label={t("fields.penaltyBase")}>
          <select id="product-penaltyBase" className={inputClass} {...form.register("penaltyBase")}>
            <option value="outstanding_total">{t("bases.outstanding_total")}</option>
            <option value="original_due">{t("bases.original_due")}</option>
          </select>
        </Field>
      </div>
      <p className="text-xs leading-5 text-ink-muted">{t("snapshotNote")}</p>
      <CheckboxRow id="product-active" label={t("fields.active")} {...form.register("active")} />
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? tSettings("saving") : tSettings("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {tSettings("cancel")}
        </Button>
      </div>
    </form>
  );
}
