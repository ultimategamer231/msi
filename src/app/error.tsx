"use client";

import { useTranslations } from "next-intl";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const t = useTranslations("error");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <section role="alert" className="w-full max-w-md rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-bold text-ink">{t("title")}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{t("body")}</p>
        {error.digest !== undefined ? (
          <p className="mt-3 font-mono text-xs text-ink-soft">{t("reference", { digest: error.digest })}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors duration-150 ease-out hover:bg-primary-dark"
        >
          {t("retry")}
        </button>
      </section>
    </main>
  );
}
