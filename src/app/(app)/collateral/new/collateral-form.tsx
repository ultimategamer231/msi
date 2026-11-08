"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { ErrorCode } from "@/lib/rpc-errors";
import { zodResolver } from "@/lib/zod-resolver";

import { COLLATERAL_TYPES } from "../../loans/schemas";
import { uploadFiles } from "../[id]/item-forms";
import {
  findDuplicates,
  registerCollateral,
  searchOwners,
  type DuplicateItem,
  type OwnerHit,
} from "../actions";
import { collateralSchema, type CollateralValues } from "../schemas";

/*
 * Register an item (SPEC 5.9, 9 /collateral/new; FR-15): owner, type, description, identifiers,
 * estimated value, location, photos and documents. A duplicate identifier is shown as a warning
 * first; the user can register anyway (SPEC: warn, not block).
 */
export function CollateralForm({ owner }: { owner: OwnerHit | null }) {
  const t = useTranslations("collateral.new");
  const tTypes = useTranslations("loans.wizard.types");
  const tValidation = useTranslations("collateral.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<OwnerHit | null>(owner);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<OwnerHit[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateItem[] | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const form = useForm<CollateralValues>({
    resolver: zodResolver(collateralSchema),
    defaultValues: {
      ownerId: owner?.id ?? "",
      type: "electronics",
      description: "",
      serialNo: "",
      plateNo: "",
      chassisNo: "",
      documentNo: "",
      value: "",
      location: "",
    },
  });
  const errors = form.formState.errors;
  const text = (key: string | undefined) => (key === undefined ? undefined : tValidation(key as "required"));

  const save = (values: CollateralValues, confirmed: boolean) => {
    setError(null);
    startTransition(async () => {
      if (!confirmed) {
        const found = await findDuplicates(values);
        if (found.length > 0) {
          setDuplicates(found);
          return;
        }
      }
      const upload = await uploadFiles(files, "photo");
      if (!upload.ok) {
        setError(upload.code);
        return;
      }
      const result = await registerCollateral(values, upload.files);
      if (result.ok) router.push(`/collateral/${result.id}`);
      else setError(result.code);
    });
  };

  const textField = (
    name: "description" | "serialNo" | "plateNo" | "chassisNo" | "documentNo" | "value" | "location",
    options: { inputMode?: "decimal" } = {},
  ) => (
    <Field id={`item-${name}`} label={t(`fields.${name}`)} error={text(errors[name]?.message)}>
      <input
        id={`item-${name}`}
        autoComplete="off"
        inputMode={options.inputMode}
        className={inputClass}
        {...describedBy(`item-${name}`, undefined, text(errors[name]?.message))}
        {...form.register(name)}
      />
    </Field>
  );

  return (
    <form
      noValidate
      aria-label={t("label")}
      className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
      onSubmit={(event) => void form.handleSubmit((values) => save(values, false))(event)}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-bold text-ink">{t("owner")}</legend>
        {chosen !== null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-subtle px-3 py-2">
            <span className="font-semibold text-ink">
              {chosen.name} <span className="tabular font-normal text-ink-muted">{chosen.code}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setChosen(null);
                form.setValue("ownerId", "");
              }}
            >
              {t("changeOwner")}
            </Button>
          </div>
        ) : (
          <Field id="owner-search" label={t("searchOwner")} error={text(errors.ownerId?.message)}>
            <input
              id="owner-search"
              type="search"
              value={term}
              autoComplete="off"
              className={inputClass}
              {...describedBy("owner-search", undefined, text(errors.ownerId?.message))}
              onChange={(event) => {
                const value = event.target.value;
                setTerm(value);
                startTransition(async () => setHits(await searchOwners(value)));
              }}
            />
          </Field>
        )}
        {chosen === null && hits.length > 0 ? (
          <ul aria-label={t("matches")} className="grid gap-1">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between rounded-control border border-line px-3 text-left text-sm hover:bg-page"
                  onClick={() => {
                    setChosen(hit);
                    form.setValue("ownerId", hit.id, { shouldValidate: true });
                  }}
                >
                  <span className="font-semibold text-ink">{hit.name}</span>
                  <span className="tabular text-ink-muted">{hit.code}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="item-type" label={t("fields.type")}>
          <select id="item-type" className={inputClass} {...form.register("type")}>
            {COLLATERAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {tTypes(type)}
              </option>
            ))}
          </select>
        </Field>
        {textField("description")}
        {textField("serialNo")}
        {textField("plateNo")}
        {textField("chassisNo")}
        {textField("documentNo")}
        {textField("value", { inputMode: "decimal" })}
        {textField("location")}
      </div>

      <Field id="item-photos" label={t("photos")} help={t("photosHelp")}>
        <input
          id="item-photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink lg:min-h-10"
          {...describedBy("item-photos", "help", undefined)}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 10))}
        />
      </Field>

      {duplicates !== null ? (
        <Callout tone="warning" role="alert">
          {t("duplicates", {
            items: duplicates.map((item) => `${item.code} (${item.description})`).join(", "),
          })}
        </Callout>
      ) : null}
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        {duplicates === null ? (
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("submit")}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void form.handleSubmit((values) => save(values, true))()}
          >
            {pending ? t("saving") : t("submitAnyway")}
          </Button>
        )}
      </div>
    </form>
  );
}
