import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName, likePattern } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { LOAN_TABS, loanPill, type LoanTab } from "@/lib/loans";
import { canAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { LoanPillText } from "./loan-pill";

/*
 * /loans (all staff; SPEC 9, mock-up 06): status tabs, search by loan number or customer, branch
 * and officer filters, per-row amount owed and days overdue. By default it lists open loans and
 * loans that ended this calendar year (B-13); "Include older" shows everything.
 */
const PAGE_SIZE = 25;
type Params = Awaited<PageProps<"/loans">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}
const uuid = /^[0-9a-f-]{36}$/;

const OPEN = ["draft", "pending_approval", "approved", "active", "overdue", "recovery"];

export default async function LoansPage({ searchParams }: PageProps<"/loans">) {
  const t = await getTranslations("loans");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <LoansContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoansContent({ searchParams }: { searchParams: PageProps<"/loans">["searchParams"] }) {
  const staff = await requirePageAccess("/loans");
  const [t, params] = await Promise.all([getTranslations("loans"), searchParams]);
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) throw new Error("Could not read the business date");
  const yearStart = `${today.slice(0, 4)}-01-01`;

  const tab: LoanTab = (LOAN_TABS as readonly string[]).includes(single(params.tab))
    ? (single(params.tab) as LoanTab)
    : "all";
  const filters = {
    q: single(params.q).trim().slice(0, 100),
    branch: uuid.test(single(params.branch)) ? single(params.branch) : "",
    officer: uuid.test(single(params.officer)) ? single(params.officer) : "",
    older: single(params.older) === "1" ? "1" : "",
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  // Customers matching the search, so the list can filter by loan number or customer.
  let customerIds: string[] | null = null;
  if (filters.q !== "") {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .ilike("search_text", likePattern(filters.q.toLowerCase()))
      .limit(200);
    customerIds = (data ?? []).map((row) => row.id);
  }

  const scoped = (target: LoanTab) => {
    let query = supabase
      .from("loans")
      .select(
        "id, loan_no, status, principal_cents, due_date, closed_on, created_at, customer_id, branch_id, officer_id, customers!inner(id, type, first_name, last_name, business_name)",
        { count: "exact" },
      );
    if (filters.older === "") {
      query = query.or(
        `status.in.(${OPEN.join(",")}),closed_on.gte.${yearStart},created_at.gte.${yearStart}T00:00:00Z`,
      );
    }
    if (filters.branch !== "") query = query.eq("branch_id", filters.branch);
    if (filters.officer !== "") query = query.eq("officer_id", filters.officer);
    if (filters.q !== "") {
      const ids = customerIds ?? [];
      const loanNo = `loan_no.ilike.${likePattern(filters.q.toUpperCase())}`;
      query = ids.length > 0 ? query.or(`${loanNo},customer_id.in.(${ids.join(",")})`) : query.or(loanNo);
    }
    switch (target) {
      case "active":
        return query.in("status", ["active", "overdue"]).gt("due_date", today);
      case "dueToday":
        return query.in("status", ["active", "overdue"]).eq("due_date", today);
      case "overdue":
        return query.in("status", ["active", "overdue"]).lt("due_date", today);
      case "recovery":
        return query.eq("status", "recovery");
      case "pending":
        return query.in("status", ["draft", "pending_approval", "approved"]);
      case "closed":
        return query.in("status", ["closed", "written_off"]);
      default:
        return query;
    }
  };

  const listQuery = scoped(tab)
    .order("created_at", { ascending: false })
    .order("loan_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const countQueries = LOAN_TABS.map((target) => scoped(target).limit(1));
  const [list, branchesResult, peopleResult, ...counts] = await Promise.all([
    listQuery,
    supabase.from("branches").select("id, name").order("code"),
    supabase.from("profiles").select("id, full_name, role").order("full_name"),
    ...countQueries,
  ]);
  if (list.error !== null || branchesResult.error !== null || peopleResult.error !== null) {
    throw new Error("Could not read loans");
  }
  const rows = list.data;
  const ids = rows.map((row) => row.id);
  const [balancesResult, pendingResult, openTotals] = await Promise.all([
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("loan_balances").select("loan_id, total_out, days_overdue").in("loan_id", ids),
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("approval_requests")
          .select("entity_id, required_role")
          .eq("type", "loan_approval")
          .eq("status", "pending")
          .in("entity_id", ids),
    // Open loans are the ones that still owe something (closed and written-off loans owe nothing).
    supabase.from("loan_balances").select("total_out").gt("total_out", 0),
  ]);
  if (balancesResult.error !== null) throw new Error("Could not read balances");

  const balances = new Map((balancesResult.data ?? []).map((row) => [row.loan_id, row]));
  const pendingRoles = new Map((pendingResult.data ?? []).map((row) => [row.entity_id, row.required_role]));
  const branchNames = new Map(branchesResult.data.map((branch) => [branch.id, branch.name]));
  const names = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));
  const tabCounts = new Map(LOAN_TABS.map((target, position) => [target, counts[position]?.count ?? 0]));
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const openCount = (openTotals.data ?? []).length;
  const openOwed = (openTotals.data ?? []).reduce((sum, row) => sum + BigInt(row.total_out ?? 0), 0n);

  const href = (changes: Record<string, string>) => {
    const search = new URLSearchParams();
    const merged = { tab: tab === "all" ? "" : tab, ...filters, ...changes };
    for (const [key, value] of Object.entries(merged)) if (value !== "") search.set(key, value);
    const text = search.toString();
    return text === "" ? "/loans" : `/loans?${text}`;
  };

  const canCreate = canAccess(staff.role, "/loans/new");
  const newButton = canCreate ? (
    <Link href="/loans/new" className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}>
      {t("new")}
    </Link>
  ) : null;

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
            {LOAN_TABS.map((target) => (
              <Link
                key={target}
                href={href({ tab: target === "all" ? "" : target, page: "" })}
                aria-current={target === tab ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-control border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ease-out lg:min-h-10",
                  target === tab
                    ? "border-primary bg-primary text-white hover:text-white"
                    : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
                )}
              >
                {t(`tabs.${target}`)} <span className="tabular">{tabCounts.get(target)}</span>
              </Link>
            ))}
          </nav>
          {newButton}
        </div>

        <section
          aria-labelledby="loans-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <form
            method="get"
            action="/loans"
            role="search"
            aria-label={t("filters.label")}
            className="grid gap-4 border-b border-page p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
          >
            {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
            {filters.older !== "" ? <input type="hidden" name="older" value="1" /> : null}
            <Field id="loans-q" label={t("filters.q")} className="sm:col-span-2 lg:col-span-1">
              <input
                id="loans-q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder={t("filters.qPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field id="loans-branch" label={t("filters.branch")}>
              <select id="loans-branch" name="branch" defaultValue={filters.branch} className={inputClass}>
                <option value="">{t("filters.anyBranch")}</option>
                {branchesResult.data.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="loans-officer" label={t("filters.officer")}>
              <select id="loans-officer" name="officer" defaultValue={filters.officer} className={inputClass}>
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
            <div className="flex gap-2">
              <button type="submit" className={buttonVariants({ variant: "primary" })}>
                {t("filters.apply")}
              </button>
              <Link href="/loans" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
                {t("filters.clear")}
              </Link>
            </div>
          </form>

          <h2 id="loans-results" className="sr-only" aria-live="polite">
            {t("count", { count: total })}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <>
              <ul className="divide-y divide-page md:hidden">
                {rows.map((row) => {
                  const balance = balances.get(row.id);
                  const pill = loanPill({
                    status: row.status,
                    dueDate: row.due_date,
                    daysOverdue: balance?.days_overdue ?? 0,
                    totalOutCents: BigInt(balance?.total_out ?? 0),
                    closedOn: row.closed_on,
                    today,
                    pendingRole: pendingRoles.get(row.id) ?? null,
                  });
                  return (
                    <li key={row.id}>
                      <Link
                        href={`/loans/${row.id}`}
                        className="grid gap-1 px-4 py-3 text-ink hover:bg-page hover:text-ink"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{customerName(row.customers)}</span>
                          <StatusBadge tone={pill.tone}>
                            <LoanPillText pill={pill} />
                          </StatusBadge>
                        </span>
                        <span className="tabular text-sm text-ink-muted">
                          {row.loan_no} · {t("lent", { amount: formatMoney(row.principal_cents) })} ·{" "}
                          {t("owes", { amount: formatMoney(balance?.total_out ?? 0) })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <ScrollRegion label={t("tableLabel")} className="hidden md:block">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {(
                        ["loan", "customer", "branch", "officer", "lent", "due", "owes", "status"] as const
                      ).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className={cn(
                            "px-4 py-2.5 font-semibold",
                            ["lent", "owes"].includes(column) && "text-right",
                          )}
                        >
                          {t(`columns.${column}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const balance = balances.get(row.id);
                      const pill = loanPill({
                        status: row.status,
                        dueDate: row.due_date,
                        daysOverdue: balance?.days_overdue ?? 0,
                        totalOutCents: BigInt(balance?.total_out ?? 0),
                        closedOn: row.closed_on,
                        today,
                        pendingRole: pendingRoles.get(row.id) ?? null,
                      });
                      return (
                        <tr key={row.id} className="border-t border-page">
                          <td className="tabular px-4 py-3">
                            <Link href={`/loans/${row.id}`} className="font-semibold">
                              {row.loan_no}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{customerName(row.customers)}</td>
                          <td className="px-4 py-3">{branchNames.get(row.branch_id) ?? ""}</td>
                          <td className="px-4 py-3">
                            {row.officer_id === null ? "–" : (names.get(row.officer_id) ?? "")}
                          </td>
                          <td className="tabular px-4 py-3 text-right">{formatMoney(row.principal_cents)}</td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            {row.due_date === null ? t("notSet") : formatDate(row.due_date)}
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {formatMoney(balance?.total_out ?? 0)}
                          </td>
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
            </>
          )}
          <div className="flex flex-col gap-2 border-t border-page px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-ink-muted">
              {filters.older === ""
                ? t("windowed", { count: total, date: formatDate(yearStart) })
                : t("count", { count: total })}{" "}
              <Link
                href={href({ older: filters.older === "" ? "1" : "", page: "" })}
                className="font-semibold"
              >
                {filters.older === "" ? t("includeOlder") : t("hideOlder")}
              </Link>
            </p>
            <p className="tabular font-bold text-ink">
              {t("openTotal", { count: openCount, amount: formatMoney(openOwed) })}
            </p>
          </div>
          {pages > 1 ? (
            <nav
              aria-label={t("page", { page, pages })}
              className="flex items-center justify-between gap-2 border-t border-page px-4 py-3"
            >
              <p className="text-sm text-ink-muted">{t("page", { page, pages })}</p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link
                    href={href({ page: String(page - 1) })}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                  >
                    {t("previous")}
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link
                    href={href({ page: String(page + 1) })}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "hover:text-ink")}
                  >
                    {t("next")}
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </>
  );
}
