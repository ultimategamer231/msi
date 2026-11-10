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
import { formatDate, formatMoney, shiftBusinessDate } from "@/lib/format";
import { canAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { COLLATERAL_TYPES } from "../loans/schemas";

/*
 * /collateral (all staff; SPEC 9, 5.9, mock-up 09): the register with tabs (held, in recovery, ready
 * to return, released), search over code, description, identifiers, owner and loan number, and a
 * type filter. Items held now plus items released in the last 30 days by default (B-13).
 */
const TABS = ["all", "held", "in_recovery", "to_return", "released"] as const;
type Tab = (typeof TABS)[number];
const RELEASED_WINDOW_DAYS = 30;
const ENDED = ["closed", "written_off", "cancelled", "rejected"];
type Params = Awaited<PageProps<"/collateral">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

export default async function CollateralPage(props: PageProps<"/collateral">) {
  const t = await getTranslations("collateral");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <CollateralContent {...props} />
    </Suspense>
  );
}

async function CollateralContent({ searchParams }: PageProps<"/collateral">) {
  const staff = await requirePageAccess("/collateral");
  const [t, tTypes, params] = await Promise.all([
    getTranslations("collateral"),
    getTranslations("loans.wizard.types"),
    searchParams,
  ]);
  const tab: Tab = (TABS as readonly string[]).includes(single(params.tab))
    ? (single(params.tab) as Tab)
    : "all";
  const filters = {
    q: single(params.q).trim().slice(0, 100),
    type: (COLLATERAL_TYPES as readonly string[]).includes(single(params.type)) ? single(params.type) : "",
    older: single(params.older) === "1" ? "1" : "",
  };
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) throw new Error("Could not read the business date");
  const windowStart = shiftBusinessDate(today, -RELEASED_WINDOW_DAYS);

  const [itemsResult, pledgesResult, releasesResult] = await Promise.all([
    supabase
      .from("collaterals")
      .select(
        "id, code, type, description, serial_no, plate_no, chassis_no, document_no, estimated_value_cents, location_note, status, owner_customer_id, customers!inner(type, first_name, last_name, business_name)",
      )
      .order("code", { ascending: false }),
    supabase
      .from("loan_collaterals")
      .select("collateral_id, status, released_on, loans!inner(id, loan_no, status)"),
    supabase.from("collateral_events").select("collateral_id, at").eq("event_type", "released"),
  ]);
  if (itemsResult.error !== null || pledgesResult.error !== null || releasesResult.error !== null) {
    throw new Error("Could not read the collateral register");
  }
  const releasedAt = new Map(releasesResult.data.map((row) => [row.collateral_id, row.at.slice(0, 10)]));
  const pledges = new Map<string, (typeof pledgesResult.data)[number][]>();
  for (const pledge of pledgesResult.data) {
    pledges.set(pledge.collateral_id, [...(pledges.get(pledge.collateral_id) ?? []), pledge]);
  }
  const activeLoan = (id: string) =>
    (pledges.get(id) ?? []).find(
      (pledge) => ["pledged", "seized"].includes(pledge.status) && !ENDED.includes(pledge.loans.status),
    )?.loans ?? null;
  const readyToReturn = (item: (typeof itemsResult.data)[number]) =>
    item.status === "held" && activeLoan(item.id) === null && (pledges.get(item.id) ?? []).length > 0;

  const query = filters.q.toLowerCase();
  const matches = (item: (typeof itemsResult.data)[number]) =>
    query === "" ||
    [
      item.code,
      item.description,
      item.serial_no,
      item.plate_no,
      item.chassis_no,
      item.document_no,
      customerName(item.customers),
      ...(pledges.get(item.id) ?? []).map((pledge) => pledge.loans.loan_no),
    ].some((value) => value !== null && value.toLowerCase().includes(query));
  const inWindow = (item: (typeof itemsResult.data)[number]) =>
    filters.older === "1" ||
    !["released", "sold", "lost"].includes(item.status) ||
    (releasedAt.get(item.id) ?? today) >= windowStart;
  const base = itemsResult.data.filter(
    (item) => matches(item) && (filters.type === "" || item.type === filters.type) && inWindow(item),
  );
  const inTab = (target: Tab, item: (typeof itemsResult.data)[number]) =>
    target === "all" ||
    (target === "held" && item.status === "held" && !readyToReturn(item)) ||
    (target === "in_recovery" && item.status === "in_recovery") ||
    (target === "to_return" && readyToReturn(item)) ||
    (target === "released" && ["released", "sold", "lost"].includes(item.status));
  const counts = new Map(TABS.map((target) => [target, base.filter((item) => inTab(target, item)).length]));
  const rows = base.filter((item) => inTab(tab, item));

  const identifier = (item: (typeof rows)[number]) =>
    item.serial_no !== null
      ? t("identifiers.serial", { value: item.serial_no })
      : item.plate_no !== null
        ? t("identifiers.plate", { value: item.plate_no })
        : item.chassis_no !== null
          ? t("identifiers.chassis", { value: item.chassis_no })
          : item.document_no !== null
            ? t("identifiers.document", { value: item.document_no })
            : t("identifiers.none");
  const status = (item: (typeof rows)[number]): { tone: BadgeTone; text: string } =>
    readyToReturn(item)
      ? { tone: "pending", text: t("status.to_return") }
      : item.status === "held"
        ? { tone: "active", text: t("status.held") }
        : item.status === "in_recovery"
          ? { tone: "recovery", text: t("status.in_recovery") }
          : { tone: "pending", text: t(`status.${item.status as "released"}`) };
  const location = (item: (typeof rows)[number]) =>
    item.status === "released" && releasedAt.has(item.id)
      ? t("returnedOn", { date: formatDate(releasedAt.get(item.id) ?? today) })
      : (item.location_note ?? "–");
  const loanCell = (item: (typeof rows)[number]) => {
    const loan = activeLoan(item.id);
    if (loan !== null)
      return (
        <Link href={`/loans/${loan.id}`} className="tabular">
          {loan.loan_no}
        </Link>
      );
    return (pledges.get(item.id) ?? []).length > 0 ? t("loanEnded") : t("noLoan");
  };
  const href = (changes: Record<string, string>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab: tab === "all" ? "" : tab, ...filters, ...changes }))
      if (value !== "") search.set(key, value);
    const text = search.toString();
    return text === "" ? "/collateral" : `/collateral?${text}`;
  };

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
                {t(`tabs.${target}`)} <span className="tabular">{counts.get(target)}</span>
              </Link>
            ))}
          </nav>
          {canAccess(staff.role, "/collateral/new") ? (
            <Link
              href="/collateral/new"
              className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}
            >
              {t("register")}
            </Link>
          ) : null}
        </div>

        <section
          aria-labelledby="collateral-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <form
            method="get"
            action="/collateral"
            role="search"
            aria-label={t("filters.label")}
            className="grid gap-4 border-b border-page p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          >
            {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
            {filters.older !== "" ? <input type="hidden" name="older" value="1" /> : null}
            <Field id="collateral-q" label={t("filters.q")}>
              <input
                id="collateral-q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder={t("filters.qPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field id="collateral-type" label={t("filters.type")}>
              <select id="collateral-type" name="type" defaultValue={filters.type} className={inputClass}>
                <option value="">{t("filters.anyType")}</option>
                {COLLATERAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tTypes(type)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <button type="submit" className={buttonVariants({ variant: "primary" })}>
                {t("filters.apply")}
              </button>
              <Link href="/collateral" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
                {t("filters.clear")}
              </Link>
            </div>
          </form>

          <h2 id="collateral-results" className="sr-only" aria-live="polite">
            {t("count", { count: rows.length })}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <>
              <ul className="divide-y divide-page md:hidden">
                {rows.map((item) => {
                  const badge = status(item);
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/collateral/${item.id}`}
                        className="grid gap-1 px-4 py-3 text-ink hover:bg-page hover:text-ink"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{item.description}</span>
                          <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>
                        </span>
                        <span className="tabular text-sm text-ink-muted">
                          {item.code} · {customerName(item.customers)} ·{" "}
                          {formatMoney(item.estimated_value_cents)}
                        </span>
                      </Link>
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
                          "item",
                          "description",
                          "identifier",
                          "owner",
                          "loan",
                          "location",
                          "value",
                          "status",
                        ] as const
                      ).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className={cn("px-4 py-2.5 font-semibold", column === "value" && "text-right")}
                        >
                          {t(`columns.${column}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => {
                      const badge = status(item);
                      return (
                        <tr key={item.id} className="border-t border-page">
                          <td className="tabular px-4 py-3 whitespace-nowrap">
                            <Link href={`/collateral/${item.id}`} className="font-semibold">
                              {item.code}
                            </Link>
                          </td>
                          <td className="px-4 py-3">{item.description}</td>
                          <td className="tabular px-4 py-3">{identifier(item)}</td>
                          <td className="px-4 py-3">{customerName(item.customers)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{loanCell(item)}</td>
                          <td className="px-4 py-3">{location(item)}</td>
                          <td className="tabular px-4 py-3 text-right">
                            {formatMoney(item.estimated_value_cents)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollRegion>
            </>
          )}
          <p className="border-t border-page px-4 py-3 text-sm text-ink-muted">
            {filters.older === "" ? t("windowed", { days: RELEASED_WINDOW_DAYS }) : t("allShown")}{" "}
            <Link href={href({ older: filters.older === "" ? "1" : "" })} className="font-semibold">
              {filters.older === "" ? t("includeOlder") : t("hideOlder")}
            </Link>
          </p>
        </section>
      </div>
    </>
  );
}
