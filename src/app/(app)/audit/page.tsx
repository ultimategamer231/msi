import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { auditChanges } from "@/lib/audit-diff";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDateTime, parseBusinessDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import messages from "../../../../messages/en.json";

/*
 * /audit (manager, CEO, admin): read-only view of the immutable audit log (FR-26, SPEC 9 and 11).
 * Filters narrow what is shown; nothing on this page can hide, change or delete an entry.
 */
const PAGE_SIZE = 25;
const ENTITY_TYPES = ["setting", "branch", "profile", "app_environment"] as const;

type Params = Awaited<PageProps<"/audit">["searchParams"]>;

function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

function validDate(value: string): string {
  if (value === "") return "";
  try {
    parseBusinessDate(value);
    return value;
  } catch {
    return "";
  }
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const t = await getTranslations("audit");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditContent({ searchParams }: { searchParams: PageProps<"/audit">["searchParams"] }) {
  const staff = await requirePageAccess("/audit");
  const [t, tRoles, params] = await Promise.all([
    getTranslations("audit"),
    getTranslations("roles"),
    searchParams,
  ]);

  const filters = {
    user: /^[0-9a-f-]{36}$/.test(single(params.user)) ? single(params.user) : "",
    entity: (ENTITY_TYPES as readonly string[]).includes(single(params.entity)) ? single(params.entity) : "",
    from: validDate(single(params.from)),
    to: validDate(single(params.to)),
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select("id, at, action, entity_type, entity_id, actor_id, actor_role, before, after", { count: "exact" })
    .order("chain_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.user !== "") query = query.eq("actor_id", filters.user);
  if (filters.entity !== "") query = query.eq("entity_type", filters.entity);
  // Business dates are in Africa/Monrovia (UTC+0), so a day runs from 00:00Z to 24:00Z.
  if (filters.from !== "") query = query.gte("at", `${filters.from}T00:00:00Z`);
  if (filters.to !== "") query = query.lt("at", `${filters.to}T24:00:00Z`);

  const [{ data: rows, count, error }, { data: people, error: peopleError }, { data: branches }] =
    await Promise.all([
      query,
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("branches").select("id, code"),
    ]);
  if (error !== null || peopleError !== null) throw new Error("Could not read the audit log");

  const names = new Map(people.map((person) => [person.id, person.full_name]));
  const branchCodes = new Map((branches ?? []).map((branch) => [branch.id, branch.code]));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Message keys cannot contain dots (next-intl nests on them), so "setting.updated" is "setting_updated".
  const actionLabel = (action: string) => {
    const key = action.replace(/\./g, "_");
    return key in messages.audit.actions
      ? t(`actions.${key as keyof typeof messages.audit.actions}`)
      : action;
  };
  const recordLabel = (type: string, id: string | null) => {
    const typeLabel =
      type in messages.audit.entities ? t(`entities.${type as keyof typeof messages.audit.entities}`) : type;
    if (id === null) return typeLabel;
    const name = type === "profile" ? names.get(id) : type === "branch" ? branchCodes.get(id) : id;
    return `${typeLabel}: ${name ?? id}`;
  };
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "") search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text === "" ? "/audit" : `/audit?${text}`;
  };

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <p className="max-w-[70ch] text-sm leading-6 text-ink-muted">{t("intro")}</p>

        <form
          method="get"
          action="/audit"
          aria-label={t("filters.label")}
          className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1fr_1fr_auto] lg:items-end"
        >
          <Field id="audit-user" label={t("filters.user")}>
            <select id="audit-user" name="user" defaultValue={filters.user} className={inputClass}>
              <option value="">{t("filters.anyUser")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="audit-entity" label={t("filters.entity")}>
            <select id="audit-entity" name="entity" defaultValue={filters.entity} className={inputClass}>
              <option value="">{t("filters.anyEntity")}</option>
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`entities.${type}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="audit-from" label={t("filters.from")}>
            <input
              id="audit-from"
              name="from"
              type="date"
              defaultValue={filters.from}
              className={inputClass}
            />
          </Field>
          <Field id="audit-to" label={t("filters.to")}>
            <input id="audit-to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonVariants({ variant: "primary" })}>
              {t("filters.apply")}
            </button>
            <Link href="/audit" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
              {t("filters.clear")}
            </Link>
          </div>
        </form>

        <section
          aria-labelledby="audit-results"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <h2
            id="audit-results"
            className="px-4 pt-4 text-sm font-semibold text-ink-muted"
            aria-live="polite"
          >
            {t("count", { count: total })}
          </h2>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <ol className="mt-2 divide-y divide-page">
              {rows.map((row) => {
                const changes = auditChanges(row.before, row.after);
                const who = row.actor_id === null ? t("system") : (names.get(row.actor_id) ?? row.actor_id);
                return (
                  <li key={row.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                    <p className="tabular text-sm text-ink-muted">{formatDateTime(row.at)}</p>
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        <span className="font-semibold">{actionLabel(row.action)}</span>
                        <span className="text-ink-muted">
                          {" "}
                          · {recordLabel(row.entity_type, row.entity_id)}
                        </span>
                      </p>
                      <p className="text-xs text-ink-muted">
                        {who}
                        {row.actor_role !== null ? ` · ${tRoles(row.actor_role)}` : ""}
                      </p>
                      <details className="mt-1.5">
                        <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-control text-xs font-semibold text-primary">
                          {t("showChanges")}
                        </summary>
                        {changes.length === 0 ? (
                          <p className="mt-2 text-xs text-ink-muted">{t("noChanges")}</p>
                        ) : (
                          <ScrollRegion
                            label={t("changesOf", { action: actionLabel(row.action) })}
                            className="mt-2"
                          >
                            <table className="w-full min-w-[420px] border-collapse text-xs">
                              <thead className="bg-subtle text-left text-ink-muted">
                                <tr>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("field")}
                                  </th>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("before")}
                                  </th>
                                  <th scope="col" className="px-2 py-1.5 font-semibold">
                                    {t("after")}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {changes.map((change) => (
                                  <tr key={change.field} className="border-t border-page align-top">
                                    <td className="px-2 py-1.5 font-medium text-ink">{change.field}</td>
                                    <td className="px-2 py-1.5 break-all text-ink-muted">
                                      {change.before === "" ? t("none") : change.before}
                                    </td>
                                    <td className="px-2 py-1.5 break-all text-ink">
                                      {change.after === "" ? t("none") : change.after}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </ScrollRegion>
                        )}
                      </details>
                    </div>
                  </li>
                );
              })}
            </ol>
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
