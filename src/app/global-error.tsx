"use client";

import messages from "../../messages/en.json";
import "./globals.css";

/*
 * Last-resort boundary for errors in the root layout itself. It renders its own
 * <html> and cannot rely on the next-intl provider, so it reads the English
 * catalogue directly.
 */
interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const copy = messages.error;
  return (
    <html lang="en">
      <body className="bg-page font-sans text-ink">
        <main className="flex min-h-dvh items-center justify-center px-4 py-12">
          <section
            role="alert"
            className="w-full max-w-md rounded-card border border-line bg-surface p-6 sm:p-8"
          >
            <h1 className="text-xl font-bold text-ink">{copy.title}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{copy.body}</p>
            {error.digest !== undefined ? (
              <p className="mt-3 font-mono text-xs text-ink-soft">
                {copy.reference.replace("{digest}", error.digest)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex min-h-11 items-center rounded-control bg-primary px-4 text-sm font-semibold text-white"
            >
              {copy.retry}
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
