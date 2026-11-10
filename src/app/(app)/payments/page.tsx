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
import { customerName, likePattern } from "@/lib/customers";
import { formatDate, formatMoney, shiftBusinessDate } from "@/lib/format";
import { canAccess, type Role } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { PAYMENT_METHODS } from "./schemas";
import { VoidRequest } from "./void-request";

/*
 * /payments (cashier, manager, accountant, CEO; SPEC 9): receipts with filters and the void request.
 * By default it lists the last 30 days (B-13 style window); "Include older" shows everything.
 */
const PAGE_SIZE = 25;
const WINDOW_DAYS = 30;
const VOID_ROLES: readonly Role[] = ["cashier", "manager", "accountant"];
const STATUSES = ["posted", "voided"] as const;
type Params = Awaited<PageProps<"/payments">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}
const uuid = /^[0-9a-f-]{36}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaymentsPage(props: PageProps<"/payments">) {
  const t = await getTranslations("payments");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <PaymentsContent {...props} />
    </Suspense>
  );
}

async function PaymentsContent({ searchParams }: PageProps<"/payments">) {
  const staff = await requirePageAccess("/payments");
  const [t, tMethods, params] = await Promise.all([
    getTranslations("payments"),
    getTranslations("payments.methods"),
    searchParams,
  ]);
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) throw new Error("Could not read the business date");

  const filters = {
    q: single(params.q).trim().slice(0, 100),
    method: (PAYMENT_METHODS as readonly string[]).includes(single(params.method))
      ? single(params.method)
      : "",
    status: (STATUSES as readonly string[]).includes(single(params.status)) ? single(params.status) : "",
    branch: uuid.test(single(params.branch)) ? single(params.branch) : "",
    from: isoDate.test(single(params.from)) ? single(params.from) : "",
    to: isoDate.test(single(params.to)) ? single(params.to) : "",
    older: single(params.older) === "1" ? "1" : "",
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);
  const windowStart = shiftBusinessDate(today, -WINDOW_DAYS);
  const from = filters.from !== "" ? filters.from : filters.older === "" ? windowStart : "";

  let customerIds: string[] | null = null;
  if (filters.q !== "") {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .ilike("search_text", likePattern(filters.q.toLowerCase()))
      .limit(200);
    customerIds = (data ?? []).map((row) => row.id);
  }
  let loanIds: string[] = [];
  if (filters.q !== "") {
    const { data } = await supabase
      .from("loans")
      .select("id")
      .ilike("loan_no", likePattern(filters.q.toUpperCase()))
      .limit(200);
    loanIds = (data ?? []).map((row) => row.id);
  }

  let query = supabase
    .from("payments")
    .select(
      "id, receipt_no, received_on, amount_cents, method, reference, status, collected_in_field, remittance_status, branch_id, received_by, loan_id, loans!inner(loan_no), customers!inner(type, first_name, last_name, business_name)",
      { count: "exact" },
    );
  if (from !== "") query = query.gte("received_on", from);
  if (filters.to !== "") query = query.lte("received_on", filters.to);
  if (filters.method !== "") query = query.eq("method", filters.method);
  if (filters.status !== "") query = query.eq("status", filters.status);
  if (filters.branch !== "") query = query.eq("branch_id", filters.branch);
  if (filters.q !== "") {
    const parts = [`receipt_no.ilike.${likePattern(filters.q.toUpperCase())}`];
    if ((customerIds ?? []).length > 0) parts.push(`customer_id.in.(${(customerIds ?? []).join(",")})`);
    if (loanIds.length > 0) parts.push(`loan_id.in.(${loanIds.join(",")})`);
    query = query.or(parts.join(","));
  }
  const [list, branchesResult, peopleResult] = await Promise.all([
    query
      .order("received_at", { ascending: false })
      .order("receipt_no", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("branches").select("id, name").order("code"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (list.error !== null || branchesResult.error !== null || peopleResult.error !== null) {
    throw new Error("Could not read payments");
  }
  const rows = list.data;
  const ids = rows.map((row) => row.id);
  const { data: pendingVoids } =
    ids.length === 0
      ? { data: [] }
      : await supabase
          .from("approval_requests")
          .select("entity_id")
          .eq("type", "payment_void")
          .eq("status", "pending")
          .in("entity_id", ids);
  const voidPending = new Set((pendingVoids ?? []).map((row) => row.entity_id));
  const branchNames = new Map(branchesResult.data.map((branch) => [branch.id, branch.name]));
  const names = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canVoid = VOID_ROLES.includes(staff.role);

  const href = (changes: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...changes }))
      if (value !== "") search.set(key, value);
    const text = search.toString();
    return text === "" ? "/payments" : `/payments?${text}`;
  };
  const statusOf = (row: (typeof rows)[number]): { tone: BadgeTone; text: string } => {
    if (row.status === "voided") return { tone: "overdue", text: t("status.voided") };
    if (voidPending.has(row.id)) return { tone: "pending", text: t("status.voidPending") };
    if (row.remittance_status === "pending") return { tone: "due", text: t("status.awaitingHandover") };
    return { tone: "active", text: t("status.posted") };
  };
  const voidable = (row: (typeof rows)[number]) =>
    canVoid && row.status === "posted" && !voidPending.has(row.id);
  const methodText = (row: (typeof rows)[number]) =>
    row.reference === null
      ? tMethods(row.method as "cash")
      : `${tMethods(row.method as "cash")} · ${row.reference}`;

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        {canAccess(staff.role, "/payments/new") ? (
          <div className="flex justify-end">
            <Link
              href="/payments/new"
              className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}
            >
              {t("new")}
            </Link>
          </div>
        ) : null}
        <section
          aria-labelledby="payments-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <form
            method="get"
            action="/payments"
            role="search"
            aria-label={t("filters.label")}
            className="grid gap-4 border-b border-page p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] lg:items-end"
          >
            {filters.older !== "" ? <input type="hidden" name="older" value="1" /> : null}
            <Field id="payments-q" label={t("filters.q")} className="sm:col-span-2 lg:col-span-1">
              <input
                id="payments-q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder={t("filters.qPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field id="payments-method" label={t("filters.method")}>
              <select id="payments-method" name="method" defaultValue={filters.method} className={inputClass}>
                <option value="">{t("filters.anyMethod")}</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {tMethods(method)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="payments-status" label={t("filters.status")}>
              <select id="payments-status" name="status" defaultValue={filters.status} className={inputClass}>
                <option value="">{t("filters.anyStatus")}</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="payments-branch" label={t("filters.branch")}>
              <select id="payments-branch" name="branch" defaultValue={filters.branch} className={inputClass}>
                <option value="">{t("filters.anyBranch")}</option>
                {branchesResult.data.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="payments-from" label={t("filters.from")}>
              <input
                id="payments-from"
                name="from"
                type="date"
                max={today}
                defaultValue={filters.from}
                className={inputClass}
              />
            </Field>
            <Field id="payments-to" label={t("filters.to")}>
              <input
                id="payments-to"
                name="to"
                type="date"
                max={today}
                defaultValue={filters.to}
                className={inputClass}
              />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className={buttonVariants({ variant: "primary" })}>
                {t("filters.apply")}
              </button>
              <Link href="/payments" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
                {t("filters.clear")}
              </Link>
            </div>
          </form>

          <h2 id="payments-results" className="sr-only" aria-live="polite">
            {t("count", { count: total })}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <>
              <ul className="divide-y divide-page md:hidden">
                {rows.map((row) => {
                  const status = statusOf(row);
                  return (
                    <li key={row.id} className="grid gap-2 px-4 py-3">
                      <Link href={`/receipts/${row.id}`} className="grid gap-1 text-ink hover:text-ink">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{customerName(row.customers)}</span>
                          <span className="tabular font-bold">{formatMoney(row.amount_cents)}</span>
                        </span>
                        <span className="tabular text-sm text-ink-muted">
                          {row.receipt_no} · {row.loans.loan_no} · {formatDate(row.received_on)}
                        </span>
                        <span className="flex items-center justify-between gap-3 text-sm text-ink-muted">
                          <span>{methodText(row)}</span>
                          <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                        </span>
                      </Link>
                      {voidable(row) ? <VoidRequest paymentId={row.id} receiptNo={row.receipt_no} /> : null}
                    </li>
                  );
                })}
              </ul>
              <ScrollRegion label={t("tableLabel")} className="hidden md:block">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {(
                        [
                          "receipt",
                          "date",
                          "customer",
                          "loan",
                          "method",
                          "amount",
                          "by",
                          "status",
                          "actions",
                        ] as const
                      ).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className={cn("px-4 py-2.5 font-semibold", column === "amount" && "text-right")}
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
                    {rows.map((row) => {
                      const status = statusOf(row);
                      return (
                        <tr key={row.id} className="border-t border-page align-top">
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            <Link href={`/receipts/${row.id}`} className="font-semibold">
                              {row.receipt_no}
                            </Link>
                          </td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            {formatDate(row.received_on)}
                          </td>
                          <td className="px-4 py-3">{customerName(row.customers)}</td>
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            <Link href={`/loans/${row.loan_id}`}>{row.loans.loan_no}</Link>
                          </td>
                          <td className="px-4 py-3">{methodText(row)}</td>
                          <td className="tabular px-4 py-3 text-right font-semibold">
                            {formatMoney(row.amount_cents)}
                          </td>
                          <td className="px-4 py-3">
                            {names.get(row.received_by) ?? ""}
                            <span className="block text-xs text-ink-muted">
                              {branchNames.get(row.branch_id) ?? ""}
                              {row.collected_in_field ? ` · ${t("field")}` : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {voidable(row) ? (
                              <VoidRequest paymentId={row.id} receiptNo={row.receipt_no} />
                            ) : null}
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
              {filters.from === "" && filters.older === ""
                ? t("windowed", { count: total, date: formatDate(windowStart) })
                : t("count", { count: total })}{" "}
              {filters.from === "" ? (
                <Link
                  href={href({ older: filters.older === "" ? "1" : "", page: "" })}
                  className="font-semibold"
                >
                  {filters.older === "" ? t("includeOlder") : t("hideOlder")}
                </Link>
              ) : null}
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
