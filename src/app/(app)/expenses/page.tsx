import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { ExpenseForm, SettleForm } from "./expense-forms";

/*
 * /expenses (manager, accountant; SPEC 9, 7.6; FR-22): record an expense (paid now or on credit,
 * with a receipt), the list by status, and settlement of expenses taken on credit. Amounts above
 * approvals.expense_limit_cents wait in the approvals inbox; the database decides that.
 */
const TABS = ["all", "pending_approval", "approved", "paid", "rejected"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 25;
const TONES: Record<string, BadgeTone> = {
  pending_approval: "due",
  approved: "pending",
  paid: "active",
  rejected: "overdue",
};

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const t = await getTranslations("expenses");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ExpensesContent {...props} />
    </Suspense>
  );
}

async function ExpensesContent({ searchParams }: PageProps<"/expenses">) {
  const staff = await requirePageAccess("/expenses");
  const [t, params] = await Promise.all([getTranslations("expenses"), searchParams]);
  const tabParam = typeof params.tab === "string" ? params.tab : "";
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) ? (tabParam as Tab) : "all";
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const supabase = await createSupabaseServerClient();

  let list = supabase
    .from("expenses")
    .select(
      "id, expense_no, expense_date, description, amount_cents, status, paid_now, branch_id, payees(name), accounts!expenses_account_id_fkey(code, name), paid_from:accounts!expenses_paid_from_account_id_fkey(code)",
      { count: "exact" },
    )
    .order("expense_date", { ascending: false })
    .order("expense_no", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (tab !== "all") list = list.eq("status", tab);

  const [{ data: today }, listResult, accountsResult, branchesResult, payeesResult, limitResult] =
    await Promise.all([
      supabase.rpc("business_today"),
      list,
      supabase
        .from("accounts")
        .select("code, name, type, is_cash, branch_id")
        .eq("active", true)
        .order("code"),
      supabase.from("branches").select("id, name").eq("active", true).order("code"),
      supabase.from("payees").select("id, name").eq("active", true).order("name"),
      supabase.from("settings").select("value").eq("key", "approvals.expense_limit_cents").maybeSingle(),
    ]);
  if (listResult.error !== null || accountsResult.error !== null)
    throw new Error("Could not read the expenses");
  const accounts = accountsResult.data;
  const expenseAccounts = accounts
    .filter((account) => account.type === "expense" && account.code !== "5050")
    .map(({ code, name }) => ({ code, name }));
  const moneyAccounts = accounts
    .filter((account) => account.is_cash || ["1020", "1030"].includes(account.code))
    .map(({ code, name, branch_id }) => ({ code, name, branchId: branch_id }));
  const rows = listResult.data;
  const total = listResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (changes: { tab?: Tab; page?: number }) => {
    const search = new URLSearchParams();
    const nextTab = changes.tab ?? tab;
    if (nextTab !== "all") search.set("tab", nextTab);
    const nextPage = changes.page ?? 1;
    if (nextPage > 1) search.set("page", String(nextPage));
    const text = search.toString();
    return text === "" ? "/expenses" : `/expenses?${text}`;
  };
  const limit = formatMoney(String(limitResult.data?.value ?? 0));

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">{t("intro", { limit })}</p>
          <Link href="/payees" className="text-sm font-semibold underline">
            {t("payeesLink")}
          </Link>
        </div>
        <ExpenseForm
          today={String(today ?? "")}
          expenseAccounts={expenseAccounts}
          moneyAccounts={moneyAccounts}
          branches={branchesResult.data ?? []}
          payees={payeesResult.data ?? []}
          defaultBranch={staff.branch?.id ?? ""}
        />

        <section
          aria-labelledby="expense-list"
          className="min-w-0 rounded-card border border-line bg-surface"
        >
          <div className="grid gap-3 border-b border-page p-4">
            <h2 id="expense-list" className="text-base font-bold text-ink">
              {t("listHeading")}
            </h2>
            <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
              {TABS.map((target) => (
                <Link
                  key={target}
                  href={href({ tab: target })}
                  aria-current={target === tab ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-semibold whitespace-nowrap lg:min-h-10",
                    target === tab
                      ? "border-primary bg-primary text-white hover:text-white"
                      : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
                  )}
                >
                  {t(`tabs.${target}`)}
                </Link>
              ))}
            </nav>
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t(`empty.${tab}`)}</p>
          ) : (
            <ScrollRegion label={t("tableLabel")}>
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="bg-subtle text-left text-xs text-ink-muted">
                  <tr>
                    {(
                      [
                        "number",
                        "date",
                        "description",
                        "account",
                        "payee",
                        "paidFrom",
                        "amount",
                        "status",
                      ] as const
                    ).map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className={cn("px-4 py-2.5 font-semibold", column === "amount" && "text-right")}
                      >
                        {t(`columns.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-page align-top">
                      <td className="tabular px-4 py-3 font-semibold whitespace-nowrap">{row.expense_no}</td>
                      <td className="tabular px-4 py-3 whitespace-nowrap">{formatDate(row.expense_date)}</td>
                      <td className="px-4 py-3">{row.description}</td>
                      <td className="px-4 py-3">
                        {row.accounts.code} · {row.accounts.name}
                      </td>
                      <td className="px-4 py-3">{row.payees?.name ?? "–"}</td>
                      <td className="tabular px-4 py-3">
                        {row.paid_from?.code ?? (row.paid_now ? "–" : t("onCredit"))}
                      </td>
                      <td className="tabular px-4 py-3 text-right font-semibold">
                        {formatMoney(row.amount_cents)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid justify-items-start gap-2">
                          <StatusBadge tone={TONES[row.status] ?? "pending"}>
                            {t(`status.${row.status as "paid"}`)}
                          </StatusBadge>
                          {row.status === "approved" && !row.paid_now ? (
                            <SettleForm
                              expenseId={row.id}
                              expenseNo={row.expense_no}
                              accounts={moneyAccounts.filter(
                                (account) => account.branchId === null || account.branchId === row.branch_id,
                              )}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          {pages > 1 ? (
            <nav
              aria-label={t("pagination")}
              className="flex items-center justify-between gap-2 border-t border-page p-4 text-sm"
            >
              {page > 1 ? <Link href={href({ page: page - 1 })}>{t("previous")}</Link> : <span />}
              <span className="text-ink-muted">{t("page", { page, pages })}</span>
              {page < pages ? <Link href={href({ page: page + 1 })}>{t("next")}</Link> : <span />}
            </nav>
          ) : null}
        </section>
      </div>
    </>
  );
}
