"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Field, FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { DOCUMENT_MAX_BYTES } from "@/lib/file-type";
import type { ErrorCode } from "@/lib/rpc-errors";
import { shrinkImage } from "@/lib/shrink-image";

import { uploadCustomerFile } from "../../customers/actions";
import { addCollateralFiles, logCustodyEvent, releaseCollateral, type CollateralFile } from "../actions";
import { EVENT_TYPES, eventSchema, type EventType, type EventValues } from "../schemas";

type Result = { tone: "success" } | { tone: "error"; code: ErrorCode } | null;

function Outcome({ result, success }: { result: Result; success: string }) {
  const tErrors = useTranslations("errors");
  if (result === null) return null;
  return result.tone === "success" ? (
    <FormMessage tone="success">{success}</FormMessage>
  ) : (
    <FormMessage tone="error">{tErrors(result.code)}</FormMessage>
  );
}

/* Upload chosen files one per request (11 MB server limit), shrinking photos first. */
export async function uploadFiles(
  files: File[],
  kind: CollateralFile["kind"],
): Promise<{ ok: true; files: CollateralFile[] } | { ok: false; code: ErrorCode }> {
  const uploaded: CollateralFile[] = [];
  for (const file of files) {
    const prepared = await shrinkImage(file);
    if (prepared.size > DOCUMENT_MAX_BYTES) return { ok: false, code: "UPLOAD_REJECTED" };
    const body = new FormData();
    body.set("file", prepared);
    const upload = await uploadCustomerFile(body);
    if (!upload.ok) return { ok: false, code: upload.code };
    uploaded.push({ kind, storagePath: upload.storagePath, fileName: upload.fileName });
  }
  return { ok: true, files: uploaded };
}

/* Custody log entry (SPEC 5.9): moved, valued (manager), note, lost (manager). */
export function CustodyEventForm({ collateralId, canValue }: { collateralId: string; canValue: boolean }) {
  const t = useTranslations("collateral.item.event");
  const tValidation = useTranslations("collateral.validation");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [values, setValues] = useState<EventValues>({
    type: "moved",
    toLocation: "",
    value: "",
    note: "",
    witness: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EventValues, string>>>({});
  const types = EVENT_TYPES.filter((type) => canValue || (type !== "valued" && type !== "lost"));
  const set = (key: keyof EventValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const error = (key: keyof EventValues) =>
    errors[key] === undefined ? undefined : tValidation(errors[key] as "required");

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
    );
  }
  return (
    <form
      noValidate
      aria-label={t("heading")}
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = eventSchema.safeParse(values);
        if (!parsed.success) {
          const next: Partial<Record<keyof EventValues, string>> = {};
          for (const issue of parsed.error.issues) next[issue.path[0] as keyof EventValues] = issue.message;
          setErrors(next);
          return;
        }
        setErrors({});
        setResult(null);
        startTransition(async () => {
          const outcome = await logCustodyEvent(collateralId, parsed.data);
          if (outcome.ok) {
            setResult({ tone: "success" });
            setValues({ type: "moved", toLocation: "", value: "", note: "", witness: "" });
            router.refresh();
          } else {
            setResult({ tone: "error", code: outcome.code });
          }
        });
      }}
    >
      <h3 className="text-sm font-bold text-ink">{t("heading")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="event-type" label={t("type")}>
          <select
            id="event-type"
            className={inputClass}
            value={values.type}
            onChange={(event) => set("type", event.target.value as EventType)}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        {values.type === "moved" ? (
          <Field id="event-location" label={t("toLocation")} error={error("toLocation")}>
            <input
              id="event-location"
              className={inputClass}
              value={values.toLocation}
              maxLength={200}
              onChange={(event) => set("toLocation", event.target.value)}
              {...describedBy("event-location", undefined, error("toLocation"))}
            />
          </Field>
        ) : null}
        {values.type === "valued" ? (
          <Field id="event-value" label={t("value")} error={error("value")}>
            <input
              id="event-value"
              inputMode="decimal"
              className={`${inputClass} tabular`}
              value={values.value}
              onChange={(event) => set("value", event.target.value)}
              {...describedBy("event-value", undefined, error("value"))}
            />
          </Field>
        ) : null}
        <Field
          id="event-note"
          label={t(values.type === "note" || values.type === "lost" ? "note" : "noteOptional")}
          error={error("note")}
        >
          <input
            id="event-note"
            className={inputClass}
            value={values.note}
            maxLength={500}
            onChange={(event) => set("note", event.target.value)}
            {...describedBy("event-note", undefined, error("note"))}
          />
        </Field>
        <Field id="event-witness" label={t("witness")}>
          <input
            id="event-witness"
            className={inputClass}
            value={values.witness}
            maxLength={120}
            onChange={(event) => set("witness", event.target.value)}
          />
        </Field>
      </div>
      <Outcome result={result} success={t("saved")} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/* Return the item to its owner (FR-16): only once every loan it secured has ended. */
export function ReleaseForm({ collateralId, ownerName }: { collateralId: string; ownerName: string }) {
  const t = useTranslations("collateral.item.release");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [witness, setWitness] = useState(ownerName);
  const [result, setResult] = useState<Result>(null);
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-labelledby="release-title"
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h3 id="release-title" className="text-sm font-bold text-ink">
        {t("heading")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="release-witness" label={t("witness")}>
          <input
            id="release-witness"
            className={inputClass}
            value={witness}
            maxLength={120}
            onChange={(event) => setWitness(event.target.value)}
          />
        </Field>
        <Field id="release-note" label={t("note")}>
          <input
            id="release-note"
            className={inputClass}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
      <Outcome result={result} success={t("done")} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await releaseCollateral(collateralId, note, witness);
              setResult(outcome.ok ? { tone: "success" } : { tone: "error", code: outcome.code });
              if (outcome.ok) router.refresh();
            })
          }
        >
          {pending ? t("saving") : t("confirm")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

/* Add photos or documents (append-only). */
export function AddFilesForm({ collateralId }: { collateralId: string }) {
  const t = useTranslations("collateral.item.files");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<CollateralFile["kind"]>("photo");
  const [inputKey, setInputKey] = useState(0);
  const [result, setResult] = useState<Result>(null);
  return (
    <form
      noValidate
      aria-label={t("label")}
      className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (files.length === 0) {
          setResult({ tone: "error", code: "INVALID_INPUT" });
          return;
        }
        startTransition(async () => {
          const upload = await uploadFiles(files, kind);
          if (!upload.ok) {
            setResult({ tone: "error", code: upload.code });
            return;
          }
          const added = await addCollateralFiles(collateralId, upload.files);
          setResult(added.ok ? { tone: "success" } : { tone: "error", code: added.code });
          if (added.ok) {
            setFiles([]);
            setInputKey((key) => key + 1);
            router.refresh();
          }
        });
      }}
    >
      <Field id="files-kind" label={t("kind")}>
        <select
          id="files-kind"
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as CollateralFile["kind"])}
        >
          {(["photo", "document", "other"] as const).map((option) => (
            <option key={option} value={option}>
              {t(`kinds.${option}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="files-input" label={t("files")} help={t("help")}>
        <input
          key={inputKey}
          id="files-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block min-h-11 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-control file:border file:border-line-input file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-ink lg:min-h-10"
          {...describedBy("files-input", "help", undefined)}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 10))}
        />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t("adding") : t("submit")}
      </Button>
      <div className="sm:col-span-3">
        <Outcome result={result} success={t("added")} />
      </div>
    </form>
  );
}
