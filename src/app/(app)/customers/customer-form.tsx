"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { DOCUMENT_MAX_BYTES } from "@/lib/file-type";
import type { ErrorCode } from "@/lib/rpc-errors";
import { shrinkImage } from "@/lib/shrink-image";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import { createCustomer, requestCustomerEdit, uploadCustomerFile, type UploadedFile } from "./actions";
import { ID_TYPES, customerSchema, emptyCustomer, type CustomerValues, type DuplicateMatch } from "./schemas";

export interface BranchOption {
  id: string;
  label: string;
}

export interface OfficerOption {
  id: string;
  name: string;
  branchId: string;
}

const FILE_SLOTS = [
  { kind: "photo", accept: "image/jpeg,image/png,image/webp" },
  { kind: "id_document", accept: "image/jpeg,image/png,image/webp,application/pdf" },
  { kind: "proof_of_address", accept: "image/jpeg,image/png,image/webp,application/pdf" },
] as const;
type SlotKind = (typeof FILE_SLOTS)[number]["kind"];

type Status = { tone: "error"; code: ErrorCode } | { tone: "duplicate"; matches: DuplicateMatch[] } | null;

/** New customer, or a request to change an existing one (SPEC 5.11: edits need approval). */
export type CustomerFormMode =
  { kind: "create" } | { kind: "edit"; customerId: string; initial: CustomerValues };

export function CustomerForm({
  mode,
  branches,
  officers,
  chooseBranch,
  canOverride,
  defaultBranchId,
  fixedPlacement,
}: {
  mode: CustomerFormMode;
  branches: BranchOption[];
  officers: OfficerOption[];
  /** Managers and admin choose the branch and officer; a loan officer's come from their profile. */
  chooseBranch: boolean;
  /** Only a manager may create despite a duplicate warning (SPEC 5.11). */
  canOverride: boolean;
  defaultBranchId: string;
  /** Shown instead of the branch and officer fields for a loan officer. */
  fixedPlacement: string;
}) {
  const t = useTranslations("customers.form");
  const tValidation = useTranslations("customers.validation");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideError, setOverrideError] = useState(false);
  const [files, setFiles] = useState<Partial<Record<SlotKind, File>>>({});
  const [fileErrors, setFileErrors] = useState<Partial<Record<SlotKind, boolean>>>({});
  // Files already uploaded in this visit, so a retry (for example after a duplicate warning) does
  // not upload them again.
  const [uploaded] = useState(() => new Map<File, UploadedFile>());
  const [reason, setReason] = useState("");
  const editing = mode.kind === "edit";
  // An edit request may only bring a new photo; other documents are added on the profile.
  const slots = editing ? FILE_SLOTS.filter((slot) => slot.kind === "photo") : FILE_SLOTS;

  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: mode.kind === "edit" ? mode.initial : { ...emptyCustomer, branchId: defaultBranchId },
  });
  const type = useWatch({ control: form.control, name: "type" });
  const branchId = useWatch({ control: form.control, name: "branchId" });
  const errors = form.formState.errors;
  const message = (key: string | undefined) =>
    key === undefined ? undefined : tValidation(key as "required");

  const branchOfficers = officers.filter((officer) => officer.branchId === branchId);

  async function uploadAll(): Promise<UploadedFile[] | ErrorCode> {
    const result: UploadedFile[] = [];
    for (const slot of slots) {
      const file = files[slot.kind];
      if (file === undefined) continue;
      const cached = uploaded.get(file);
      if (cached !== undefined) {
        result.push(cached);
        continue;
      }
      const prepared = await shrinkImage(file);
      if (prepared.size > DOCUMENT_MAX_BYTES) return "UPLOAD_REJECTED";
      const body = new FormData();
      body.set("file", prepared);
      const upload = await uploadCustomerFile(body);
      if (!upload.ok) return upload.code;
      const entry = { kind: slot.kind, storagePath: upload.storagePath, fileName: upload.fileName };
      uploaded.set(file, entry);
      result.push(entry);
    }
    return result;
  }

  function submit(values: CustomerValues, withOverride: boolean) {
    if (withOverride && overrideReason.trim() === "") {
      setOverrideError(true);
      return;
    }
    setOverrideError(false);
    startTransition(async () => {
      const prepared = await uploadAll();
      if (!Array.isArray(prepared)) {
        setStatus({ tone: "error", code: prepared });
        return;
      }
      if (mode.kind === "edit") {
        const edit = await requestCustomerEdit(mode.customerId, values, prepared[0] ?? null, {
          reason: withOverride ? overrideReason.trim() : reason.trim(),
          override: withOverride,
        });
        if (edit.ok) {
          router.push(`/customers/${mode.customerId}?requested=1`);
          return;
        }
        if (edit.code === "DUPLICATE_CUSTOMER" && "matches" in edit) {
          setStatus({ tone: "duplicate", matches: edit.matches });
          return;
        }
        setStatus({ tone: "error", code: edit.code });
        return;
      }
      const result = await createCustomer(
        values,
        prepared,
        withOverride ? { reason: overrideReason.trim() } : null,
      );
      if (result.ok) {
        router.push(`/customers/${result.id}?created=1`);
        return;
      }
      if (result.code === "DUPLICATE_CUSTOMER" && "matches" in result) {
        setStatus({ tone: "duplicate", matches: result.matches });
        return;
      }
      setStatus({ tone: "error", code: result.code });
    });
  }

  const textField = (
    name: Exclude<keyof CustomerValues, "type" | "idType" | "branchId" | "assignedOfficerId">,
    options: { inputMode?: "tel" | "text"; autoComplete?: string; className?: string; type?: string } = {},
  ) => {
    const id = `customer-${name}`;
    const error = message(errors[name]?.message);
    return (
      <Field id={id} label={t(`fields.${name}`)} error={error} className={options.className}>
        <input
          id={id}
          type={options.type ?? (options.inputMode === "tel" ? "tel" : "text")}
          inputMode={options.inputMode}
          autoComplete={options.autoComplete ?? "off"}
          className={inputClass}
          {...describedBy(id, undefined, error)}
          {...form.register(name)}
        />
      </Field>
    );
  };

  return (
    <form
      noValidate
      aria-label={editing ? t("editLabel") : t("label")}
      className="grid gap-4 lg:gap-5"
      onSubmit={(event) => void form.handleSubmit((values) => submit(values, false))(event)}
    >
      {editing ? null : (
        <Section title={t("sections.type")}>
          <fieldset>
            <legend className="sr-only">{t("sections.type")}</legend>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
              {(["individual", "business"] as const).map((option) => (
                <TypeOption
                  key={option}
                  value={option}
                  checked={type === option}
                  label={t(`types.${option}`)}
                  register={form.register("type")}
                />
              ))}
            </div>
          </fieldset>
        </Section>
      )}

      <Section title={type === "individual" ? t("sections.person") : t("sections.business")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {type === "individual" ? (
            <>
              {textField("firstName", { autoComplete: "off" })}
              {textField("lastName")}
              {textField("dateOfBirth", { type: "date" })}
            </>
          ) : (
            <>
              {textField("businessName")}
              {textField("registrationNo")}
              {textField("contactPerson")}
            </>
          )}
          <Field
            id="customer-idType"
            label={t(type === "individual" ? "fields.idType" : "fields.idTypeOptional")}
            error={message(errors.idType?.message)}
          >
            <select
              id="customer-idType"
              className={inputClass}
              {...describedBy("customer-idType", undefined, message(errors.idType?.message))}
              {...form.register("idType")}
            >
              <option value="">{t("chooseIdType")}</option>
              {ID_TYPES.map((idType) => (
                <option key={idType} value={idType}>
                  {t(`idTypes.${idType}`)}
                </option>
              ))}
            </select>
          </Field>
          {textField("idNumber")}
        </div>
      </Section>

      <Section title={t("sections.contact")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("phone", { inputMode: "tel" })}
          {textField("phoneAlt", { inputMode: "tel" })}
          {textField("address", { className: "sm:col-span-2" })}
          {textField("city")}
          {textField("occupation")}
          {textField("employerOrBusiness")}
        </div>
      </Section>

      <Section title={t("sections.nextOfKin")}>
        <div className="grid gap-4 sm:grid-cols-3">
          {textField("nextOfKinName")}
          {textField("nextOfKinRelation")}
          {textField("nextOfKinPhone", { inputMode: "tel" })}
        </div>
      </Section>

      <Section title={t("sections.placement")}>
        {chooseBranch ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="customer-branchId"
              label={t("fields.branchId")}
              error={message(errors.branchId?.message)}
            >
              <select
                id="customer-branchId"
                className={inputClass}
                {...form.register("branchId", {
                  onChange: () => form.setValue("assignedOfficerId", ""),
                })}
              >
                <option value="">{t("chooseBranch")}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="customer-assignedOfficerId" label={t("fields.assignedOfficerId")}>
              <select
                id="customer-assignedOfficerId"
                className={inputClass}
                disabled={branchId === ""}
                {...form.register("assignedOfficerId")}
              >
                <option value="">{t("noOfficer")}</option>
                {branchOfficers.map((officer) => (
                  <option key={officer.id} value={officer.id}>
                    {officer.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <p className="text-sm text-ink">{fixedPlacement}</p>
        )}
        <Field
          id="customer-notes"
          label={t("fields.notes")}
          error={message(errors.notes?.message)}
          className="mt-4"
        >
          <textarea
            id="customer-notes"
            rows={2}
            className={`${inputClass} py-2 leading-6`}
            {...describedBy("customer-notes", undefined, message(errors.notes?.message))}
            {...form.register("notes")}
          />
        </Field>
      </Section>

      <Section
        title={editing ? t("sections.photo") : t("sections.documents")}
        intro={editing ? t("photoIntro") : t("documentsIntro")}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {slots.map((slot) => {
            const id = `customer-file-${slot.kind}`;
            const file = files[slot.kind];
            const error = fileErrors[slot.kind] === true ? t("fileTooLarge") : undefined;
            return (
              <Field
                key={slot.kind}
                id={id}
                label={editing ? t("files.newPhoto") : t(`files.${slot.kind}`)}
                help={file === undefined ? t("fileHelp") : t("fileChosen", { name: file.name })}
                error={error}
              >
                <input
                  id={id}
                  type="file"
                  accept={slot.accept}
                  className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink lg:min-h-10"
                  {...describedBy(id, "help", error)}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    setFiles((current) => ({ ...current, [slot.kind]: chosen }));
                    // Images are shrunk before upload; only a PDF can be too large here.
                    setFileErrors((current) => ({
                      ...current,
                      [slot.kind]:
                        chosen !== undefined &&
                        chosen.type === "application/pdf" &&
                        chosen.size > DOCUMENT_MAX_BYTES,
                    }));
                  }}
                />
              </Field>
            );
          })}
        </div>
      </Section>

      {editing ? (
        <Section title={t("sections.reason")}>
          <Field id="edit-reason" label={t("editReason")}>
            <textarea
              id="edit-reason"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={`${inputClass} py-2 leading-6`}
            />
          </Field>
        </Section>
      ) : null}

      {status?.tone === "duplicate" ? (
        <section
          role="alert"
          aria-labelledby="duplicate-heading"
          className="grid gap-3 rounded-card border border-warning-border bg-warning-bg p-4 text-status-overdue-fg"
        >
          <h2 id="duplicate-heading" className="text-sm font-bold">
            {t("duplicate.heading")}
          </h2>
          <ul className="grid gap-1 text-sm">
            {status.matches.map((match) => (
              <li key={match.id}>
                <span className="font-semibold">
                  {match.name} ({match.code})
                </span>
                {" · "}
                {t(`duplicate.match.${match.match}`)}
                {match.status !== "active"
                  ? ` · ${t(`duplicate.status.${match.status as "blacklisted"}`)}`
                  : ""}
              </li>
            ))}
          </ul>
          {canOverride ? (
            <div className="grid gap-3">
              <p className="text-sm">{t("duplicate.managerHelp")}</p>
              <Field
                id="duplicate-reason"
                label={t("duplicate.reason")}
                error={overrideError ? tValidation("required") : undefined}
              >
                <textarea
                  id="duplicate-reason"
                  rows={2}
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  className={`${inputClass} py-2 leading-6`}
                  {...describedBy(
                    "duplicate-reason",
                    undefined,
                    overrideError ? tValidation("required") : undefined,
                  )}
                />
              </Field>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void form.handleSubmit((values) => submit(values, true))()}
                >
                  {t("duplicate.override")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm">{t("duplicate.officerHelp")}</p>
          )}
        </section>
      ) : null}
      {status?.tone === "error" ? <FormMessage tone="error">{tErrors(status.code)}</FormMessage> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("submitting") : editing ? t("submitEdit") : t("submit")}
        </Button>
        <Link
          href={editing ? `/customers/${mode.customerId}` : "/customers"}
          className={cn("inline-flex min-h-11 items-center px-3 text-sm font-semibold lg:min-h-10")}
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {intro !== undefined ? <p className="mt-1 text-sm leading-6 text-ink-muted">{intro}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TypeOption({
  value,
  checked,
  label,
  register,
}: {
  value: string;
  checked: boolean;
  label: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center justify-center rounded-control border px-4 text-sm font-semibold transition-colors duration-150 ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary lg:min-h-10",
        checked
          ? "border-primary bg-primary text-white"
          : "border-line-input bg-surface text-ink hover:bg-page",
      )}
    >
      <input type="radio" value={value} className="sr-only" {...register} />
      {label}
    </label>
  );
}
