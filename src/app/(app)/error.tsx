"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/* Error state inside the app shell: the navigation stays usable while the page failed. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("error");
  return (
    <div className="p-4 lg:p-6">
      <section role="alert" className="max-w-xl rounded-card border border-line bg-surface p-6">
        <h1 className="text-xl font-bold text-ink">{t("inAppTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{t("body")}</p>
        {error.digest !== undefined ? (
          <p className="mt-3 font-mono text-xs text-ink-soft">{t("reference", { digest: error.digest })}</p>
        ) : null}
        <Button type="button" onClick={reset} className="mt-6">
          {t("retry")}
        </Button>
      </section>
    </div>
  );
}
