"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import { Field, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { GUARANTOR_ID_TYPES, MAX_GUARANTORS, emptyGuarantor, type GuarantorValues } from "@/lib/guarantors";

/*
 * Guarantors step of the loan wizard (SPEC 9 /loans/new; FR-05): optional, up to 3, with ID
 * details. The ID scan is added with the loan documents. Used by the loan form in M3.
 */
export interface GuarantorFormValues {
  guarantors: GuarantorValues[];
}

const TEXT_FIELDS = ["fullName", "phone", "relationship", "address", "idNumber"] as const;

export function GuarantorFields({
  form,
  extra,
  onRemove,
}: {
  form: UseFormReturn<GuarantorFormValues>;
  /** Extra fields shown under each guarantor (the loan wizard adds the ID scan). */
  extra?: (index: number) => ReactNode;
  onRemove?: (index: number) => void;
}) {
  const t = useTranslations("guarantors");
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "guarantors" });
  const errors = form.formState.errors.guarantors;
  const message = (key: string | undefined) =>
    key === undefined ? undefined : t(`validation.${key as "required"}`);

  return (
    <fieldset className="grid gap-4">
      <legend className="text-base font-bold text-ink">{t("heading")}</legend>
      <p className="text-sm leading-6 text-ink-muted">{t("intro")}</p>
      {fields.length === 0 ? <p className="text-sm text-ink-muted">{t("none")}</p> : null}
      {fields.map((field, index) => {
        const fieldErrors = errors?.[index];
        return (
          <div key={field.id} className="grid gap-4 rounded-card border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-ink">{t("number", { number: index + 1 })}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  remove(index);
                  onRemove?.(index);
                }}
                aria-label={t("remove", { number: index + 1 })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {TEXT_FIELDS.map((name) => {
                const id = `guarantor-${index}-${name}`;
                const error = message(fieldErrors?.[name]?.message);
                return (
                  <Field key={name} id={id} label={t(`fields.${name}`)} error={error}>
                    <input
                      id={id}
                      type={name === "phone" ? "tel" : "text"}
                      inputMode={name === "phone" ? "tel" : undefined}
                      autoComplete="off"
                      className={inputClass}
                      {...describedBy(id, undefined, error)}
                      {...form.register(`guarantors.${index}.${name}`)}
                    />
                  </Field>
                );
              })}
              <Field
                id={`guarantor-${index}-idType`}
                label={t("fields.idType")}
                error={message(fieldErrors?.idType?.message)}
              >
                <select
                  id={`guarantor-${index}-idType`}
                  className={inputClass}
                  {...form.register(`guarantors.${index}.idType`)}
                >
                  <option value="">{t("noId")}</option>
                  {GUARANTOR_ID_TYPES.map((idType) => (
                    <option key={idType} value={idType}>
                      {t(`idTypes.${idType}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {extra?.(index)}
          </div>
        );
      })}
      {fields.length < MAX_GUARANTORS ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => append({ ...emptyGuarantor })}>
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
