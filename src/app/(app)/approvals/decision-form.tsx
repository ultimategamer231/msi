"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";

import { decideApproval } from "./actions";

/*
 * Approve, or reject with a mandatory reason (mock-up 12). A rejection asks for confirmation
 * first (SPEC 9: destructive-looking actions confirm, with a reason).
 */
export function DecisionForm({
  requestId,
  title,
  boardReference = false,
}: {
  requestId: string;
  title: string;
  /** A write-off: the note is the board reference and is required to approve (SPEC 5.8). */
  boardReference?: boolean;
}) {
  const t = useTranslations("approvals.decision");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [missingNote, setMissingNote] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const noteId = `note-${requestId}`;

  const decide = (decision: "approve" | "reject") => {
    setError(null);
    startTransition(async () => {
      const result = await decideApproval(requestId, decision, note);
      if (result.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(result.code);
      }
    });
  };

  return (
    <div className="grid gap-3">
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${noteId}-confirm`}
          className="grid gap-3 rounded-control border border-warning-border bg-warning-bg p-3 text-status-overdue-fg"
        >
          <p id={`${noteId}-confirm`} className="text-sm font-semibold">
            {t("confirmReject", { title })}
          </p>
          <p className="text-sm">{t("confirmReason", { reason: note.trim() })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" disabled={pending} onClick={() => decide("reject")}>
              {pending ? t("sending") : t("yesReject")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-start">
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              if (boardReference && note.trim() === "") {
                setMissingNote("approve");
                return;
              }
              setMissingNote(null);
              decide("approve");
            }}
          >
            {pending ? t("sending") : t("approve")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              if (note.trim() === "") {
                setMissingNote("reject");
                return;
              }
              setMissingNote(null);
              setConfirming(true);
            }}
          >
            {t("reject")}
          </Button>
          <div className="grid gap-1">
            <label htmlFor={noteId} className="sr-only">
              {t("noteLabel", { title })}
            </label>
            <input
              id={noteId}
              value={note}
              maxLength={500}
              placeholder={t(boardReference ? "boardPlaceholder" : "notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              className={inputClass}
              {...describedBy(noteId, undefined, missingNote !== null ? t("noteRequired") : undefined)}
            />
            {missingNote !== null ? (
              <p id={`${noteId}-error`} className="text-xs font-medium text-status-overdue-strong">
                {t(missingNote === "approve" ? "boardRequired" : "noteRequired")}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
    </div>
  );
}
