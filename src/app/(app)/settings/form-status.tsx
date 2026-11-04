"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormMessage } from "@/components/forms/fields";
import type { ErrorCode } from "@/lib/rpc-errors";

export type Status = { tone: "success" } | { tone: "error"; code: ErrorCode } | null;

/** Pending flag plus the last result of a settings form. */
export function useStatus() {
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  return { status, setStatus, pending, startTransition };
}

export function StatusMessage({ status }: { status: Status }) {
  const t = useTranslations();
  if (status === null) return null;
  return status.tone === "success" ? (
    <FormMessage tone="success">{t("settings.saved")}</FormMessage>
  ) : (
    <FormMessage tone="error">{t(`errors.${status.code}`)}</FormMessage>
  );
}

/** Translates a schema message key ("required", "amount", ...) into the settings validation text. */
export function useValidationText() {
  const t = useTranslations("settings.validation");
  return (key: string | undefined) => (key === undefined ? undefined : t(key as "required"));
}
