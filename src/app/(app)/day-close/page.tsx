import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDateTime, formatMoney, formatMoneySigned, formatTime, formatWeekdayDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DecisionForm } from "../approvals/decision-form";
import { CountForm, ReopenForm } from "./forms";

/*
 * /day-close (cashier, manager, CEO; SPEC 9, 5.10; mock-up 14). The ledger gives the expected cash
 * (opening balance of the branch cash account, then every cash movement of the day); the cashier
 * counts and closes; a manager or the CEO approves, which locks the day, or reopens it later.
 */
interface Line {
  at: string;
  journal_no: string;
  category: "collection" | "disbursement" | "expense" | "other";
  reference: string;
  loan_no: string | null;
  customer: string | null;
  description: string;
  source_type: string;
  in_cents: number;
  out_cents: number;
}
interface Summary {
  account: string;
  opening_cents: number;
  expected_cents: number;
  lines: Line[];
  field_cash: Array<{
    receipt_no: string;
    amount_cents: number;
    officer: string;
    loan_no: string;
    customer: string;
  }>;
  close: {
    id: string;
    status: "submitted" | "approved" | "rejected";
    counted_cash_cents: number;
    variance_cents: number;
    note: string | null;
    cashier: string;
    approver: string | null;
    submitted_at: string;
    approved_at: string | null;
    reopen_reason: string | null;
    request_id: string | null;
  } | null;
}

export default async function DayClosePage(props: PageProps<"/day-close">) {
  const t = await getTranslations("dayClose");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <DayCloseContent {...props} />
    </Suspense>
  );
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6">
      <h2 id={id} className="text-base font-bold text-ink">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

async function DayCloseContent({ searchParams }: PageProps<"/day-close">) {
  const staff = await requirePageAccess("/day-close");
  const [t, params] = await Promise.all([getTranslations("dayClose"), searchParams]);
  const supabase = await createSupabaseServerClient();
  const [{ data: today }, branchesResult] = await Promise.all([
    supabase.rpc("business_today"),
    supabase.from("branches").select("id, name").eq("active", true).order("code"),
  ]);
  const branches = branchesResult.data ?? [];
  const chooses = staff.role !== "cashier";
  const branchParam = typeof params.branch === "string" ? params.branch : "";
  const branchId = chooses
    ? (branches.find((branch) => branch.id === branchParam)?.id ?? staff.branch?.id ?? branches[0]?.id ?? "")
    : (staff.branch?.id ?? "");
  const dateParam =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : "";
  const date = dateParam !== "" && dateParam <= String(today) ? dateParam : String(today);
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "";

  const { data, error } = await supabase.rpc("day_close_summary", { p_branch_id: branchId, p_date: date });
  if (error !== null || data === null) throw new Error("Could not read the day");
  const summary = data as unknown as Summary;
  const close = summary.close !== null && summary.close.status !== "rejected" ? summary.close : null;
  const reopened = summary.close?.status === "rejected" ? summary.close : null;
  const collections = summary.lines.filter((line) => line.category === "collection");
  const collectedIn = collections.reduce(
    (sum, line) => sum + BigInt(line.in_cents) - BigInt(line.out_cents),
    0n,
  );
  const expensesOut = summary.lines
    .filter((line) => line.category === "expense")
    .reduce((sum, line) => sum + BigInt(line.out_cents) - BigInt(line.in_cents), 0n);
  const otherLines = summary.lines.filter(
    (line) => line.category === "other" || line.category === "disbursement",
  );
  const describe = (line: Line) => {
    if (line.category === "collection" && line.customer !== null)
      return t("describe.repayment", { name: line.customer, loan: line.loan_no ?? "" });
    if (line.category === "disbursement" && line.customer !== null)
      return t("describe.payout", { name: line.customer });
    return line.description;
  };
  const badge =
    close === null
      ? { tone: "pending" as const, text: t("status.open") }
      : close.status === "submitted"
        ? { tone: "due" as const, text: t("status.submitted") }
        : { tone: "active" as const, text: t("status.closed") };
  const decides = staff.role === "manager" || staff.role === "ceo";
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex justify-between gap-4 border-b border-page py-2.5 text-sm ${strong ? "font-bold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold text-ink">{t("heading", { branch: branchName })}</h2>
            <span className="text-lg text-ink-muted">{formatWeekdayDate(date, "long")}</span>
            <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>
          </div>
          <PrintButton label={t("print")} />
        </div>

        <form
          method="get"
          action="/day-close"
          aria-label={t("pick")}
          className="flex flex-wrap items-end gap-3 print:hidden"
        >
          {chooses ? (
            <Field id="day-branch" label={t("branch")}>
              <select id="day-branch" name="branch" defaultValue={branchId} className={inputClass}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field id="day-date" label={t("date")}>
            <input
              id="day-date"
              name="date"
              type="date"
              max={String(today)}
              defaultValue={date}
              className={inputClass}
            />
          </Field>
          <button type="submit" className={buttonVariants({ variant: "secondary" })}>
            {t("show")}
          </button>
        </form>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr] lg:gap-5">
          <Card id="day-expected" title={t("expected.heading")}>
            {row(t("expected.opening"), formatMoney(summary.opening_cents))}
            {collections.length > 0
              ? row(t("expected.collections", { count: collections.length }), formatMoneySigned(collectedIn))
              : null}
            {otherLines.map((line) =>
              row(
                line.category === "disbursement"
                  ? t("expected.payout", { loan: line.loan_no ?? "" })
                  : line.description,
                formatMoneySigned(BigInt(line.in_cents) - BigInt(line.out_cents)),
              ),
            )}
            {expensesOut > 0n ? row(t("expected.expenses"), formatMoneySigned(-expensesOut)) : null}
            {row(t("expected.total"), formatMoney(summary.expected_cents), true)}
          </Card>

          <div className="grid content-start gap-4">
            <Card id="day-count" title={t("count.heading")}>
              {close === null ? (
                staff.role === "cashier" ? (
                  <CountForm branchId={branchId} date={date} expectedCents={String(summary.expected_cents)} />
                ) : (
                  <p className="text-sm text-ink-muted">{t("count.waitingForCashier")}</p>
                )
              ) : (
                <div className="grid gap-3">
                  {row(t("count.countedBy", { name: close.cashier }), formatMoney(close.counted_cash_cents))}
                  {row(t("count.variance"), formatMoneySigned(close.variance_cents), true)}
                  {close.note !== null ? (
                    <p className="text-sm">
                      <span className="text-ink-muted">{t("count.reason")}: </span>
                      {close.note}
                    </p>
                  ) : null}
                  {close.status === "approved" ? (
                    <p className="text-sm text-ink-muted">
                      {t("count.approvedBy", {
                        name: close.approver ?? "",
                        when: close.approved_at === null ? "" : formatDateTime(close.approved_at),
                      })}
                    </p>
                  ) : null}
                  {close.status === "submitted" && decides && close.request_id !== null ? (
                    <DecisionForm requestId={close.request_id} title={t("heading", { branch: branchName })} />
                  ) : null}
                  {close.status === "submitted" && !decides ? (
                    <p className="text-sm text-ink-muted">{t("count.waitingForManager")}</p>
                  ) : null}
                  {close.status === "approved" && decides ? <ReopenForm closeId={close.id} /> : null}
                </div>
              )}
              {reopened !== null && close === null ? (
                <p className="mt-3 rounded-control bg-warning-bg px-3 py-2 text-sm text-status-overdue-fg">
                  {reopened.reopen_reason !== null
                    ? t("count.reopened", { reason: reopened.reopen_reason })
                    : t("count.rejected")}
                </p>
              ) : null}
            </Card>
            {summary.field_cash.length > 0 ? (
              <Card id="day-field" title={t("field.heading")}>
                <ul className="grid gap-3">
                  {summary.field_cash.map((item) => (
                    <li key={item.receipt_no} className="grid gap-1 text-sm">
                      <span className="flex justify-between gap-3 font-semibold">
                        <span>{t("field.with", { name: item.officer })}</span>
                        <span className="tabular">{formatMoney(item.amount_cents)}</span>
                      </span>
                      <span className="text-ink-muted">
                        {t("field.detail", {
                          receipt: item.receipt_no,
                          name: item.customer,
                          loan: item.loan_no,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        </div>

        <section
          aria-labelledby="day-movements"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <h2 id="day-movements" className="p-4 text-base font-bold text-ink sm:px-6">
            {t("movements.heading")}
          </h2>
          {summary.lines.length === 0 ? (
            <p className="px-4 pb-8 text-center text-sm text-ink-muted">{t("movements.empty")}</p>
          ) : (
            <ScrollRegion label={t("movements.heading")}>
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead className="bg-subtle text-left text-xs text-ink-muted">
                  <tr>
                    {(["time", "reference", "description", "in", "out"] as const).map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`px-4 py-2.5 font-semibold ${column === "in" || column === "out" ? "text-right" : ""}`}
                      >
                        {t(`movements.columns.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((line) => (
                    <tr
                      key={`${line.journal_no}-${line.in_cents}-${line.out_cents}`}
                      className="border-t border-page"
                    >
                      <td className="tabular px-4 py-3">{formatTime(line.at)}</td>
                      <td className="tabular px-4 py-3">{line.reference}</td>
                      <td className="px-4 py-3">{describe(line)}</td>
                      <td className="tabular px-4 py-3 text-right">
                        {line.in_cents > 0 ? formatMoney(line.in_cents) : ""}
                      </td>
                      <td className="tabular px-4 py-3 text-right">
                        {line.out_cents > 0 ? formatMoney(line.out_cents) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </section>
      </div>
    </>
  );
}
