import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { requirePageAccess } from "@/lib/auth/staff";
import {
  REPORT_FILTERS,
  REPORT_KEYS,
  buildReport,
  formatCell,
  reportParams,
  type ReportKey,
} from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/*
 * /reports/<report> (SPEC 10.2; mock-up 15): filters, summary cards, the reconciliation check (a red
 * banner when the books do not balance), tables, Export CSV and a print view.
 */
export default async function ReportPage(props: PageProps<"/reports/[...report]">) {
  const t = await getTranslations("reports");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ReportContent {...props} />
    </Suspense>
  );
}

async function ReportContent({ params, searchParams }: PageProps<"/reports/[...report]">) {
  const staff = await requirePageAccess("/reports/[...report]");
  const [{ report }, query, t] = await Promise.all([params, searchParams, getTranslations("reports")]);
  const key =
    report.length === 1 && (REPORT_KEYS as readonly string[]).includes(report[0] ?? "")
      ? (report[0] as ReportKey)
      : null;
  if (key === null) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: today }, { data: branches }] = await Promise.all([
    supabase.rpc("business_today"),
    supabase.from("branches").select("id, name").eq("active", true).order("code"),
  ]);
  const filters = REPORT_FILTERS[key];
  const values = reportParams(key, query, String(today));
  const model = await buildReport(key, values);
  const search = new URLSearchParams();
  if (filters.range) {
    search.set("from", values.from);
    search.set("to", values.to);
  }
  if (filters.asOf) search.set("asOf", values.asOf);
  if (filters.branch && values.branchId !== "") search.set("branch", values.branchId);
  const csvHref = `/api/reports/${key}?${search.toString()}`;

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <Link href="/reports" className="text-sm font-semibold print:hidden">
              ← {t("back")}
            </Link>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-2xl font-bold text-ink">{model.title}</h2>
              <span className="text-ink-muted">{model.subtitle}</span>
            </div>
          </div>
          <div className="flex gap-2 print:hidden">
            <a
              href={csvHref}
              className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}
              download
            >
              {t("exportCsv")}
            </a>
            <PrintButton label={t("print")} />
          </div>
        </div>

        <form
          method="get"
          action={`/reports/${key}`}
          aria-label={t("filters")}
          className="flex flex-wrap items-end gap-3 print:hidden"
        >
          {filters.range ? (
            <>
              <Field id="report-from" label={t("from")}>
                <input
                  id="report-from"
                  name="from"
                  type="date"
                  max={String(today)}
                  defaultValue={values.from}
                  className={inputClass}
                />
              </Field>
              <Field id="report-to" label={t("to")}>
                <input
                  id="report-to"
                  name="to"
                  type="date"
                  max={String(today)}
                  defaultValue={values.to}
                  className={inputClass}
                />
              </Field>
            </>
          ) : null}
          {filters.asOf ? (
            <Field id="report-as-of" label={t("asOf")}>
              <input
                id="report-as-of"
                name="asOf"
                type="date"
                max={String(today)}
                defaultValue={values.asOf}
                className={inputClass}
              />
            </Field>
          ) : null}
          {filters.branch ? (
            <Field id="report-branch" label={t("branch")}>
              <select id="report-branch" name="branch" defaultValue={values.branchId} className={inputClass}>
                <option value="">{t("allBranches")}</option>
                {(branches ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {filters.range || filters.asOf || filters.branch ? (
            <button type="submit" className={buttonVariants({ variant: "secondary" })}>
              {t("show")}
            </button>
          ) : null}
        </form>

        {model.check !== undefined ? (
          <p
            role={model.check.ok ? "status" : "alert"}
            className={cn(
              "rounded-control px-4 py-3 text-sm font-semibold",
              model.check.ok
                ? "bg-status-active-bg text-status-active-fg"
                : "bg-status-overdue-bg text-status-overdue-fg",
            )}
          >
            {model.check.ok ? "✓ " : "✗ "}
            {model.check.text}
          </p>
        ) : null}

        {model.cards.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {model.cards.map((card) => (
              <div key={card.label} className="rounded-card border border-line bg-surface p-4 sm:p-5">
                <p className="text-sm text-ink-muted">{card.label}</p>
                <p className="tabular mt-1 text-2xl font-bold text-ink">{card.value}</p>
                {card.note !== undefined ? (
                  <p className="mt-0.5 text-sm text-ink-muted">{card.note}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {model.sections.map((section) => {
          const right = (kind: string) => ["money", "int", "share"].includes(kind);
          return (
            <section
              key={section.id}
              aria-labelledby={`section-${section.id}`}
              className="min-w-0 rounded-card border border-line bg-surface"
            >
              <h3 id={`section-${section.id}`} className="p-4 text-base font-bold text-ink sm:px-6">
                {section.heading}
              </h3>
              {section.rows.length === 0 ? (
                <p className="px-4 pb-8 text-center text-sm text-ink-muted">{section.empty}</p>
              ) : (
                <ScrollRegion label={t("tableLabel", { heading: section.heading })}>
                  <table
                    className={cn(
                      "w-full border-collapse text-sm",
                      section.columns.length > 4 && "min-w-[760px]",
                    )}
                  >
                    <thead className="bg-subtle text-left text-xs text-ink-muted">
                      <tr>
                        {section.columns.map((column) => (
                          <th
                            key={column.key}
                            scope="col"
                            className={cn("px-4 py-2.5 font-semibold", right(column.kind) && "text-right")}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, index) => (
                        <tr key={index} className="border-t border-page">
                          {section.columns.map((column) => (
                            <td
                              key={column.key}
                              className={cn("px-4 py-3", right(column.kind) && "tabular text-right")}
                            >
                              {formatCell(column.kind, row[column.key] ?? null)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {section.total !== undefined ? (
                        <tr className="border-t border-line font-bold">
                          {section.columns.map((column) => (
                            <td
                              key={column.key}
                              className={cn("px-4 py-3", right(column.kind) && "tabular text-right")}
                            >
                              {formatCell(column.kind, section.total?.[column.key] ?? null)}
                            </td>
                          ))}
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </ScrollRegion>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
