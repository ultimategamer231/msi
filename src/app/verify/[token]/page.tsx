import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Public QR verification (SPEC 9, 10.1; FR-25). Anyone holding a printed document can check it is
 * genuine. verify_document returns only the kind, number, date, amount, a masked customer name and
 * whether it was voided; nothing else about the customer or the loan is shown.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KINDS = [
  "receipt",
  "statement",
  "loan_agreement",
  "demand_notice",
  "collateral_receipt",
  "collateral_release",
] as const;
type Kind = (typeof KINDS)[number];

interface Verified {
  kind: Kind;
  number: string;
  date: string;
  amount_cents: number | null;
  customer: string | null;
  is_void: boolean;
}

export default function VerifyPage({ params }: PageProps<"/verify/[token]">) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <Suspense
          fallback={<div className="h-64 animate-pulse rounded-card border border-line bg-surface" />}
        >
          <VerifyContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function verify(token: string): Promise<Verified | null> {
  if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("verify_document", { p_token: token });
  if (error !== null || data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as unknown as Verified;
  return (KINDS as readonly string[]).includes(value.kind) ? value : null;
}

async function VerifyContent({ params }: { params: PageProps<"/verify/[token]">["params"] }) {
  const [{ token }, t] = await Promise.all([params, getTranslations("verify")]);
  const document = await verify(token);

  if (document === null) {
    return (
      <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-ink">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{t("notFound")}</p>
      </section>
    );
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: t("number"), value: document.number },
    { label: t("date"), value: formatDate(document.date) },
    ...(document.amount_cents !== null
      ? [{ label: t("amount"), value: formatMoney(document.amount_cents) }]
      : []),
    ...(document.customer !== null && document.customer !== ""
      ? [{ label: t("customer"), value: document.customer }]
      : []),
  ];
  return (
    <section className="rounded-card border border-line bg-surface p-6 sm:p-8" aria-labelledby="verify-title">
      <p
        role="status"
        className={
          document.is_void
            ? "rounded-control bg-status-overdue-bg px-3 py-2.5 text-sm font-semibold text-status-overdue-fg"
            : "rounded-control bg-status-active-bg px-3 py-2.5 text-sm font-semibold text-status-active-fg"
        }
      >
        {document.is_void ? t("void") : t("genuine")}
      </p>
      <h1 id="verify-title" className="mt-5 text-2xl font-bold text-ink">
        {t(`kinds.${document.kind}`)}
      </h1>
      <dl className="mt-4 divide-y divide-line">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 py-2.5 text-sm">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="text-right font-semibold text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs leading-5 text-ink-muted">{t("note")}</p>
    </section>
  );
}
