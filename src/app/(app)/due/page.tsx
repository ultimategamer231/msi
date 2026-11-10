import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { PrintListButton, RunJobButton } from "./run-job";

/*
 * /due (all staff; SPEC 9, 10.3, mock-up 11; FR-13): loans due today, due within the window
 * (setting due.upcoming_days, B-07) and overdue, with Call and a WhatsApp reminder per row. Loans
 * in recovery are counted but listed on the recovery screen (M6). Managers and the admin can run
 * the daily job by hand (D-11). CSV export comes with the report pack (M8).
 */
const TABS = ["all", "overdue", "today", "soon"] as const;
type Tab = (typeof TABS)[number];
const uuid = /^[0-9a-f-]{36}$/;
type Params = Awaited<PageProps<"/due">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}
const inTab = (tab: Tab, bucket: string) =>
  tab === "all" ||
  (tab === "overdue" && bucket.startsWith("overdue")) ||
  (tab === "today" && bucket === "due_today") ||
  (tab === "soon" && bucket === "due_7d");

export default async function DuePage(props: PageProps<"/due">) {
  const t = await getTranslations("due");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <DueContent {...props} />
    </Suspense>
  );
}

async function DueContent({ searchParams }: PageProps<"/due">) {
  const staff = await requirePageAccess("/due");
  const [t, params] = await Promise.all([getTranslations("due"), searchParams]);
  const tab: Tab = (TABS as readonly string[]).includes(single(params.tab))
    ? (single(params.tab) as Tab)
    : "all";
  const filters = {
    branch: uuid.test(single(params.branch)) ? single(params.branch) : "",
    officer: uuid.test(single(params.officer)) ? single(params.officer) : "",
  };
  const runs = staff.role === "manager" || staff.role === "admin";
  const supabase = await createSupabaseServerClient();
  const [dueResult, recoveryResult, todayResult, windowResult, branchesResult, peopleResult, runsResult] =
    await Promise.all([
      supabase.from("due_list").select("*").order("due_date").order("loan_id"),
      supabase.from("loans").select("id").eq("status", "recovery"),
      supabase.rpc("business_today"),
      supabase.from("settings").select("value").eq("key", "due.upcoming_days").maybeSingle(),
      supabase.from("branches").select("id, name").order("code"),
      supabase.from("profiles").select("id, full_name, role").order("full_name"),
      runs
        ? supabase
            .from("accrual_runs")
            .select("run_date, finished_at, source, penalties_posted, overdue_marked")
            .order("finished_at", { ascending: false })
            .limit(3)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (
    dueResult.error !== null ||
    recoveryResult.error !== null ||
    todayResult.error !== null ||
    branchesResult.error !== null ||
    peopleResult.error !== null ||
    runsResult.error !== null
  ) {
    throw new Error("Could not read the due list");
  }
  const window = Number(windowResult.data?.value ?? 7);
  const ids = dueResult.data.map((row) => row.loan_id ?? "");
  const recoveryIds = recoveryResult.data.map((row) => row.id);
  const [loansResult, recoveryBalances] = await Promise.all([
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("loans")
          .select(
            "id, loan_no, branch_id, officer_id, customers!inner(type, first_name, last_name, business_name, phone)",
          )
          .in("id", ids),
    recoveryIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("loan_balances").select("total_out").in("loan_id", recoveryIds),
  ]);
  if (loansResult.error !== null || recoveryBalances.error !== null) throw new Error("Could not read loans");
  const loans = new Map(loansResult.data.map((loan) => [loan.id, loan]));
  const names = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));

  const rows = dueResult.data
    .map((row) => ({ ...row, loan: loans.get(row.loan_id ?? "") }))
    .filter((row) => row.loan !== undefined)
    .filter((row) => filters.branch === "" || row.loan?.branch_id === filters.branch)
    .filter((row) => filters.officer === "" || row.loan?.officer_id === filters.officer);
  const sum = (bucket: (value: string) => boolean) => {
    const matching = rows.filter((row) => bucket(row.bucket ?? ""));
    return {
      count: matching.length,
      cents: matching.reduce((total, row) => total + BigInt(row.total_out ?? 0), 0n),
    };
  };
  const cards = [
    { key: "overdue", ...sum((bucket) => bucket.startsWith("overdue")) },
    { key: "today", ...sum((bucket) => bucket === "due_today") },
    { key: "soon", ...sum((bucket) => bucket === "due_7d") },
    {
      key: "recovery",
      count: recoveryIds.length,
      cents: recoveryBalances.data.reduce((total, row) => total + BigInt(row.total_out ?? 0), 0n),
    },
  ] as const;
  const counts = new Map(
    TABS.map((target) => [target, rows.filter((row) => inTab(target, row.bucket ?? "")).length]),
  );
  const shown = rows.filter((row) => inTab(tab, row.bucket ?? ""));

  const href = (changes: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab: tab === "all" ? "" : tab, ...filters, ...changes }))
      if (value !== "") search.set(key, value);
    const text = search.toString();
    return text === "" ? "/due" : `/due?${text}`;
  };
  const pill = (days: number): { tone: BadgeTone; text: string } =>
    days > 0
      ? { tone: "overdue", text: t("pill.overdue", { count: days }) }
      : days === 0
        ? { tone: "due", text: t("pill.today") }
        : { tone: "due", text: t("pill.in", { count: -days }) };
  const nextPenalty = (row: (typeof rows)[number]) =>
    row.next_penalty_on === null
      ? "–"
      : row.last_penalty === true
        ? t("lastPenalty", { date: formatDate(row.next_penalty_on) })
        : formatDate(row.next_penalty_on);
  const actions = (row: (typeof rows)[number], name: string, phone: string) => (
    <div className="flex gap-2">
      <a
        href={`tel:${phone.replace(/[^\d+]/g, "")}`}
        aria-label={t("callLabel", { name })}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
      >
        {t("call")}
      </a>
      <a
        href={`/api/reminder/${row.loan_id ?? ""}`}
        target="_blank"
        rel="noopener"
        aria-label={t("remindLabel", { name })}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
      >
        {t("remind")}
      </a>
    </div>
  );

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6 print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">{t("asAt", { date: formatDate(todayResult.data) })}</p>
          <div className="print:hidden">
            <PrintListButton label={t("print")} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {cards.map((card) => (
            <section
              key={card.key}
              aria-labelledby={`due-card-${card.key}`}
              className="rounded-card border border-line bg-surface p-4"
            >
              <h2 id={`due-card-${card.key}`} className="text-sm text-ink-muted">
                {card.key === "soon" ? t("cards.soon", { days: window }) : t(`cards.${card.key}`)}
              </h2>
              <p className="tabular mt-1 text-xl font-bold text-ink sm:text-2xl">{formatMoney(card.cents)}</p>
              <p className="text-sm text-ink-muted">{t("loans", { count: card.count })}</p>
            </section>
          ))}
        </div>

        <section aria-labelledby="due-results" className="min-w-0 rounded-card border border-line bg-surface">
          <div className="grid gap-3 border-b border-page p-4 lg:flex lg:items-end lg:justify-between print:hidden">
            <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
              {TABS.map((target) => (
                <Link
                  key={target}
                  href={href({ tab: target === "all" ? "" : target })}
                  aria-current={target === tab ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-control border px-4 text-sm font-semibold whitespace-nowrap lg:min-h-10",
                    target === tab
                      ? "border-primary bg-primary text-white hover:text-white"
                      : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
                  )}
                >
                  {target === "soon" ? t("tabs.soon", { days: window }) : t(`tabs.${target}`)}{" "}
                  <span className="tabular">{counts.get(target)}</span>
                </Link>
              ))}
            </nav>
            <form
              method="get"
              action="/due"
              aria-label={t("filters.label")}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
              <Field id="due-branch" label={t("filters.branch")}>
                <select id="due-branch" name="branch" defaultValue={filters.branch} className={inputClass}>
                  <option value="">{t("filters.anyBranch")}</option>
                  {branchesResult.data.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="due-officer" label={t("filters.officer")}>
                <select id="due-officer" name="officer" defaultValue={filters.officer} className={inputClass}>
                  <option value="">{t("filters.anyOfficer")}</option>
                  {peopleResult.data
                    .filter((person) => person.role === "loan_officer")
                    .map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                </select>
              </Field>
              <button type="submit" className={buttonVariants({ variant: "secondary" })}>
                {t("filters.apply")}
              </button>
            </form>
          </div>

          <h2 id="due-results" className="sr-only" aria-live="polite">
            {t("loans", { count: shown.length })}
          </h2>
          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <>
              <ul className="divide-y divide-page md:hidden print:hidden">
                {shown.map((row) => {
                  const name = row.loan === undefined ? "" : customerName(row.loan.customers);
                  const status = pill(row.days ?? 0);
                  return (
                    <li key={row.loan_id} className="grid gap-2 px-4 py-3">
                      <Link href={`/loans/${row.loan_id}`} className="grid gap-1 text-ink hover:text-ink">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{name}</span>
                          <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                        </span>
                        <span className="tabular text-sm text-ink-muted">
                          {row.loan?.loan_no} · {t("dueOn", { date: formatDate(row.due_date ?? "") })} ·{" "}
                          {t("owes", { amount: formatMoney(row.total_out ?? 0) })}
                        </span>
                      </Link>
                      {actions(row, name, row.loan?.customers.phone ?? "")}
                    </li>
                  );
                })}
              </ul>
              <ScrollRegion label={t("tableLabel")} className="hidden md:block print:block">
                <table className="w-full min-w-[1040px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {(
                        [
                          "loan",
                          "borrower",
                          "phone",
                          "officer",
                          "due",
                          "days",
                          "penalty",
                          "owes",
                          "next",
                          "actions",
                        ] as const
                      ).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className={cn(
                            "px-4 py-2.5 font-semibold",
                            ["penalty", "owes"].includes(column) && "text-right",
                            column === "actions" && "print:hidden",
                          )}
                        >
                          {column === "actions" ? (
                            <span className="sr-only">{t("columns.actions")}</span>
                          ) : (
                            t(`columns.${column}`)
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const name = row.loan === undefined ? "" : customerName(row.loan.customers);
                      const status = pill(row.days ?? 0);
                      return (
                        <tr key={row.loan_id} className="border-t border-page">
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            <Link href={`/loans/${row.loan_id}`} className="font-semibold">
                              {row.loan?.loan_no}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{name}</td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">{row.loan?.customers.phone}</td>
                          <td className="px-4 py-3">
                            {row.loan?.officer_id ? (names.get(row.loan.officer_id) ?? "") : "–"}
                          </td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            {formatDate(row.due_date ?? "")}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {formatMoney(row.penalty_out ?? 0)}
                          </td>
                          <td className="tabular px-4 py-3 text-right font-semibold">
                            {formatMoney(row.total_out ?? 0)}
                          </td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">{nextPenalty(row)}</td>
                          <td className="px-4 py-3 print:hidden">
                            {actions(row, name, row.loan?.customers.phone ?? "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollRegion>
            </>
          )}
        </section>
        {cards[3].count > 0 ? (
          <p className="text-sm text-ink-muted">{t("recoveryNote", { count: cards[3].count })}</p>
        ) : null}

        {runs ? (
          <section
            aria-labelledby="due-job"
            className="grid gap-3 rounded-card border border-line bg-surface p-4 print:hidden"
          >
            <h2 id="due-job" className="text-base font-bold text-ink">
              {t("job.heading")}
            </h2>
            <p className="text-sm text-ink-muted">{t("job.intro")}</p>
            {runsResult.data.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("job.never")}</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {runsResult.data.map((run) => (
                  <li key={run.finished_at} className="tabular text-ink">
                    {t("job.line", {
                      when: formatDateTime(run.finished_at),
                      source: t(`job.sources.${run.source as "cron"}`),
                      date: formatDate(run.run_date),
                      penalties: run.penalties_posted,
                      overdue: run.overdue_marked,
                    })}
                  </li>
                ))}
              </ul>
            )}
            <RunJobButton />
          </section>
        ) : null}
      </div>
    </>
  );
}
