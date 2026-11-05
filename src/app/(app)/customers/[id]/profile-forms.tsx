"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { DOCUMENT_MAX_BYTES } from "@/lib/file-type";
import type { ErrorCode } from "@/lib/rpc-errors";
import { shrinkImage } from "@/lib/shrink-image";

import { addCustomerDocuments, requestCustomerStatus, uploadCustomerFile } from "../actions";
import { CUSTOMER_STATUSES } from "../schemas";

type Result = { tone: "success" } | { tone: "error"; code: ErrorCode } | null;

/* Blacklist, archive or reactivate: an approved edit with a mandatory reason (SPEC 5.11). */
export function StatusRequestForm({ customerId, current }: { customerId: string; current: string }) {
  const t = useTranslations("customers.profile.statusForm");
  const tStatus = useTranslations("customers.status");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = CUSTOMER_STATUSES.filter((status) => status !== current);
  const [status, setStatus] = useState<(typeof CUSTOMER_STATUSES)[number]>(options[0] ?? "blacklisted");
  const [reason, setReason] = useState("");
  const [missingReason, setMissingReason] = useState(false);
  const [result, setResult] = useState<Result>(null);

  return (
    <form
      noValidate
      aria-label={t("label")}
      className="grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() === "") {
          setMissingReason(true);
          return;
        }
        setMissingReason(false);
        startTransition(async () => {
          const response = await requestCustomerStatus(customerId, status, reason);
          if (response.ok) {
            setResult({ tone: "success" });
            setReason("");
            router.refresh();
          } else {
            setResult({ tone: "error", code: response.code });
          }
        });
      }}
    >
      <Field id="status-new" label={t("newStatus")}>
        <select
          id="status-new"
          className={inputClass}
          value={status}
          onChange={(event) => setStatus(event.target.value as (typeof CUSTOMER_STATUSES)[number])}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {tStatus(option)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="status-reason" label={t("reason")} error={missingReason ? t("reasonRequired") : undefined}>
        <input
          id="status-reason"
          value={reason}
          maxLength={300}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          {...describedBy("status-reason", undefined, missingReason ? t("reasonRequired") : undefined)}
        />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t("sending") : t("submit")}
      </Button>
      {result?.tone === "success" ? (
        <div className="sm:col-span-3">
          <FormMessage tone="success">{t("sent")}</FormMessage>
        </div>
      ) : null}
      {result?.tone === "error" ? (
        <div className="sm:col-span-3">
          <FormMessage tone="error">{tErrors(result.code)}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}

const DOCUMENT_KIND_OPTIONS = ["id_document", "proof_of_address", "other"] as const;

/* New scans for an existing customer: added without approval, never replaced or removed (B-24). */
export function AddDocumentForm({ customerId }: { customerId: string }) {
  const t = useTranslations("customers.profile.documentsForm");
  const tKinds = useTranslations("customers.profile.kinds");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<(typeof DOCUMENT_KIND_OPTIONS)[number]>("id_document");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [result, setResult] = useState<Result>(null);

  return (
    <form
      noValidate
      aria-label={t("label")}
      className="grid gap-4 sm:grid-cols-[12rem_1fr]"
      onSubmit={(event) => {
        event.preventDefault();
        if (file === null) {
          setResult({ tone: "error", code: "INVALID_INPUT" });
          return;
        }
        startTransition(async () => {
          const prepared = await shrinkImage(file);
          if (prepared.size > DOCUMENT_MAX_BYTES) {
            setResult({ tone: "error", code: "UPLOAD_REJECTED" });
            return;
          }
          const body = new FormData();
          body.set("file", prepared);
          const upload = await uploadCustomerFile(body);
          if (!upload.ok) {
            setResult({ tone: "error", code: upload.code });
            return;
          }
          const added = await addCustomerDocuments(customerId, [
            { kind, storagePath: upload.storagePath, fileName: upload.fileName },
          ]);
          if (added.ok) {
            setResult({ tone: "success" });
            setFile(null);
            setInputKey((key) => key + 1);
            router.refresh();
          } else {
            setResult({ tone: "error", code: added.code });
          }
        });
      }}
    >
      <Field id="document-kind" label={t("kind")}>
        <select
          id="document-kind"
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as (typeof DOCUMENT_KIND_OPTIONS)[number])}
        >
          {DOCUMENT_KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {tKinds(option)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="document-file" label={t("file")} help={t("help")}>
        <input
          key={inputKey}
          id="document-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink lg:min-h-10"
          {...describedBy("document-file", "help", undefined)}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t("adding") : t("submit")}
        </Button>
      </div>
      {result?.tone === "success" ? (
        <div className="sm:col-span-2">
          <FormMessage tone="success">{t("added")}</FormMessage>
        </div>
      ) : null}
      {result?.tone === "error" ? (
        <div className="sm:col-span-2">
          <FormMessage tone="error">
            {result.code === "INVALID_INPUT" ? t("chooseFile") : tErrors(result.code)}
          </FormMessage>
        </div>
      ) : null}
    </form>
  );
}
