import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDate, formatMoney, parseBusinessDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import messages from "../../../../messages/en.json";

/*
 * /ledger (accountant, manager, CEO, admin): journals with their lines, and the trial balance
 * (SPEC 9, 10.2; FR-21). Read-only: journals are written only by post_journal.
 */
const PAGE_SIZE = 25;
type Params = Awaited<PageProps<"/ledger">["searchParams"]>;

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

function linkClass(active: boolean) {
  return cn(
    "rounded-control inline-flex min-h-11 items-center border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ease-out lg:min-h-10",
    active
      ? "bg-primary border-primary text-white hover:text-white"
      : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
  );
}

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const t = await getTranslations("ledger");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <LedgerContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LedgerContent({ searchParams }: { searchParams: PageProps<"/ledger">["searchParams"] }) {
  const staff = await requirePageAccess("/ledger");
  const [t, params] = await Promise.all([getTranslations("ledger"), searchParams]);
  const tab = single(params.tab) === "trial" ? "trial" : "journals";

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <p className="max-w-[70ch] text-sm leading-6 text-ink-muted">{t("intro")}</p>
        <nav aria-label={t("tabs.label")}>
          <ul className="flex gap-2">
            <li>
              <Link
                href="/ledger"
                aria-current={tab === "journals" ? "page" : undefined}
                className={linkClass(tab === "journals")}
              >
                {t("tabs.journals")}
              </Link>
            </li>
            <li>
              <Link
                href="/ledger?tab=trial"
                aria-current={tab === "trial" ? "page" : undefined}
                className={linkClass(tab === "trial")}
              >
                {t("tabs.trial")}
              </Link>
            </li>
          </ul>
        </nav>
        {tab === "trial" ? <TrialBalance params={params} /> : <Journals params={params} />}
      </div>
    </>
  );
}

async function Journals({ params }: { params: Params }) {
  const t = await getTranslations("ledger");
  const supabase = await createSupabaseServerClient();
  const filters = {
    from: validDate(single(params.from)),
    to: validDate(single(params.to)),
    branch: /^[0-9a-f-]{36}$/.test(single(params.branch)) ? single(params.branch) : "",
  };
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  let query = supabase
    .from("journals")
    .select("id, journal_no, entry_date, memo, source_type, branch_id, reversal_of, posted_by", {
      count: "exact",
    })
    .order("chain_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (filters.from !== "") query = query.gte("entry_date", filters.from);
  if (filters.to !== "") query = query.lte("entry_date", filters.to);
  if (filters.branch !== "") query = query.eq("branch_id", filters.branch);

  const [{ data: journals, count, error }, { data: branches }, { data: people }] = await Promise.all([
    query,
    supabase.from("branches").select("id, code, name").order("code"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error !== null) throw new Error("Could not read journals");

  const ids = journals.map((journal) => journal.id);
  const { data: lines, error: linesError } =
    ids.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("journal_lines")
          .select("journal_id, line_no, debit_cents, credit_cents, component, account:accounts(code, name)")
          .in("journal_id", ids)
          .order("line_no");
  if (linesError !== null) throw new Error("Could not read journal lines");

  const branchCode = new Map((branches ?? []).map((branch) => [branch.id, branch.code]));
  const names = new Map((people ?? []).map((person) => [person.id, person.full_name]));
  const linesByJournal = new Map<string, typeof lines>();
  for (const line of lines)
    linesByJournal.set(line.journal_id, [...(linesByJournal.get(line.journal_id) ?? []), line]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "") search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const text = search.toString();
    return text === "" ? "/ledger" : `/ledger?${text}`;
  };

  return (
    <>
      <form
        method="get"
        action="/ledger"
        aria-label={t("filters.label")}
        className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1.5fr_auto] lg:items-end"
      >
        <Field id="ledger-from" label={t("filters.from")}>
          <input
            id="ledger-from"
            name="from"
            type="date"
            defaultValue={filters.from}
            className={inputClass}
          />
        </Field>
        <Field id="ledger-to" label={t("filters.to")}>
          <input id="ledger-to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
        </Field>
        <Field id="ledger-branch" label={t("filters.branch")}>
          <select id="ledger-branch" name="branch" defaultValue={filters.branch} className={inputClass}>
            <option value="">{t("filters.anyBranch")}</option>
            {(branches ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} · {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <button type="submit" className={buttonVariants({ variant: "primary" })}>
            {t("filters.apply")}
          </button>
          <Link href="/ledger" className={cn(buttonVariants({ variant: "ghost" }), "hover:text-ink")}>
            {t("filters.clear")}
          </Link>
        </div>
      </form>

      <section
        aria-labelledby="journal-results"
        className="min-w-0 rounded-card border border-line bg-surface"
      >
        <h2 id="journal-results" className="px-4 pt-4 text-sm font-semibold text-ink-muted">
          {t("count", { count: total })}
        </h2>
        {journals.length === 0 ? (
          <p className="mx-auto max-w-[60ch] px-4 py-10 text-center text-sm leading-6 text-ink-muted">
            {t("empty")}
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-page">
            {journals.map((journal) => {
              const journalLines = linesByJournal.get(journal.id) ?? [];
              const amount = journalLines.reduce((sum, line) => sum + BigInt(line.debit_cents), 0n);
              return (
                <li key={journal.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr_auto] sm:gap-4">
                  <p className="tabular text-sm text-ink-muted">{formatDate(journal.entry_date)}</p>
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      <span className="font-semibold">{journal.journal_no}</span>
                      <span className="text-ink-muted"> · {journal.memo}</span>
                      {journal.reversal_of !== null ? (
                        <span className="ml-2 inline-block rounded-badge bg-status-pending-bg px-2 py-0.5 text-xs font-semibold text-status-pending-fg">
                          {t("reversal")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {journal.source_type}
                      {journal.branch_id !== null
                        ? ` · ${branchCode.get(journal.branch_id) ?? ""}`
                        : ""} ·{" "}
                      {t("postedBy", {
                        name: journal.posted_by === null ? t("system") : (names.get(journal.posted_by) ?? ""),
                      })}
                    </p>
                    <details className="mt-1.5">
                      <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs font-semibold text-primary">
                        {t("showLines")}
                      </summary>
                      <ScrollRegion label={t("linesOf", { journal: journal.journal_no })} className="mt-2">
                        <table className="w-full min-w-[420px] border-collapse text-xs">
                          <thead className="bg-subtle text-left text-ink-muted">
                            <tr>
                              <th scope="col" className="px-2 py-1.5 font-semibold">
                                {t("lines.account")}
                              </th>
                              <th scope="col" className="px-2 py-1.5 font-semibold">
                                {t("lines.detail")}
                              </th>
                              <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                                {t("lines.debit")}
                              </th>
                              <th scope="col" className="px-2 py-1.5 text-right font-semibold">
                                {t("lines.credit")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {journalLines.map((line) => (
                              <tr key={line.line_no} className="border-t border-page">
                                <td className="px-2 py-1.5 text-ink">
                                  <span className="font-medium">{line.account?.code}</span>{" "}
                                  {line.account?.name}
                                </td>
                                <td className="px-2 py-1.5 text-ink-muted">
                                  {line.component !== null && line.component in messages.ledger.components
                                    ? t(
                                        `components.${line.component as keyof typeof messages.ledger.components}`,
                                      )
                                    : ""}
                                </td>
                                <td className="tabular px-2 py-1.5 text-right text-ink">
                                  {line.debit_cents > 0 ? formatMoney(line.debit_cents) : ""}
                                </td>
                                <td className="tabular px-2 py-1.5 text-right text-ink">
                                  {line.credit_cents > 0 ? formatMoney(line.credit_cents) : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollRegion>
                    </details>
                  </div>
                  <p className="tabular text-sm font-semibold text-ink sm:text-right">
                    <span className="sr-only">{t("total")} </span>
                    {formatMoney(amount)}
                  </p>
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
    </>
  );
}

async function TrialBalance({ params }: { params: Params }) {
  const t = await getTranslations("ledger");
  const supabase = await createSupabaseServerClient();
  let asOf = validDate(single(params.asof));
  if (asOf === "") {
    const { data: today, error } = await supabase.rpc("business_today");
    if (error !== null) throw new Error("Could not read the business date");
    asOf = today;
  }
  const { data: rows, error } = await supabase.rpc("trial_balance", { p_as_of: asOf });
  if (error !== null) throw new Error("Could not read the trial balance");

  const debit = rows.reduce((sum, row) => sum + BigInt(row.debit_cents), 0n);
  const credit = rows.reduce((sum, row) => sum + BigInt(row.credit_cents), 0n);
  const difference = debit > credit ? debit - credit : credit - debit;

  return (
    <>
      <form
        method="get"
        action="/ledger"
        className="flex flex-wrap items-end gap-4 rounded-card border border-line bg-surface p-4"
      >
        <input type="hidden" name="tab" value="trial" />
        <Field id="trial-asof" label={t("trial.asOf")}>
          <input
            id="trial-asof"
            name="asof"
            type="date"
            defaultValue={asOf}
            className={`${inputClass} max-w-56`}
          />
        </Field>
        <button type="submit" className={buttonVariants({ variant: "primary" })}>
          {t("trial.show")}
        </button>
      </form>

      <section aria-labelledby="trial-heading" className="min-w-0 rounded-card border border-line bg-surface">
        <h2 id="trial-heading" className="px-4 pt-4 text-base font-bold text-ink">
          {t("trial.heading", { date: formatDate(asOf) })}
        </h2>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("trial.empty")}</p>
        ) : (
          <>
            <div className="px-4 pt-3">
              {difference === 0n ? (
                <p
                  role="status"
                  className="rounded-control bg-status-active-bg px-3 py-2 text-sm font-medium text-status-active-fg"
                >
                  {t("trial.balanced")}
                </p>
              ) : (
                <Callout tone="warning" role="alert">
                  {t("trial.unbalanced", { difference: formatMoney(difference) })}
                </Callout>
              )}
            </div>
            <ScrollRegion label={t("trial.heading", { date: formatDate(asOf) })} className="mt-3">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead className="bg-subtle text-left text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("trial.code")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("trial.account")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("trial.type")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      {t("trial.debit")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                      {t("trial.credit")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.account_id} className="border-t border-page">
                      <td className="px-4 py-2.5 font-medium text-ink">{row.code}</td>
                      <td className="px-4 py-2.5 text-ink">{row.name}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{t(`types.${row.type}`)}</td>
                      <td className="tabular px-4 py-2.5 text-right text-ink">
                        {formatMoney(row.debit_cents)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink">
                        {formatMoney(row.credit_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <th scope="row" colSpan={3} className="px-4 py-3 text-left text-ink">
                      {t("trial.totals")}
                    </th>
                    <td className="tabular px-4 py-3 text-right text-ink">{formatMoney(debit)}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">{formatMoney(credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </ScrollRegion>
          </>
        )}
      </section>
    </>
  );
}
