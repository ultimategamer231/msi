import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ageOf } from "@/lib/when";

import { changesOf, describeCustomerValue, type Lookups } from "../customers/describe";
import { ID_TYPES } from "../customers/schemas";

import { DecisionForm } from "./decision-form";

import messages from "../../../../messages/en.json";

/*
 * /approvals (SPEC 9, mock-up 12; FR-28): one inbox for every maker-checker request. Managers and
 * the CEO see what is waiting for them (never their own requests) and what was decided; everyone
 * sees the requests they made under "Mine".
 */
const PAGE_SIZE = 25;
const TABS = ["waiting", "approved", "rejected", "mine"] as const;
type Tab = (typeof TABS)[number];

type Params = Awaited<PageProps<"/approvals">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const t = await getTranslations("approvals");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ApprovalsContent searchParams={searchParams} />
    </Suspense>
  );
}

interface RequestRow {
  id: string;
  type: string;
  status: string;
  payload: unknown;
  reason: string | null;
  required_role: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

interface JournalLine {
  account?: string;
  debit_cents?: number;
  credit_cents?: number;
}

function tabClass(active: boolean) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ease-out lg:min-h-10",
    active
      ? "border-primary bg-primary text-white hover:text-white"
      : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
  );
}

async function ApprovalsContent({ searchParams }: { searchParams: PageProps<"/approvals">["searchParams"] }) {
  const staff = await requirePageAccess("/approvals");
  const [t, tCustomers, tForm, tWhen, params] = await Promise.all([
    getTranslations("approvals"),
    getTranslations("customers"),
    getTranslations("customers.form"),
    getTranslations("when"),
    searchParams,
  ]);
  const decides = staff.role === "manager" || staff.role === "ceo";
  const tabs: readonly Tab[] = decides ? TABS : ["mine"];
  const requested = single(params.tab) as Tab;
  const tab: Tab = tabs.includes(requested) ? requested : (tabs[0] ?? "mine");
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  const supabase = await createSupabaseServerClient();
  const columns =
    "id, type, status, payload, reason, required_role, requested_by, requested_at, decided_by, decided_at, decision_note";
  const waitingQuery = () => {
    let query = supabase
      .from("approval_requests")
      .select(columns, { count: "exact" })
      .eq("status", "pending")
      .neq("requested_by", staff.id);
    if (staff.role === "manager") query = query.eq("required_role", "manager");
    return query;
  };
  let listQuery;
  if (tab === "waiting") listQuery = waitingQuery().order("requested_at", { ascending: true });
  else if (tab === "mine")
    listQuery = supabase
      .from("approval_requests")
      .select(columns, { count: "exact" })
      .eq("requested_by", staff.id)
      .order("requested_at", { ascending: false });
  else
    listQuery = supabase
      .from("approval_requests")
      .select(columns, { count: "exact" })
      .eq("status", tab)
      .order("decided_at", { ascending: false });
  listQuery = listQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [list, waitingCount, branchesResult, peopleResult, accountsResult, nowResult] = await Promise.all([
    listQuery,
    decides ? waitingQuery().limit(1) : Promise.resolve({ count: 0, error: null }),
    supabase.from("branches").select("id, name"),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("accounts").select("code, name"),
    supabase.rpc("app_now"),
  ]);
  if (list.error !== null || waitingCount.error !== null || nowResult.error !== null) {
    throw new Error("Could not read approvals");
  }
  if (branchesResult.error !== null || peopleResult.error !== null || accountsResult.error !== null) {
    throw new Error("Could not read approvals");
  }
  const rows = list.data as RequestRow[];
  const total = list.count ?? 0;
  const waiting = waitingCount.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const people = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));
  const accounts = new Map(accountsResult.data.map((account) => [account.code, account.name]));
  const lookups: Lookups = {
    branches: new Map(branchesResult.data.map((branch) => [branch.id, branch.name])),
    people,
    idTypes: Object.fromEntries(ID_TYPES.map((idType) => [idType, tForm(`idTypes.${idType}`)])),
    statuses: {
      active: tCustomers("status.active"),
      blacklisted: tCustomers("status.blacklisted"),
      archived: tCustomers("status.archived"),
    },
    none: t("none"),
  };

  const ageText = (at: string) => {
    const age = ageOf(at, nowResult.data);
    switch (age.kind) {
      case "now":
        return tWhen("now");
      case "minutes":
        return tWhen("minutes", { count: age.count });
      case "hours":
        return tWhen("hours", { count: age.count });
      case "today":
        return tWhen("today", { time: age.time });
      case "yesterday":
        return tWhen("yesterday", { time: age.time });
      default:
        return tWhen("date", { date: age.date, time: age.time });
    }
  };
  const typeLabel = (type: string) =>
    type in messages.approvals.types ? t(`types.${type as keyof typeof messages.approvals.types}`) : type;
  const columnLabel = (column: string) =>
    column in messages.customers.profile.columns
      ? tCustomers(`profile.columns.${column as keyof typeof messages.customers.profile.columns}`)
      : column;

  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (tab !== tabs[0]) search.set("tab", tab);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text === "" ? "/approvals" : `/approvals?${text}`;
  };

  const statusTone: Record<string, BadgeTone> = {
    pending: "due",
    approved: "active",
    rejected: "overdue",
    cancelled: "pending",
  };

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {decides ? t("waitingForYou", { count: waiting }) : t("mineIntro")}
        </p>
        {tabs.length > 1 ? (
          <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <Link
                key={item}
                href={item === tabs[0] ? "/approvals" : `/approvals?tab=${item}`}
                aria-current={item === tab ? "page" : undefined}
                className={tabClass(item === tab)}
              >
                {t(`tabs.${item}`)}
                {item === "waiting" ? <span className="tabular">{waiting}</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
            {t(`empty.${tab}`)}
          </p>
        ) : (
          <ul className="grid gap-4">
            {rows.map((row) => {
              const payload = (row.payload ?? {}) as Record<string, unknown>;
              const changes = changesOf(row.payload);
              const lines = Array.isArray(payload.lines) ? (payload.lines as JournalLine[]) : [];
              const total = lines.reduce((sum, line) => sum + BigInt(line.debit_cents ?? 0), 0n);
              let title: string;
              if (row.type === "customer_edit" || row.type === "customer_blacklist") {
                const fields = [
                  ...changes.map((change) => columnLabel(change.column).toLowerCase()),
                  ...("photo" in payload ? [t("photo").toLowerCase()] : []),
                ];
                title = t("titles.customer", { name: String(payload.name ?? ""), fields: fields.join(", ") });
              } else if (row.type === "manual_journal" || row.type === "capital_in") {
                title = t("titles.journal", { memo: String(payload.memo ?? ""), amount: formatMoney(total) });
              } else {
                title = typeLabel(row.type);
              }
              const headingId = `request-${row.id}`;
              return (
                <li key={row.id}>
                  <article
                    aria-labelledby={headingId}
                    className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
                  >
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <StatusBadge tone="pending">{typeLabel(row.type)}</StatusBadge>
                        <h2 id={headingId} className="text-base font-bold break-words text-ink">
                          {title}
                        </h2>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-ink-muted">
                        <span>
                          {people.get(row.requested_by) ?? ""} · {ageText(row.requested_at)}
                        </span>
                        {tab === "mine" ? (
                          <StatusBadge tone={statusTone[row.status] ?? "pending"}>
                            {t(`status.${row.status as "pending"}`)}
                          </StatusBadge>
                        ) : null}
                      </div>
                    </header>

                    {row.type === "customer_edit" || row.type === "customer_blacklist" ? (
                      <div className="grid gap-3">
                        {changes.map((change) => (
                          <div key={change.column} className="grid gap-2">
                            {changes.length > 1 ? (
                              <p className="text-sm font-semibold text-ink">{columnLabel(change.column)}</p>
                            ) : null}
                            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="min-w-0">
                                <dt className="text-xs font-medium text-ink-muted">{t("current")}</dt>
                                <dd className="mt-0.5 font-semibold break-words text-ink">
                                  {describeCustomerValue(change.column, change.before, lookups)}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs font-medium text-ink-muted">{t("requested")}</dt>
                                <dd className="mt-0.5 font-semibold break-words text-ink">
                                  {describeCustomerValue(change.column, change.after, lookups)}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                        {"photo" in payload ? <p className="text-sm text-ink">{t("newPhoto")}</p> : null}
                        {row.reason !== null ? (
                          <p className="text-sm text-ink">
                            <span className="text-ink-muted">{t("reasonGiven")}: </span>
                            {row.reason}
                          </p>
                        ) : null}
                        {"duplicate_override" in payload ? (
                          <p className="rounded-control bg-warning-bg px-3 py-2 text-sm text-status-overdue-fg">
                            {t("duplicateOverride")}
                          </p>
                        ) : null}
                        {typeof payload.customer_id === "string" ? (
                          <Link href={`/customers/${payload.customer_id}`} className="text-sm font-semibold">
                            {t("openCustomer", { code: String(payload.code ?? "") })}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}

                    {row.type === "manual_journal" || row.type === "capital_in" ? (
                      <div className="grid gap-3">
                        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <dt className="text-xs font-medium text-ink-muted">{t("date")}</dt>
                            <dd className="mt-0.5 font-semibold text-ink">
                              {typeof payload.entry_date === "string" ? formatDate(payload.entry_date) : ""}
                            </dd>
                          </div>
                          {typeof payload.reference === "string" ? (
                            <div>
                              <dt className="text-xs font-medium text-ink-muted">{t("reference")}</dt>
                              <dd className="mt-0.5 font-semibold text-ink">{payload.reference}</dd>
                            </div>
                          ) : null}
                        </dl>
                        <table className="w-full border-collapse text-sm">
                          <caption className="sr-only">{t("linesOf", { title })}</caption>
                          <thead className="bg-subtle text-left text-xs text-ink-muted">
                            <tr>
                              <th scope="col" className="px-3 py-2 font-semibold">
                                {t("account")}
                              </th>
                              <th scope="col" className="px-3 py-2 text-right font-semibold">
                                {t("debit")}
                              </th>
                              <th scope="col" className="px-3 py-2 text-right font-semibold">
                                {t("credit")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((line, index) => (
                              <tr key={`${line.account ?? ""}-${index}`} className="border-t border-page">
                                <td className="px-3 py-2 text-ink">
                                  {line.account} · {accounts.get(line.account ?? "") ?? ""}
                                </td>
                                <td className="tabular px-3 py-2 text-right">
                                  {line.debit_cents === undefined ? "" : formatMoney(line.debit_cents)}
                                </td>
                                <td className="tabular px-3 py-2 text-right">
                                  {line.credit_cents === undefined ? "" : formatMoney(line.credit_cents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {row.status === "pending" && tab === "waiting" ? (
                      <DecisionForm requestId={row.id} title={title} />
                    ) : null}
                    {row.status !== "pending" && row.decided_at !== null ? (
                      <p className="text-sm text-ink-muted">
                        {t(row.status === "approved" ? "decidedApproved" : "decidedRejected", {
                          name: row.decided_by === null ? "" : (people.get(row.decided_by) ?? ""),
                          when: ageText(row.decided_at),
                        })}
                        {row.decision_note !== null ? ` · ${row.decision_note}` : ""}
                      </p>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 ? (
          <nav aria-label={t("page", { page, pages })} className="flex items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">{t("page", { page, pages })}</p>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                >
                  {t("previous")}
                </Link>
              ) : null}
              {page < pages ? (
                <Link
                  href={pageHref(page + 1)}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                >
                  {t("next")}
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}

        {decides ? <p className="text-sm text-ink-muted">{t("footer")}</p> : null}
      </div>
    </>
  );
}
