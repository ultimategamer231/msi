import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { Callout } from "@/components/ui/callout";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoanPillText } from "../../../loans/loan-pill";
import { PaymentForm } from "../../../payments/payment-form";

/*
 * /field/collect/[loanId] (loan officer; SPEC 9, mock-up 02): the minimal payment form with the
 * request key made when it opens. Cash waits as field cash until the cashier confirms the handover.
 */
export default async function CollectPage(props: PageProps<"/field/collect/[loanId]">) {
  const t = await getTranslations("field");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <CollectContent {...props} />
    </Suspense>
  );
}

async function CollectContent({ params }: PageProps<"/field/collect/[loanId]">) {
  const staff = await requirePageAccess("/field/collect/[loanId]");
  const [{ loanId }, t] = await Promise.all([params, getTranslations("field")]);
  if (!/^[0-9a-f-]{36}$/.test(loanId)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: loan }, { data: balance }, preview, { data: today }, { data: setting }] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id, loan_no, status, due_date, closed_on, branch_id, customers!inner(type, first_name, last_name, business_name)",
      )
      .eq("id", loanId)
      .maybeSingle(),
    supabase.from("loan_balances").select("total_out, days_overdue").eq("loan_id", loanId).maybeSingle(),
    supabase.rpc("preview_payment", { p_loan_id: loanId, p_amount_cents: 0 }),
    supabase.rpc("business_today"),
    supabase.from("settings").select("value").eq("key", "field.require_remittance").maybeSingle(),
  ]);
  if (loan === null || today === null) notFound();
  const open = ["active", "overdue", "recovery"].includes(loan.status);
  const ownBranch = staff.branch !== null && staff.branch.id === loan.branch_id;
  const owed = preview.error === null ? (preview.data as { owed: { total: number } }).owed.total : 0;
  const pill = loanPill({
    status: loan.status,
    dueDate: loan.due_date,
    daysOverdue: balance?.days_overdue ?? 0,
    totalOutCents: BigInt(balance?.total_out ?? 0),
    closedOn: loan.closed_on,
    today,
  });

  return (
    <>
      <TopBar title={t("collectTitle")} staff={staff} />
      <div className="mx-auto grid w-full max-w-xl animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6">
        <Link href="/field" className="text-sm font-semibold">
          ← {t("back")}
        </Link>
        <section
          aria-labelledby="collect-loan"
          className="grid gap-2 rounded-card border border-line bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid">
              <h2 id="collect-loan" className="text-lg font-bold text-ink">
                {customerName(loan.customers)}
              </h2>
              <p className="tabular text-sm text-ink-muted">
                {loan.loan_no}
                {loan.due_date !== null ? ` · ${t("due", { date: formatDate(loan.due_date) })}` : ""}
              </p>
            </div>
            <StatusBadge tone={pill.tone}>
              <LoanPillText pill={pill} />
            </StatusBadge>
          </div>
          <div className="flex items-end justify-between gap-3">
            <p className="text-sm text-ink-muted">{t("owedNow")}</p>
            <p className="tabular text-2xl font-bold text-ink">{formatMoney(owed)}</p>
          </div>
        </section>
        {!open ? <Callout tone="warning">{t("notOpen")}</Callout> : null}
        {open && !ownBranch ? <Callout tone="warning">{t("otherBranch")}</Callout> : null}
        {open && ownBranch && preview.error === null ? (
          <PaymentForm
            loanId={loan.id}
            variant="field"
            handoverNote={setting?.value !== false}
            initial={{
              ok: true,
              owed: {
                penalty: "0",
                interest: "0",
                principal: "0",
                total: String(owed),
              },
              allocation: { penalty: "0", interest: "0", principal: "0" },
              afterCents: String(owed),
              overpayment: false,
            }}
          />
        ) : null}
      </div>
    </>
  );
}
