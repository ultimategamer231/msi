import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import {
  businessDateOf,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneySigned,
  formatShare,
  formatWeekdayDate,
} from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { LoanPillText } from "../loans/loan-pill";

/*
 * /dashboard (all staff; SPEC 9 /dashboard; FR-29; mock-up 05). One read (dashboard_data) gives
 * what this role needs: officers their due and overdue loans and field cash; cashiers today's
 * collections, the cash to close and unconfirmed field cash; managers and the CEO the portfolio,
 * PAR buckets, collections, approvals and what needs attention; the accountant cash by branch,
 * income this month and expenses waiting; the admin the system state.
 */
type Json = Record<string, unknown>;
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const STAGES = ["opened", "notice_sent", "court_filed", "judgment", "disposal", "closed"] as const;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const t = await getTranslations("dashboard");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "overdue";
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-4 sm:p-5",
        tone === "overdue" ? "border-warning-border bg-warning-bg" : "border-line bg-surface",
      )}
    >
      <p className={cn("text-sm", tone === "overdue" ? "text-status-overdue-fg" : "text-ink-muted")}>
        {label}
      </p>
      <p
        className={cn(
          "tabular mt-1 text-3xl font-bold",
          tone === "overdue" ? "text-status-overdue-fg" : "text-ink",
        )}
      >
        {value}
      </p>
      {note !== undefined ? (
        <p className={cn("mt-1 text-sm", tone === "overdue" ? "text-status-overdue-fg" : "text-ink-muted")}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

function Panel({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 p-4 sm:px-6">
        <h3 id={id} className="text-lg font-bold text-ink">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const staff = await requirePageAccess("/dashboard");
  const supabase = await createSupabaseServerClient();
  const [t, tShell, tStages, params, today, dashboard] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("shell"),
    getTranslations("approvals.recoveryStages"),
    searchParams,
    supabase.rpc("business_today"),
    supabase.rpc("dashboard_data"),
  ]);
  if (today.error !== null) throw new Error("Could not read the business date");
  const data = (dashboard.data ?? {}) as Json;
  const firstName = staff.fullName.split(" ")[0] ?? staff.fullName;
  const role = staff.role;
  const count = (value: unknown) => num((value as Json | undefined)?.count);
  const cents = (value: unknown) => num((value as Json | undefined)?.cents);

  const dueTable = (rows: Json[]) =>
    rows.length === 0 ? (
      <p className="px-4 pb-8 text-center text-sm text-ink-muted sm:px-6">{t("dueEmpty")}</p>
    ) : (
      <ScrollRegion label={t("dueTable")}>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
            <tr>
              {(["customer", "loan", "branch", "dueDate", "owes", "status"] as const).map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={cn("px-4 py-2.5 font-semibold", column === "owes" && "text-right")}
                >
                  {t(`columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pill = loanPill({
                status: str(row.status),
                dueDate: str(row.due_date),
                daysOverdue: num(row.days),
                totalOutCents: BigInt(num(row.owes_cents)),
                closedOn: null,
                today: today.data,
              });
              return (
                <tr key={str(row.loan_id)} className="border-t border-page">
                  <td className="px-4 py-3">{str(row.borrower)}</td>
                  <td className="tabular px-4 py-3">
                    <Link href={`/loans/${str(row.loan_id)}`}>{str(row.loan_no)}</Link>
                  </td>
                  <td className="px-4 py-3">{str(row.branch)}</td>
                  <td className="tabular px-4 py-3">{formatDate(str(row.due_date))}</td>
                  <td className="tabular px-4 py-3 text-right">{formatMoney(num(row.owes_cents))}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={pill.tone}>
                      <LoanPillText pill={pill} />
                    </StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    );
  const openList = (
    <Link href="/due" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}>
      {t("openList")}
    </Link>
  );

  const attention = (items: Json[]) => (
    <Panel id="dash-attention" title={t("attention.heading")}>
      {items.length === 0 ? (
        <p className="px-4 pb-8 text-sm text-ink-muted sm:px-6">{t("attention.none")}</p>
      ) : (
        <ul className="divide-y divide-page px-4 pb-2 sm:px-6">
          {items.map((item, index) => {
            const kind = str(item.kind);
            let title = "";
            let detail = "";
            let href: string | null = null;
            if (kind === "recovery") {
              const stage = str(item.stage) as (typeof STAGES)[number];
              const next = STAGES[STAGES.indexOf(stage) + 1];
              title = t("attention.recovery", { name: str(item.borrower), loan: str(item.loan_no) });
              detail = t("attention.recoveryDetail", {
                stage: tStages(stage),
                date: item.last_on === null ? "" : formatDate(str(item.last_on)),
              });
              if (next !== undefined)
                detail = `${detail} ${t("attention.recoveryNext", { next: tStages(next) })}`;
              href = `/recovery/${str(item.case_id)}`;
            } else if (kind === "ceo_loan") {
              title = t("attention.ceoLoan", {
                name: str(item.borrower),
                amount: formatMoney(num(item.amount_cents)),
              });
              detail = t("attention.ceoLoanDetail", {
                limit: formatMoney(num(item.limit_cents)),
                name: str(item.requested_by),
              });
              href = "/approvals";
            } else if (kind === "day_close_review") {
              const variance = num(item.variance_cents);
              title = t("attention.dayClose", { branch: str(item.branch), date: formatDate(str(item.date)) });
              detail =
                variance === 0
                  ? t("attention.dayCloseExact")
                  : t(variance < 0 ? "attention.dayCloseShort" : "attention.dayCloseOver", {
                      amount: formatMoney(Math.abs(variance)),
                    });
              href = `/day-close?branch=${str(item.branch_id)}&date=${str(item.date)}`;
            } else if (kind === "day_not_closed") {
              title = t("attention.dayClose", { branch: str(item.branch), date: formatDate(str(item.date)) });
              detail = t("attention.dayNotClosed");
              href = `/day-close?branch=${str(item.branch_id)}&date=${str(item.date)}`;
            } else if (kind === "field_cash") {
              title = t("attention.fieldCash", { amount: formatMoney(num(item.amount_cents)) });
              detail = t("attention.fieldCashDetail", {
                name: str(item.officer),
                date: formatDate(str(item.since)),
              });
              href = "/remittance";
            }
            return (
              <li key={index} className="py-3">
                {href !== null && (role === "manager" || role === "ceo" || kind !== "day_not_closed") ? (
                  <Link href={href} className="font-bold text-ink hover:text-primary">
                    {title}
                  </Link>
                ) : (
                  <p className="font-bold text-ink">{title}</p>
                )}
                <p className="text-sm text-ink-muted">{detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );

  let body: ReactNode = null;
  if (role === "loan_officer") {
    body = (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t("officer.dueToday")}
            value={formatMoney(cents(data.due_today))}
            note={t("loans", { count: count(data.due_today) })}
          />
          <Stat
            tone="overdue"
            label={t("officer.overdue")}
            value={formatMoney(cents(data.overdue))}
            note={t("loans", { count: count(data.overdue) })}
          />
          <Stat
            label={t("officer.remittance")}
            value={formatMoney(cents(data.pending_remittance))}
            note={t("receipts", { count: count(data.pending_remittance) })}
          />
        </div>
        <Panel id="dash-due" title={t("myDue")} action={openList}>
          {dueTable(Array.isArray(data.due_now) ? (data.due_now as Json[]) : [])}
        </Panel>
      </>
    );
  } else if (role === "cashier") {
    const drawer = (data.drawer ?? {}) as Json;
    body = (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t("cashier.collections")}
            value={formatMoney(cents(data.collections_today))}
            note={t("receipts", { count: count(data.collections_today) })}
          />
          <Stat
            label={t("cashier.toClose")}
            value={formatMoney(num(drawer.expected_cents))}
            note={t("cashier.toCloseNote")}
          />
          <Stat
            label={t("cashier.field")}
            value={formatMoney(cents(data.field_unconfirmed))}
            note={t("receipts", { count: count(data.field_unconfirmed) })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/payments/new"
            className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}
          >
            {t("cashier.receive")}
          </Link>
          <Link href="/remittance" className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}>
            {t("cashier.confirmField")}
          </Link>
          <Link href="/day-close" className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}>
            {t("cashier.closeDay")}
          </Link>
        </div>
        {data.yesterday_closed === false ? (
          <Callout tone="warning">{t("cashier.yesterdayOpen")}</Callout>
        ) : null}
      </>
    );
  } else if (role === "manager" || role === "ceo") {
    const portfolio = (data.portfolio ?? {}) as Json;
    const overdue = (data.overdue ?? {}) as Json;
    const buckets = (overdue.buckets ?? {}) as Record<string, Json>;
    const collected = (data.collected ?? null) as Json | null;
    const approvals = (data.approvals ?? {}) as Json;
    const overdueTotal = num(overdue.total_cents);
    const portfolioCents = num(portfolio.cents);
    const oldestDays =
      approvals.oldest === null || approvals.oldest === undefined
        ? null
        : Math.max(
            0,
            Math.floor(
              (Date.parse(`${today.data}T00:00:00Z`) -
                Date.parse(`${businessDateOf(str(approvals.oldest))}T00:00:00Z`)) /
                86_400_000,
            ),
          );
    const largest = Object.values(buckets).reduce((max, value) => Math.max(max, num(value.total_cents)), 0);
    body = (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label={t("manager.outstanding")}
            value={formatMoney(portfolioCents)}
            note={t("manager.openLoans", { loans: num(portfolio.loans), branches: num(portfolio.branches) })}
          />
          <Stat
            tone="overdue"
            label={t("manager.overdue")}
            value={formatMoney(overdueTotal)}
            note={
              portfolioCents > 0
                ? t("manager.share", { share: formatShare(overdueTotal, portfolioCents) })
                : undefined
            }
          />
          <Stat
            label={
              collected === null
                ? t("manager.collectedNone")
                : t("manager.collectedOn", { date: formatDate(str(collected.date)) })
            }
            value={formatMoney(num(collected?.total_cents))}
            note={
              collected === null
                ? undefined
                : num(collected.field_pending_cents) > 0
                  ? t("manager.collectedField", {
                      count: num(collected.count),
                      amount: formatMoney(num(collected.field_pending_cents)),
                    })
                  : t("receipts", { count: num(collected.count) })
            }
          />
          <Stat
            label={t("manager.approvals")}
            value={String(num(approvals.count))}
            note={oldestDays === null ? t("manager.noneWaiting") : t("manager.oldest", { days: oldestDays })}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <Panel id="dash-age" title={t("manager.byAge")}>
            <div className="grid gap-4 px-4 pb-6 sm:px-6">
              {(["1_7", "8_30", "31_plus"] as const).map((bucket) => {
                const value = buckets[bucket] ?? {};
                const amount = num(value.total_cents);
                const width = largest > 0 ? Number((BigInt(amount) * 100n) / BigInt(largest)) : 0;
                return (
                  <div key={bucket} className="grid gap-1.5">
                    <div className="flex justify-between gap-3 text-sm font-semibold">
                      <span>{t(`manager.ages.${bucket}`, { count: num(value.loans) })}</span>
                      <span className="tabular">{formatMoney(amount)}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-line" aria-hidden="true">
                      <div
                        className="h-2.5 rounded-full bg-status-overdue-strong"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="text-sm text-ink-muted">
                {t("manager.ageNote", {
                  amount: formatMoney(overdueTotal),
                  count: Array.isArray(overdue.rows)
                    ? overdue.rows.length
                    : Object.values(buckets).reduce((sum, value) => sum + num(value.loans), 0),
                })}
              </p>
            </div>
          </Panel>
          {attention(Array.isArray(data.attention) ? (data.attention as Json[]) : [])}
        </div>
        <Panel id="dash-due" title={t("manager.dueNow")} action={openList}>
          {dueTable(Array.isArray(data.due_now) ? (data.due_now as Json[]) : [])}
        </Panel>
      </>
    );
  } else if (role === "accountant") {
    const cash = (data.cash ?? {}) as Json;
    const income = (data.income_month ?? {}) as Json;
    const waiting = (data.expenses_waiting ?? {}) as Json;
    body = (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label={t("accountant.cash")}
            value={formatMoney(num(cash.total_cents))}
            note={t("accountant.cashNote")}
          />
          <Stat
            label={t("accountant.income")}
            value={formatMoney(num(income.income_cents))}
            note={t("accountant.net", { amount: formatMoneySigned(num(income.net_cents)) })}
          />
          <Stat
            label={t("accountant.expensesWaiting")}
            value={formatMoney(num(waiting.cents))}
            note={t("accountant.expensesCount", { count: num(waiting.count) })}
          />
          <Stat label={t("accountant.payees")} value={formatMoney(num(data.owed_to_payees))} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <Panel id="dash-cash" title={t("accountant.cashByBranch")}>
            <ul className="divide-y divide-page px-4 pb-2 sm:px-6">
              {(Array.isArray(cash.accounts) ? (cash.accounts as Json[]) : []).map((account) => (
                <li key={str(account.code)} className="flex justify-between gap-3 py-2.5 text-sm">
                  <span>
                    {str(account.code)} · {str(account.name)}
                  </span>
                  <span className="tabular font-semibold">{formatMoney(num(account.balance_cents))}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {attention(Array.isArray(data.attention) ? (data.attention as Json[]) : [])}
        </div>
      </>
    );
  } else {
    const lastRun = (data.last_run ?? null) as Json | null;
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={t("admin.goLive")}
          value={
            data.go_live === null || data.go_live === undefined
              ? t("admin.notSet")
              : formatDate(str(data.go_live))
          }
        />
        <Stat
          label={t("admin.lastRun")}
          value={lastRun === null ? t("admin.never") : formatDate(str(lastRun.run_date))}
          note={lastRun === null ? undefined : formatDateTime(str(lastRun.finished_at))}
        />
        <Stat
          label={t("admin.users")}
          value={String(num(data.users))}
          note={t("admin.branches", { count: num(data.branches) })}
        />
      </div>
    );
  }

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        {params.notice === "forbidden" ? (
          <Callout tone="warning" role="alert">
            {t("forbidden")}
          </Callout>
        ) : null}
        <div>
          <h2 id="greeting" className="text-xl font-bold text-ink lg:text-2xl">
            {t("greeting", { name: firstName })}
          </h2>
          <p className="mt-1 text-sm text-ink-muted" data-testid="business-date">
            {t("today", {
              date: formatWeekdayDate(today.data),
              branch: staff.branch?.name ?? tShell("allBranches"),
            })}
          </p>
        </div>
        {dashboard.error !== null ? <Callout tone="warning">{t("error")}</Callout> : body}
      </div>
    </>
  );
}
