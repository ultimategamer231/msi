import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { CUSTOMER_STATUS_TONE, StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName, likePattern } from "@/lib/customers";
import { formatDate, businessDateOf } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { CUSTOMER_STATUSES } from "./schemas";

/*
 * /customers (all staff; SPEC 9): search by name, phone, ID or code; filter by status, branch and
 * officer; 25 per page. The outstanding column arrives with loans (M3).
 */
const PAGE_SIZE = 25;
type Params = Awaited<PageProps<"/customers">["searchParams"]>;

function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

const uuid = /^[0-9a-f-]{36}$/;

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const t = await getTranslations("customers");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <CustomersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CustomersContent({ searchParams }: { searchParams: PageProps<"/customers">["searchParams"] }) {
  const staff = await requirePageAccess("/customers");
  const [t, params] = await Promise.all([getTranslations("customers"), searchParams]);

  const filters = {
    q: single(params.q).trim().slice(0, 100),
    status: (CUSTOMER_STATUSES as readonly string[]).includes(single(params.status))
      ? single(params.status)
      : "",
    branch: uuid.test(single(params.branch)) ? single(params.branch) : "",
    officer: uuid.test(single(params.officer)) ? single(params.officer) : "",
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);
  const created = /^CU-\d{6}$/.test(single(params.created)) ? single(params.created) : "";

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("customers")
    .select(
      "id, code, type, first_name, last_name, business_name, phone, id_number, status, created_at, branch_id, assigned_officer_id",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("code", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.q !== "") query = query.ilike("search_text", likePattern(filters.q.toLowerCase()));
  if (filters.status !== "") query = query.eq("status", filters.status);
  if (filters.branch !== "") query = query.eq("branch_id", filters.branch);
  if (filters.officer !== "") query = query.eq("assigned_officer_id", filters.officer);

  const [
    { data: rows, count, error },
    { data: branches, error: branchError },
    { data: officers, error: officerError },
  ] = await Promise.all([
    query,
    supabase.from("branches").select("id, code, name").order("code"),
    supabase.from("profiles").select("id, full_name, role").order("full_name"),
  ]);
  if (error !== null || branchError !== null || officerError !== null)
    throw new Error("Could not read customers");

  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
  const names = new Map(officers.map((person) => [person.id, person.full_name]));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Object.values(filters).some((value) => value !== "");

  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "") search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text === "" ? "/customers" : `/customers?${text}`;
  };

  const canCreate = canAccess(staff.role, "/customers/new");
  const newButton = canCreate ? (
    <Link href="/customers/new" className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}>
      {t("new")}
    </Link>
  ) : null;

  return (
    <>
      <TopBar
        title={t("title")}
        staff={staff}
        actions={<span className="hidden lg:inline-flex">{newButton}</span>}
      />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        {created !== "" ? <Callout>{t("created", { code: created })}</Callout> : null}
        {canCreate ? <div className="lg:hidden">{newButton}</div> : null}

        <form
          method="get"
          action="/customers"
          role="search"
          aria-label={t("filters.label")}
          className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.3fr_auto] lg:items-end"
        >
          <Field id="customers-q" label={t("filters.q")} className="sm:col-span-2 lg:col-span-1">
            <input
              id="customers-q"
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder={t("filters.qPlaceholder")}
              className={inputClass}
            />
          </Field>
          <Field id="customers-status" label={t("filters.status")}>
            <select id="customers-status" name="status" defaultValue={filters.status} className={inputClass}>
              <option value="">{t("filters.anyStatus")}</option>
              {CUSTOMER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="customers-branch" label={t("filters.branch")}>
            <select id="customers-branch" name="branch" defaultValue={filters.branch} className={inputClass}>
              <option value="">{t("filters.anyBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="customers-officer" label={t("filters.officer")}>
            <select
              id="customers-officer"
              name="officer"
              defaultValue={filters.officer}
              className={inputClass}
            >
              <option value="">{t("filters.anyOfficer")}</option>
              {officers
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
            <Link href="/customers" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
              {t("filters.clear")}
            </Link>
          </div>
        </form>

        <section
          aria-labelledby="customers-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <h2
            id="customers-results"
            className="px-4 pt-4 text-sm font-semibold text-ink-muted"
            aria-live="polite"
          >
            {t("count", { count: total })}
          </h2>
          {rows.length === 0 ? (
            <div className="grid justify-items-center gap-3 px-4 py-10 text-center">
              <p className="text-sm text-ink-muted">{filtered ? t("emptyFiltered") : t("empty")}</p>
              {!filtered && canCreate ? newButton : null}
            </div>
          ) : (
            <>
              {/* Phones: one card per customer. */}
              <ul className="mt-2 divide-y divide-page md:hidden">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/customers/${row.id}`}
                      className="grid gap-1 px-4 py-3 text-ink hover:bg-page hover:text-ink"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-semibold">{customerName(row)}</span>
                        <StatusBadge tone={CUSTOMER_STATUS_TONE[row.status] ?? "pending"}>
                          {t(`status.${row.status as "active"}`)}
                        </StatusBadge>
                      </span>
                      <span className="tabular text-sm text-ink-muted">
                        {row.code} · {row.phone}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {branchNames.get(row.branch_id) ?? ""}
                        {row.assigned_officer_id !== null
                          ? ` · ${names.get(row.assigned_officer_id) ?? ""}`
                          : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Tablets and desktop: table. */}
              <ScrollRegion label={t("tableLabel")} className="mt-2 hidden md:block">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.customer")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.phone")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.idNumber")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.branch")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.officer")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.registered")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("columns.status")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-page">
                        <td className="px-4 py-3">
                          <Link href={`/customers/${row.id}`} className="font-semibold">
                            {customerName(row)}
                          </Link>
                          <span className="tabular block text-xs text-ink-muted">
                            {row.code} · {t(`types.${row.type as "individual"}`)}
                          </span>
                        </td>
                        <td className="tabular px-4 py-3 whitespace-nowrap">{row.phone}</td>
                        <td className="px-4 py-3">{row.id_number ?? "–"}</td>
                        <td className="px-4 py-3">{branchNames.get(row.branch_id) ?? ""}</td>
                        <td className="px-4 py-3">
                          {row.assigned_officer_id === null
                            ? "–"
                            : (names.get(row.assigned_officer_id) ?? "")}
                        </td>
                        <td className="tabular px-4 py-3 whitespace-nowrap">
                          {formatDate(businessDateOf(row.created_at))}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={CUSTOMER_STATUS_TONE[row.status] ?? "pending"}>
                            {t(`status.${row.status as "active"}`)}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </>
          )}
          {pages > 1 ? (
            <nav
              aria-label={t("page", { page, pages })}
              className="flex items-center justify-between gap-2 border-t border-page px-4 py-3"
            >
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
        </section>
      </div>
    </>
  );
}
