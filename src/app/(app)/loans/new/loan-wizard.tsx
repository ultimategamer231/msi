"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { GuarantorFields, type GuarantorFormValues } from "@/components/forms/guarantor-fields";
import { Button } from "@/components/ui/button";
import { DOCUMENT_MAX_BYTES } from "@/lib/file-type";
import { formatDate, formatMoney, formatRateBps } from "@/lib/format";
import { guarantorsSchema } from "@/lib/guarantors";
import { parseDollarsToCents } from "@/lib/money-input";
import type { ErrorCode } from "@/lib/rpc-errors";
import { shrinkImage } from "@/lib/shrink-image";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { uploadCustomerFile } from "../../customers/actions";
import {
  applyForLoan,
  customerCollateral,
  previewLoan,
  searchLoanCustomers,
  type CollateralOption,
  type CustomerHit,
  type PreviewResult,
} from "../actions";
import {
  COLLATERAL_TYPES,
  emptyCollateral,
  newCollateralSchema,
  termsSchema,
  type NewCollateralValues,
  type TermsValues,
} from "../schemas";

export interface ProductOption {
  id: string;
  name: string;
  rateBps: number;
  defaultTermMonths: number;
  maxTermMonths: number;
}

export interface OfficerOption {
  id: string;
  name: string;
  branchId: string;
}

export type WizardCustomer = CustomerHit;

const STEPS = ["customer", "loan", "collateral", "guarantors", "review"] as const;
type Step = (typeof STEPS)[number];

/*
 * /loans/new (SPEC 9): customer → product → amount and term with a live preview from
 * preview_loan_terms → collateral (pick or add) → guarantors → submit. One step at a time so it
 * works on a phone; nothing is saved until the last step.
 */
export function LoanWizard({
  products,
  officers,
  chooseOfficer,
  collateralRequired,
  managerLimitCents,
  initialCustomer,
}: {
  products: ProductOption[];
  officers: OfficerOption[];
  chooseOfficer: boolean;
  collateralRequired: boolean;
  managerLimitCents: string;
  initialCustomer: WizardCustomer | null;
}) {
  const t = useTranslations("loans.wizard");
  const tValidation = useTranslations("loans.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(initialCustomer === null ? "customer" : "loan");
  const [customer, setCustomer] = useState<WizardCustomer | null>(initialCustomer);
  const [officerId, setOfficerId] = useState(initialCustomer?.assignedOfficerId ?? "");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  const firstProduct = products[0];
  const termsForm = useForm<TermsValues>({
    resolver: zodResolver(termsSchema),
    defaultValues: {
      productId: firstProduct?.id ?? "",
      principal: "",
      termMonths: String(firstProduct?.defaultTermMonths ?? 1),
      purpose: "",
    },
  });
  const terms = useWatch({ control: termsForm.control });
  const product = products.find((candidate) => candidate.id === terms.productId) ?? firstProduct;

  // The preview shown always belongs to the values on screen; stale answers are ignored.
  const parsedTerms = termsSchema.safeParse(terms);
  const previewKey = parsedTerms.success ? JSON.stringify(parsedTerms.data) : null;
  const [previewState, setPreviewState] = useState<{ key: string; result: PreviewResult } | null>(null);
  useEffect(() => {
    if (previewKey === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewLoan(JSON.parse(previewKey) as TermsValues).then((result) => {
        if (!cancelled) setPreviewState({ key: previewKey, result });
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewKey]);
  const preview = previewState !== null && previewState.key === previewKey ? previewState.result : null;

  const [options, setOptions] = useState<CollateralOption[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [newItems, setNewItems] = useState<NewCollateralValues[]>([]);
  const [addingItem, setAddingItem] = useState(false);
  const itemForm = useForm<NewCollateralValues>({
    resolver: zodResolver(newCollateralSchema),
    defaultValues: emptyCollateral,
  });
  useEffect(() => {
    if (customer === null) return;
    let cancelled = false;
    void customerCollateral(customer.id).then((items) => {
      if (!cancelled) setOptions(items);
    });
    return () => {
      cancelled = true;
    };
  }, [customer]);

  const guarantorForm = useForm<GuarantorFormValues>({ defaultValues: { guarantors: [] } });
  const [guarantorFiles, setGuarantorFiles] = useState<(File | null)[]>([]);

  const message = (key: string | undefined) =>
    key === undefined ? undefined : tValidation(key as "required");
  const index = STEPS.indexOf(step);
  const principalCents = parseDollarsToCents(terms.principal ?? "") ?? 0n;
  const needsCeo = principalCents > BigInt(managerLimitCents);
  const customerOfficers = officers.filter((officer) => officer.branchId === customer?.branchId);

  async function next() {
    setStepError(null);
    if (step === "customer") {
      if (customer === null) {
        setStepError(t("chooseCustomer"));
        return;
      }
      setStep("loan");
    } else if (step === "loan") {
      if (await termsForm.trigger()) setStep("collateral");
    } else if (step === "collateral") {
      if (collateralRequired && selected.length + newItems.length === 0) {
        setStepError(t("collateralNeeded"));
        return;
      }
      setStep("guarantors");
    } else if (step === "guarantors") {
      const parsed = guarantorsSchema.safeParse(guarantorForm.getValues("guarantors"));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const [row, field] = issue.path;
          if (typeof row === "number" && typeof field === "string") {
            guarantorForm.setError(`guarantors.${row}.${field as "fullName"}`, { message: issue.message });
          }
        }
        return;
      }
      if (
        guarantorFiles.some(
          (file) => file !== null && file.type === "application/pdf" && file.size > DOCUMENT_MAX_BYTES,
        )
      ) {
        setStepError(tErrors("UPLOAD_REJECTED"));
        return;
      }
      setStep("review");
    }
  }

  function send(submit: boolean) {
    if (customer === null) return;
    setError(null);
    startTransition(async () => {
      const guarantors = guarantorForm.getValues("guarantors");
      const docs: ({ storagePath: string; fileName: string } | null)[] = [];
      for (let row = 0; row < guarantors.length; row += 1) {
        const file = guarantorFiles[row] ?? null;
        if (file === null) {
          docs.push(null);
          continue;
        }
        const prepared = await shrinkImage(file);
        const body = new FormData();
        body.set("file", prepared);
        const upload = await uploadCustomerFile(body);
        if (!upload.ok) {
          setError(upload.code);
          return;
        }
        docs.push({ storagePath: upload.storagePath, fileName: upload.fileName });
      }
      const result = await applyForLoan(
        {
          customerId: customer.id,
          officerId: chooseOfficer ? officerId : "",
          terms: termsForm.getValues(),
          collateralIds: selected,
          newCollateral: newItems,
          guarantors,
          guarantorDocs: docs,
        },
        submit,
      );
      if (result.ok) {
        router.push(`/loans/${result.loanId}?${submit ? "submitted" : "saved"}=1`);
      } else {
        setError(result.code);
      }
    });
  }

  return (
    <div className="grid gap-4 lg:gap-5">
      <ol aria-label={t("stepsLabel")} className="flex flex-wrap gap-2">
        {STEPS.map((candidate, position) => (
          <li
            key={candidate}
            aria-current={candidate === step ? "step" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-badge border px-3 text-xs font-semibold",
              candidate === step
                ? "border-primary bg-primary text-white"
                : position < index
                  ? "border-line bg-primary-tint text-primary-dark"
                  : "border-line bg-surface text-ink-muted",
            )}
          >
            <span className="tabular">{position + 1}</span>
            {t(`steps.${candidate}`)}
          </li>
        ))}
      </ol>

      <section
        aria-labelledby="wizard-step"
        className="grid min-w-0 gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
      >
        <h2 id="wizard-step" className="text-base font-bold text-ink">
          {t("stepHeading", { number: index + 1, total: STEPS.length, title: t(`steps.${step}`) })}
        </h2>

        {step === "customer" ? (
          <CustomerStep
            customer={customer}
            onChoose={(hit) => {
              setCustomer(hit);
              setOfficerId(hit?.assignedOfficerId ?? "");
              setSelected([]);
              setNewItems([]);
              setOptions(null);
            }}
          />
        ) : null}

        {step === "loan" ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="loan-product"
                label={t("product")}
                error={message(termsForm.formState.errors.productId?.message)}
              >
                <select
                  id="loan-product"
                  className={inputClass}
                  {...termsForm.register("productId", {
                    onChange: (event: { target: { value: string } }) => {
                      const chosen = products.find((candidate) => candidate.id === event.target.value);
                      if (chosen !== undefined)
                        termsForm.setValue("termMonths", String(chosen.defaultTermMonths));
                    },
                  })}
                >
                  {products.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {t("productRate", { rate: formatRateBps(option.rateBps) })}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="loan-principal"
                label={t("principal")}
                error={message(termsForm.formState.errors.principal?.message)}
              >
                <input
                  id="loan-principal"
                  inputMode="decimal"
                  autoComplete="off"
                  className={`${inputClass} tabular`}
                  {...describedBy(
                    "loan-principal",
                    undefined,
                    message(termsForm.formState.errors.principal?.message),
                  )}
                  {...termsForm.register("principal")}
                />
              </Field>
              <Field
                id="loan-term"
                label={t("term")}
                error={message(termsForm.formState.errors.termMonths?.message)}
              >
                <select id="loan-term" className={inputClass} {...termsForm.register("termMonths")}>
                  {Array.from({ length: product?.maxTermMonths ?? 1 }, (_, position) => position + 1).map(
                    (months) => (
                      <option key={months} value={String(months)}>
                        {t("months", { count: months })}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              {chooseOfficer ? (
                <Field id="loan-officer" label={t("officer")}>
                  <select
                    id="loan-officer"
                    className={inputClass}
                    value={officerId}
                    onChange={(event) => setOfficerId(event.target.value)}
                  >
                    <option value="">{t("noOfficer")}</option>
                    {customerOfficers.map((officer) => (
                      <option key={officer.id} value={officer.id}>
                        {officer.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field
                id="loan-purpose"
                label={t("purpose")}
                error={message(termsForm.formState.errors.purpose?.message)}
                className="sm:col-span-2"
              >
                <input
                  id="loan-purpose"
                  autoComplete="off"
                  className={inputClass}
                  {...termsForm.register("purpose")}
                />
              </Field>
            </div>
            <PreviewBox preview={preview} needsCeo={needsCeo} managerLimitCents={managerLimitCents} />
          </div>
        ) : null}

        {step === "collateral" ? (
          <div className="grid gap-4">
            <p className="text-sm text-ink-muted">
              {collateralRequired ? t("collateralIntroRequired") : t("collateralIntro")}
            </p>
            {options === null ? (
              <p className="text-sm text-ink-muted">{t("loadingCollateral")}</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("noCollateral")}</p>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold text-ink">{t("existingItems")}</legend>
                {options.map((option) => (
                  <label
                    key={option.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4.5 accent-primary"
                      checked={selected.includes(option.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, option.id]
                            : current.filter((id) => id !== option.id),
                        )
                      }
                    />
                    <span className="flex-1">
                      <span className="font-semibold">{option.description}</span>{" "}
                      <span className="text-ink-muted">
                        {option.code} · {formatMoney(option.valueCents)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {newItems.length > 0 ? (
              <ul className="grid gap-2">
                {newItems.map((item, position) => (
                  <li
                    key={`${item.description}-${position}`}
                    className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-semibold">{item.description}</span>{" "}
                      <span className="text-ink-muted">
                        {t(`types.${item.type}`)} · {formatMoney(parseDollarsToCents(item.value) ?? 0n)} ·{" "}
                        {t("newItem")}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setNewItems((current) => current.filter((_, other) => other !== position))
                      }
                    >
                      {t("remove")}
                      <span className="sr-only"> {item.description}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {addingItem ? (
              <NewItemForm
                form={itemForm}
                message={message}
                onAdd={(item) => {
                  setNewItems((current) => [...current, item]);
                  itemForm.reset(emptyCollateral);
                  setAddingItem(false);
                }}
                onCancel={() => setAddingItem(false)}
              />
            ) : newItems.length < 5 ? (
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAddingItem(true)}>
                  {t("addItem")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "guarantors" ? (
          <GuarantorFields
            form={guarantorForm}
            onRemove={(row) => setGuarantorFiles((current) => current.filter((_, other) => other !== row))}
            extra={(row) => (
              <Field id={`guarantor-${row}-doc`} label={t("guarantorDoc")} help={t("guarantorDocHelp")}>
                <input
                  id={`guarantor-${row}-doc`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink lg:min-h-10"
                  {...describedBy(`guarantor-${row}-doc`, "help", undefined)}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setGuarantorFiles((current) => {
                      const copy = [...current];
                      copy[row] = file;
                      return copy;
                    });
                  }}
                />
              </Field>
            )}
          />
        ) : null}

        {step === "review" && customer !== null ? (
          <div className="grid gap-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label={t("summary.customer")} value={`${customer.name} (${customer.code})`} />
              <Detail label={t("summary.product")} value={product?.name ?? ""} />
              <Detail label={t("summary.principal")} value={formatMoney(principalCents)} />
              <Detail
                label={t("summary.term")}
                value={t("months", { count: Number(terms.termMonths ?? 1) })}
              />
              <Detail
                label={t("summary.collateral")}
                value={
                  [
                    ...selected.map((id) => options?.find((option) => option.id === id)?.description ?? ""),
                    ...newItems.map((item) => item.description),
                  ]
                    .filter((text) => text !== "")
                    .join(", ") || t("summary.none")
                }
              />
              <Detail
                label={t("summary.guarantors")}
                value={
                  guarantorForm
                    .getValues("guarantors")
                    .map((guarantor) => guarantor.fullName)
                    .join(", ") || t("summary.none")
                }
              />
            </dl>
            <PreviewBox preview={preview} needsCeo={needsCeo} managerLimitCents={managerLimitCents} />
          </div>
        ) : null}

        {stepError !== null ? <FormMessage tone="error">{stepError}</FormMessage> : null}
        {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}

        <div className="flex flex-wrap gap-2 border-t border-page pt-4">
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setStep(STEPS[index - 1] ?? "customer")}
            >
              {t("back")}
            </Button>
          ) : null}
          {step === "review" ? (
            <>
              <Button type="button" disabled={pending} onClick={() => send(true)}>
                {pending ? t("sending") : t("submit")}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => send(false)}>
                {t("saveDraft")}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => void next()}>
              {t("next")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words text-ink">{value}</dd>
    </div>
  );
}

function PreviewBox({
  preview,
  needsCeo,
  managerLimitCents,
}: {
  preview: PreviewResult | null;
  needsCeo: boolean;
  managerLimitCents: string;
}) {
  const t = useTranslations("loans.wizard.preview");
  const tErrors = useTranslations("errors");
  if (preview === null) {
    return <p className="rounded-control bg-subtle px-4 py-3 text-sm text-ink-muted">{t("empty")}</p>;
  }
  if (!preview.ok) {
    return <FormMessage tone="error">{tErrors(preview.code)}</FormMessage>;
  }
  const rows: Array<[string, ReactNode]> = [
    [t("interest"), formatMoney(preview.interestCents)],
    [t("total"), formatMoney(preview.totalCents)],
    [t("due"), formatDate(preview.dueDate)],
  ];
  return (
    <div
      aria-live="polite"
      className="grid gap-3 rounded-control bg-primary-tint/60 px-4 py-3 text-sm text-ink"
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-ink-muted">{label}</dt>
            <dd className="tabular mt-0.5 text-base font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-ink-muted">
        {t("explain", { rate: formatRateBps(preview.rateBps) })}
        {preview.firstPenaltyOn !== null && preview.firstPenaltyCents !== null
          ? ` ${t("penalty", { amount: formatMoney(preview.firstPenaltyCents), date: formatDate(preview.firstPenaltyOn) })}`
          : ""}
      </p>
      <p className="text-xs font-semibold">
        {needsCeo
          ? t("ceo", { limit: formatMoney(managerLimitCents) })
          : t("manager", { limit: formatMoney(managerLimitCents) })}
      </p>
    </div>
  );
}

function CustomerStep({
  customer,
  onChoose,
}: {
  customer: WizardCustomer | null;
  onChoose: (customer: WizardCustomer | null) => void;
}) {
  const t = useTranslations("loans.wizard");
  const [term, setTerm] = useState("");
  const query = term.trim();
  const [found, setFound] = useState<{ query: string; hits: CustomerHit[] } | null>(null);

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchLoanCustomers(query).then((hits) => {
        if (!cancelled) setFound({ query, hits });
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const hits = query.length >= 2 && found !== null && found.query === query ? found.hits : null;

  if (customer !== null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{customer.name}</span>{" "}
          <span className="text-ink-muted">
            {customer.code} · {customer.phone}
          </span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChoose(null)}>
          {t("changeCustomer")}
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <Field id="loan-customer-search" label={t("searchCustomer")} help={t("searchHelp")}>
        <input
          id="loan-customer-search"
          type="search"
          autoComplete="off"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className={inputClass}
          {...describedBy("loan-customer-search", "help", undefined)}
        />
      </Field>
      {hits !== null && hits.length === 0 ? <p className="text-sm text-ink-muted">{t("noMatches")}</p> : null}
      {hits !== null && hits.length > 0 ? (
        <ul aria-label={t("matches")} className="grid gap-2">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onChoose(hit)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control border border-line px-4 py-2 text-left text-sm hover:bg-page"
              >
                <span className="font-semibold">{hit.name}</span>
                <span className="tabular text-ink-muted">
                  {hit.code} · {hit.phone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NewItemForm({
  form,
  message,
  onAdd,
  onCancel,
}: {
  form: ReturnType<typeof useForm<NewCollateralValues>>;
  message: (key: string | undefined) => string | undefined;
  onAdd: (item: NewCollateralValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("loans.wizard");
  const errors = form.formState.errors;
  const text = (name: "description" | "serialNo" | "plateNo" | "documentNo" | "value" | "location") => (
    <Field id={`item-${name}`} label={t(`item.${name}`)} error={message(errors[name]?.message)}>
      <input
        id={`item-${name}`}
        autoComplete="off"
        inputMode={name === "value" ? "decimal" : undefined}
        className={inputClass}
        {...describedBy(`item-${name}`, undefined, message(errors[name]?.message))}
        {...form.register(name)}
      />
    </Field>
  );
  return (
    <div className="grid gap-4 rounded-control border border-line p-4">
      <h3 className="text-sm font-bold text-ink">{t("item.heading")}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="item-type" label={t("item.type")}>
          <select id="item-type" className={inputClass} {...form.register("type")}>
            {COLLATERAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        {text("description")}
        {text("serialNo")}
        {text("plateNo")}
        {text("documentNo")}
        {text("value")}
        {text("location")}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => void form.handleSubmit(onAdd)()}>
          {t("item.add")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("item.cancel")}
        </Button>
      </div>
    </div>
  );
}
