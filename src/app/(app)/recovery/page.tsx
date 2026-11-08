import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OpenCaseForm } from "./case-forms";

/*
 * /recovery (manager, CEO; SPEC 9, 5.7): loans eligible for recovery (30+ days, set by the daily
 * job) with "Open case", open cases by stage, and recently closed cases.
 */
export default async function RecoveryPage() {
  const t = await getTranslations("recovery");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <RecoveryContent />
    </Suspense>
  );
}

async function RecoveryContent() {
  const staff = await requirePageAccess("/recovery");
  const [t, tStages] = await Promise.all([
    getTranslations("recovery"),
    getTranslations("approvals.recoveryStages"),
  ]);
  const supabase = await createSupabaseServerClient();
  const [eligibleResult, casesResult] = await Promise.all([
    supabase
      .from("loans")
      .select("id, loan_no, due_date, customers!inner(type, first_name, last_name, business_name)")
      .eq("status", "overdue")
      .eq("recovery_eligible", true)
      .order("due_date"),
    supabase
      .from("recovery_cases")
      .select(
        "id, case_no, stage, opened_on, closed_on, loan_id, loans!inner(loan_no, customers!inner(type, first_name, last_name, business_name))",
      )
      .order("opened_on", { ascending: false })
      .limit(100),
  ]);
  if (eligibleResult.error !== null || casesResult.error !== null) throw new Error("Could not read recovery");
  const loanIds = [
    ...eligibleResult.data.map((loan) => loan.id),
    ...casesResult.data.map((row) => row.loan_id),
  ];
  const { data: balances } =
    loanIds.length === 0
      ? { data: [] }
      : await supabase
          .from("loan_balances")
          .select("loan_id, total_out, days_overdue")
          .in("loan_id", loanIds);
  const byLoan = new Map((balances ?? []).map((row) => [row.loan_id, row]));
  const open = casesResult.data.filter((row) => row.closed_on === null);
  const closed = casesResult.data.filter((row) => row.closed_on !== null).slice(0, 20);

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <section
          aria-labelledby="recovery-eligible"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <div className="p-4 sm:p-6">
            <h2 id="recovery-eligible" className="text-base font-bold text-ink">
              {t("eligible.heading", { count: eligibleResult.data.length })}
            </h2>
            <p className="text-sm text-ink-muted">{t("eligible.intro")}</p>
          </div>
          {eligibleResult.data.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-ink-muted sm:px-6">{t("eligible.empty")}</p>
          ) : (
            <ul className="divide-y divide-page border-t border-page">
              {eligibleResult.data.map((loan) => (
                <li
                  key={loan.id}
                  className="grid gap-2 px-4 py-3 sm:flex sm:items-start sm:justify-between sm:px-6"
                >
                  <div className="grid">
                    <Link href={`/loans/${loan.id}`} className="font-semibold">
                      {customerName(loan.customers)} · <span className="tabular">{loan.loan_no}</span>
                    </Link>
                    <span className="tabular text-sm text-ink-muted">
                      {t("eligible.line", {
                        days: byLoan.get(loan.id)?.days_overdue ?? 0,
                        owed: formatMoney(byLoan.get(loan.id)?.total_out ?? 0),
                      })}
                    </span>
                  </div>
                  <OpenCaseForm loanId={loan.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {[
          ["openCases", open],
          ["closedCases", closed],
        ].map(([key, rows]) => (
          <section
            key={key as string}
            aria-labelledby={`recovery-${key as string}`}
            className="min-w-0 rounded-card border border-line bg-surface"
          >
            <h2 id={`recovery-${key as string}`} className="p-4 text-base font-bold text-ink sm:p-6">
              {t(`${key as "openCases"}.heading`, { count: (rows as typeof open).length })}
            </h2>
            {(rows as typeof open).length === 0 ? (
              <p className="px-4 pb-6 text-sm text-ink-muted sm:px-6">{t(`${key as "openCases"}.empty`)}</p>
            ) : (
              <ScrollRegion label={t(`${key as "openCases"}.table`)}>
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {(["case", "borrower", "loan", "stage", "opened", "owes"] as const).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className={`px-4 py-2.5 font-semibold ${column === "owes" ? "text-right" : ""}`}
                        >
                          {t(`columns.${column}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(rows as typeof open).map((row) => (
                      <tr key={row.id} className="border-t border-page">
                        <td className="tabular px-4 py-3">
                          <Link href={`/recovery/${row.id}`} className="font-semibold">
                            {row.case_no}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{customerName(row.loans.customers)}</td>
                        <td className="tabular px-4 py-3">
                          <Link href={`/loans/${row.loan_id}`}>{row.loans.loan_no}</Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={row.closed_on === null ? "recovery" : "pending"}>
                            {tStages(row.stage as "opened")}
                          </StatusBadge>
                        </td>
                        <td className="tabular px-4 py-3">{formatDate(row.opened_on)}</td>
                        <td className="tabular px-4 py-3 text-right">
                          {formatMoney(byLoan.get(row.loan_id)?.total_out ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
