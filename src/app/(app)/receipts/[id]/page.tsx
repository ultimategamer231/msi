import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { requirePageAccess } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { loadReceipt } from "@/lib/receipts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { PrintButtons } from "./print-buttons";

/*
 * /receipts/[id] (staff; SPEC 9, 10.1, mock-up 04): the receipt as printed, with print (A5 and
 * 80 mm), PDF and Done. A voided payment's receipt shows a VOID stamp. "Share on WhatsApp"
 * (mock-up 04) waits for the B-19 answer.
 */
export default async function ReceiptPage(props: PageProps<"/receipts/[id]">) {
  const t = await getTranslations("receipts");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ReceiptContent {...props} />
    </Suspense>
  );
}

async function ReceiptContent({ params }: PageProps<"/receipts/[id]">) {
  const staff = await requirePageAccess("/receipts/[id]");
  const [{ id }, t, tMethods, tShell] = await Promise.all([
    params,
    getTranslations("receipts"),
    getTranslations("payments.methods"),
    getTranslations("shell"),
  ]);
  const result = await loadReceipt(id);
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error("Could not read the receipt");
  }
  const receipt = result.receipt;
  const supabase = await createSupabaseServerClient();
  const [company, { data: now }, headerList] = await Promise.all([
    getCompany(),
    supabase.rpc("app_now"),
    headers(),
  ]);
  const host = headerList.get("host") ?? "localhost";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const verifyUrl = `${protocol}://${host}/verify/${receipt.token}`;
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 192 });
  const contact = [company?.address ?? "", company?.phone ?? ""].filter((part) => part !== "").join(" · ");
  const method =
    receipt.reference === null
      ? tMethods(receipt.method)
      : `${tMethods(receipt.method)} · ${receipt.reference}`;
  const rows = [
    ["number", receipt.receiptNo, true],
    ["date", formatDate(receipt.receivedOn), false],
    ["from", receipt.customer, true],
    ["loan", receipt.loanNo, false],
    ["method", method, false],
  ] as const;

  return (
    <>
      <TopBar title={receipt.isVoid ? t("voided") : t("received")} staff={staff} />
      <div className="mx-auto grid w-full max-w-md animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6 print:max-w-none print:p-0">
        {receipt.isVoid ? (
          <Callout tone="warning" className="print:hidden">
            {t("voidNote")}
          </Callout>
        ) : null}
        <article
          id="receipt-sheet"
          aria-label={receipt.receiptNo}
          data-paper="a5"
          className="receipt-sheet relative overflow-hidden rounded-card border border-line bg-surface p-5 text-ink shadow-sm"
        >
          {receipt.isVoid ? (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex -rotate-20 items-center justify-center text-7xl font-black tracking-widest text-status-overdue-strong/25"
            >
              {t("void")}
            </p>
          ) : null}
          <header className="grid justify-items-center gap-1 border-b border-dashed border-line-input pb-4 text-center">
            {company?.logoUrl ? (
              <Image
                src={company.logoUrl}
                alt={tShell("logoAlt", { company: company.name })}
                width={88}
                height={80}
                unoptimized
                className="h-16 w-auto object-contain"
              />
            ) : null}
            <p className="text-lg font-extrabold tracking-wide text-primary uppercase">
              {company?.name ?? ""}
            </p>
            {contact !== "" ? <p className="text-sm text-ink-muted">{contact}</p> : null}
            <p className="text-sm font-semibold">
              {t("official", { branch: receipt.branch })}
              {receipt.isVoid ? ` · ${t("void")}` : ""}
            </p>
          </header>

          <dl className="grid gap-2 py-4 text-sm">
            {rows.map(([key, value, strong]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{t(key)}</dt>
                <dd className={cn("tabular text-right", strong && "font-bold")}>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-control border border-primary-tint bg-primary-tint px-4 py-3 text-primary-dark">
            <span className="text-sm font-bold">{t("amount")}</span>
            <span className="tabular text-2xl font-extrabold">{formatMoney(receipt.amountCents)}</span>
          </div>

          <dl className="mt-4 grid gap-2 border-t border-dashed border-line-input pt-4 text-sm">
            {(["penalty", "interest", "principal"] as const).map((component) => (
              <div key={component} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{t(`applied.${component}`)}</dt>
                <dd className="tabular">{formatMoney(receipt.allocation[component])}</dd>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-3 border-t border-line pt-3 font-bold">
              <dt>{t("balanceAfter")}</dt>
              <dd className="tabular">{formatMoney(receipt.balanceAfterCents)}</dd>
            </div>
          </dl>

          <footer className="mt-5 flex items-end justify-between gap-4">
            <div className="grid gap-0.5 text-sm">
              <p className="text-ink-muted">{t("receivedBy")}</p>
              <p className="font-semibold">{receipt.receivedBy}</p>
              {receipt.collectedInField ? <p className="text-ink-muted">{t("inField")}</p> : null}
              <p className="text-ink-muted">
                {t("printed", { when: formatDateTime(now ?? receipt.receivedAt) })}
              </p>
              {company?.receiptFooter ? <p className="mt-2 text-ink-muted">{company.receiptFooter}</p> : null}
            </div>
            <figure className="grid shrink-0 justify-items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not a static asset */}
              <img src={qr} alt={t("qrAlt", { receipt: receipt.receiptNo })} width={96} height={96} />
              <figcaption className="text-xs text-ink-muted">{t("scan")}</figcaption>
            </figure>
          </footer>
        </article>

        <div className="grid gap-3 print:hidden">
          <PrintButtons pdfHref={`/api/pdf/receipt/${receipt.paymentId}`} />
          <Link
            href={`/loans/${receipt.loanId}`}
            className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}
          >
            {t("done")}
          </Link>
        </div>
      </div>
    </>
  );
}
