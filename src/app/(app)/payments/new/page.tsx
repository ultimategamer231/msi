import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Field, inputClass } from "@/components/forms/fields";
import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName, likePattern } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { PaymentForm } from "./payment-form";

/*
 * /payments/new?loan= (cashier, manager; SPEC 9, mock-up 03): find the loan, then amount, method,
 * reference and today's date with the allocation preview; saving opens the receipt.
 */
const OPEN = ["active", "overdue", "recovery"];
const uuid = /^[0-9a-f-]{36}$/;
type Params = Awaited<PageProps<"/payments/new">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

export default async function NewPaymentPage(props: PageProps<"/payments/new">) {
  const t = await getTranslations("payments.receive");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <NewPaymentContent {...props} />
    </Suspense>
  );
}

async function NewPaymentContent({ searchParams }: PageProps<"/payments/new">) {
  const staff = await requirePageAccess("/payments/new");
  const [t, params] = await Promise.all([getTranslations("payments.receive"), searchParams]);
  const q = single(params.q).trim().slice(0, 100);
  const loanParam = uuid.test(single(params.loan)) ? single(params.loan) : "";
  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) throw new Error("Could not read the business date");

  // Search: open loans by loan number or customer (name, phone, code).
  let hits: { id: string; loanNo: string; name: string; owed: string; daysOverdue: number }[] = [];
  if (q.length >= 2) {
    const { data: customers } = await supabase
      .from("customers")
      .select("id")
      .ilike("search_text", likePattern(q.toLowerCase()))
      .limit(100);
    const ids = (customers ?? []).map((row) => row.id);
    const loanNo = `loan_no.ilike.${likePattern(q.toUpperCase())}`;
    const { data: loans, error } = await supabase
      .from("loans")
      .select("id, loan_no, customers!inner(type, first_name, last_name, business_name)")
      .in("status", OPEN)
      .or(ids.length > 0 ? `${loanNo},customer_id.in.(${ids.join(",")})` : loanNo)
      .order("loan_no")
      .limit(10);
    if (error !== null) throw new Error("Could not search loans");
    const { data: balances } =
      loans.length === 0
        ? { data: [] }
        : await supabase
            .from("loan_balances")
            .select("loan_id, total_out, days_overdue")
            .in(
              "loan_id",
              loans.map((loan) => loan.id),
            );
    const byLoan = new Map((balances ?? []).map((row) => [row.loan_id, row]));
    hits = loans.map((loan) => ({
      id: loan.id,
      loanNo: loan.loan_no,
      name: customerName(loan.customers),
      owed: String(byLoan.get(loan.id)?.total_out ?? 0),
      daysOverdue: byLoan.get(loan.id)?.days_overdue ?? 0,
    }));
  }

  // The chosen loan, its balance and the opening preview (nothing allocated yet).
  let chosen: {
    id: string;
    loanNo: string;
    name: string;
    status: string;
    daysOverdue: number;
  } | null = null;
  let initial = null;
  if (loanParam !== "") {
    const [{ data: loan }, { data: balance }, preview] = await Promise.all([
      supabase
        .from("loans")
        .select("id, loan_no, status, customers!inner(type, first_name, last_name, business_name)")
        .eq("id", loanParam)
        .maybeSingle(),
      supabase.from("loan_balances").select("days_overdue").eq("loan_id", loanParam).maybeSingle(),
      supabase.rpc("preview_payment", { p_loan_id: loanParam, p_amount_cents: 0 }),
    ]);
    if (loan !== null) {
      chosen = {
        id: loan.id,
        loanNo: loan.loan_no,
        name: customerName(loan.customers),
        status: loan.status,
        daysOverdue: balance?.days_overdue ?? 0,
      };
    }
    if (preview.error === null) {
      const data = preview.data as {
        owed: Record<"penalty" | "interest" | "principal" | "total", number>;
        after_cents: number;
      };
      initial = {
        ok: true as const,
        owed: {
          penalty: String(data.owed.penalty),
          interest: String(data.owed.interest),
          principal: String(data.owed.principal),
          total: String(data.owed.total),
        },
        allocation: { penalty: "0", interest: "0", principal: "0" },
        afterCents: String(data.after_cents),
        overpayment: false,
      };
    }
  }
  const open = chosen !== null && OPEN.includes(chosen.status);
  const status = (daysOverdue: number) =>
    daysOverdue > 0 ? t("daysOverdue", { count: daysOverdue }) : t("notOverdue");

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="mx-auto grid w-full max-w-xl animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6">
        <form
          method="get"
          action="/payments/new"
          role="search"
          aria-label={t("findLabel")}
          className="grid gap-2"
        >
          {loanParam !== "" ? <input type="hidden" name="loan" value={loanParam} /> : null}
          <Field id="payment-find" label={t("find")}>
            <div className="flex gap-2">
              <input
                id="payment-find"
                name="q"
                type="search"
                defaultValue={q}
                placeholder={t("findPlaceholder")}
                className={inputClass}
              />
              <button type="submit" className={buttonVariants({ variant: "secondary" })}>
                {t("search")}
              </button>
            </div>
          </Field>
        </form>

        {q.length >= 2 ? (
          <section aria-labelledby="payment-hits" className="rounded-card border border-line bg-surface">
            <h2 id="payment-hits" className="sr-only" aria-live="polite">
              {t("hits", { count: hits.length })}
            </h2>
            {hits.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">{t("noHits")}</p>
            ) : (
              <ul className="divide-y divide-page">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <Link
                      href={`/payments/new?loan=${hit.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-ink hover:bg-page hover:text-ink"
                    >
                      <span className="grid">
                        <span className="font-semibold">{hit.name}</span>
                        <span className="tabular text-sm text-ink-muted">
                          {hit.loanNo} · {status(hit.daysOverdue)}
                        </span>
                      </span>
                      <span className="tabular font-bold">{formatMoney(hit.owed)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {loanParam !== "" && chosen === null ? <Callout tone="warning">{t("loanMissing")}</Callout> : null}
        {chosen !== null ? (
          <section
            aria-labelledby="payment-loan"
            className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4"
          >
            <div className="grid">
              <h2 id="payment-loan" className="text-base font-bold text-ink">
                {chosen.name}
              </h2>
              <p className="tabular text-sm text-ink-muted">
                <Link href={`/loans/${chosen.id}`} className="underline">
                  {chosen.loanNo}
                </Link>{" "}
                · {status(chosen.daysOverdue)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-ink-muted">{t("owes")}</p>
              <p className="tabular text-xl font-bold text-ink">{formatMoney(initial?.owed.total ?? 0)}</p>
            </div>
          </section>
        ) : null}
        {chosen !== null && !open ? <Callout tone="warning">{t("notOpen")}</Callout> : null}
        {chosen !== null && open && initial !== null ? (
          <PaymentForm
            loanId={chosen.id}
            cancelHref={`/loans/${chosen.id}`}
            todayLabel={formatDate(today)}
            initial={initial}
          />
        ) : null}
        {loanParam === "" && q.length < 2 ? (
          <p className={cn("text-sm text-ink-muted")}>{t("start")}</p>
        ) : null}
      </div>
    </>
  );
}
