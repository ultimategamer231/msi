import { Phone } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { LoanPillText } from "../loans/loan-pill";

/*
 * /field (loan officer; SPEC 9, mock-up 01): my loans due today or overdue with Call and a big
 * Collect button, and the field cash still waiting for handover. The WhatsApp "Remind" button
 * arrives with the reminder template in M5 (SPEC 10.3).
 */
export default async function FieldPage() {
  const t = await getTranslations("field");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <FieldContent />
    </Suspense>
  );
}

async function FieldContent() {
  const staff = await requirePageAccess("/field");
  const t = await getTranslations("field");
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) throw new Error("Could not read the business date");

  const [loansResult, cashResult] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id, loan_no, status, principal_cents, due_date, closed_on, customers!inner(type, first_name, last_name, business_name, phone)",
      )
      .eq("officer_id", staff.id)
      .in("status", ["active", "overdue", "recovery"])
      .lte("due_date", today)
      .order("due_date", { ascending: false })
      .order("loan_no"),
    supabase
      .from("payments")
      .select(
        "id, receipt_no, amount_cents, received_on, customers!inner(type, first_name, last_name, business_name)",
      )
      .eq("received_by", staff.id)
      .eq("remittance_status", "pending")
      .eq("status", "posted")
      .order("received_at"),
  ]);
  if (loansResult.error !== null || cashResult.error !== null)
    throw new Error("Could not read the field list");
  const ids = loansResult.data.map((loan) => loan.id);
  const { data: balances, error: balanceError } =
    ids.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("loan_balances")
          .select("loan_id, total_out, penalty_out, days_overdue")
          .in("loan_id", ids);
  if (balanceError !== null) throw new Error("Could not read balances");
  const byLoan = new Map(balances.map((row) => [row.loan_id, row]));
  const loans = loansResult.data.filter((loan) => BigInt(byLoan.get(loan.id)?.total_out ?? 0) > 0n);
  const outstanding = loans.reduce((sum, loan) => sum + BigInt(byLoan.get(loan.id)?.total_out ?? 0), 0n);
  const cash = cashResult.data;
  const cashTotal = cash.reduce((sum, payment) => sum + BigInt(payment.amount_cents), 0n);
  const firstName = staff.fullName.split(" ")[0] ?? staff.fullName;

  return (
    <>
      <TopBar title={t("greeting", { name: firstName })} staff={staff} />
      <div className="mx-auto grid w-full max-w-xl animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-card bg-primary p-4 text-white">
            <p className="text-sm text-white/85">{t("toVisit")}</p>
            <p className="tabular text-2xl font-bold">{t("loans", { count: loans.length })}</p>
          </div>
          <div className="rounded-card bg-primary p-4 text-white">
            <p className="text-sm text-white/85">{t("outstanding")}</p>
            <p className="tabular text-2xl font-bold">{formatMoney(outstanding)}</p>
          </div>
        </div>

        <section aria-labelledby="field-visits" className="grid gap-3">
          <h2 id="field-visits" className="sr-only">
            {t("visitsHeading")}
          </h2>
          {loans.length === 0 ? (
            <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-sm text-ink-muted">
              {t("empty")}
            </p>
          ) : (
            loans.map((loan) => {
              const balance = byLoan.get(loan.id);
              const name = customerName(loan.customers);
              const penalty = BigInt(balance?.penalty_out ?? 0);
              const pill = loanPill({
                status: loan.status,
                dueDate: loan.due_date,
                daysOverdue: balance?.days_overdue ?? 0,
                totalOutCents: BigInt(balance?.total_out ?? 0),
                closedOn: loan.closed_on,
                today,
              });
              return (
                <article
                  key={loan.id}
                  aria-labelledby={`visit-${loan.id}`}
                  className="grid gap-3 rounded-card border border-line bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid">
                      <h3 id={`visit-${loan.id}`} className="text-lg font-bold text-ink">
                        {name}
                      </h3>
                      <p className="tabular text-sm text-ink-muted">
                        {loan.loan_no} · {t("lent", { amount: formatMoney(loan.principal_cents) })}
                      </p>
                    </div>
                    <StatusBadge tone={pill.tone}>
                      <LoanPillText pill={pill} />
                    </StatusBadge>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <p className="text-sm text-ink-muted">
                      {penalty > 0n ? t("owesWithPenalty", { penalty: formatMoney(penalty) }) : t("owes")}
                    </p>
                    <p className="tabular text-2xl font-bold text-ink">
                      {formatMoney(balance?.total_out ?? 0)}
                    </p>
                  </div>
                  <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <a
                      href={`tel:${loan.customers.phone.replace(/[^\d+]/g, "")}`}
                      aria-label={t("callLabel", { name })}
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "field" }),
                        "gap-2 hover:text-ink",
                      )}
                    >
                      <Phone aria-hidden="true" className="size-5" />
                      {t("call")}
                    </a>
                    <Link
                      href={`/field/collect/${loan.id}`}
                      aria-label={t("collectLabel", { name })}
                      className={cn(
                        buttonVariants({ variant: "primary", size: "field" }),
                        "hover:text-white",
                      )}
                    >
                      {t("collect")}
                    </Link>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section
          aria-labelledby="field-cash"
          className={cn(
            "rounded-card border p-4",
            cash.length > 0
              ? "border-warning-border bg-warning-bg text-status-overdue-fg"
              : "border-line bg-surface text-ink",
          )}
        >
          <h2 id="field-cash" className="text-base font-bold">
            {t("cashWithYou", { amount: formatMoney(cashTotal) })}
          </h2>
          <p className="text-sm">
            {cash.length === 0
              ? t("cashNone")
              : t("cashNote", { count: cash.length, date: formatDate(cash[0]?.received_on ?? today) })}
          </p>
          {cash.length > 0 ? (
            <ul className="mt-3 grid gap-1 text-sm">
              {cash.map((payment) => (
                <li key={payment.id} className="flex justify-between gap-3">
                  <Link
                    href={`/receipts/${payment.id}`}
                    className="tabular font-semibold text-status-overdue-fg underline"
                  >
                    {payment.receipt_no}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{customerName(payment.customers)}</span>
                  <span className="tabular font-semibold">{formatMoney(payment.amount_cents)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </>
  );
}
