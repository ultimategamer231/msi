import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { Callout } from "@/components/ui/callout";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { businessDateOf, formatDate, formatMoney, formatRateBps } from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { DecisionForm } from "../../approvals/decision-form";
import { LoanPillText } from "../loan-pill";

import { CancelLoanForm, DisburseForm, SubmitDraftButton } from "./loan-actions";

/*
 * /loans/[id] (all staff; SPEC 9, mock-up 07): summary, outstanding, details, activity from the
 * ledger, collateral, guarantors and the actions the user's role allows in this status. Payments,
 * extension, recovery and write-off actions join in M4–M6.
 */
export default async function LoanPage(props: PageProps<"/loans/[id]">) {
  const t = await getTranslations("loans.detail");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <LoanContent {...props} />
    </Suspense>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6", className)}>
      {children}
    </section>
  );
}

async function LoanContent({ params, searchParams }: PageProps<"/loans/[id]">) {
  const staff = await requirePageAccess("/loans/[id]");
  const [{ id }, query, t, tLoans] = await Promise.all([
    params,
    searchParams,
    getTranslations("loans.detail"),
    getTranslations("loans"),
  ]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [
    loanResult,
    balanceResult,
    activityResult,
    pledgesResult,
    guarantorsResult,
    requestResult,
    peopleResult,
    todayResult,
  ] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "*, customers!inner(id, code, type, first_name, last_name, business_name, phone), loan_products!inner(name), branches!inner(name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("loan_balances").select("*").eq("loan_id", id).maybeSingle(),
    supabase.rpc("loan_activity", { p_loan_id: id }),
    supabase
      .from("loan_collaterals")
      .select(
        "id, status, collaterals!inner(id, code, description, estimated_value_cents, location_note, status)",
      )
      .eq("loan_id", id),
    supabase
      .from("guarantors")
      .select("id, full_name, phone, relationship, doc_path")
      .eq("loan_id", id)
      .order("created_at"),
    supabase
      .from("approval_requests")
      .select("id, status, required_role, requested_by, requested_at, decided_by, decided_at, decision_note")
      .eq("entity_id", id)
      .eq("type", "loan_approval")
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("id, full_name"),
    supabase.rpc("business_today"),
  ]);
  if (
    loanResult.error !== null ||
    activityResult.error !== null ||
    pledgesResult.error !== null ||
    todayResult.error !== null
  ) {
    throw new Error("Could not read the loan");
  }
  const loan = loanResult.data;
  if (loan === null) notFound();
  const balance = balanceResult.data;
  const people = new Map((peopleResult.data ?? []).map((person) => [person.id, person.full_name]));
  const request = requestResult.data;
  const today = todayResult.data;
  const name = customerName(loan.customers);
  const owed = BigInt(balance?.total_out ?? 0);

  const pill = loanPill({
    status: loan.status,
    dueDate: loan.due_date,
    daysOverdue: balance?.days_overdue ?? 0,
    totalOutCents: owed,
    closedOn: loan.closed_on,
    today,
    pendingRole: request?.status === "pending" ? request.required_role : null,
  });

  // Signed links for guarantor ID scans (private storage, SPEC 6.4).
  const docPaths = (guarantorsResult.data ?? [])
    .map((guarantor) => guarantor.doc_path)
    .filter((path): path is string => path !== null);
  const signed = new Map<string, string>();
  if (docPaths.length > 0) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(docPaths, 600);
    for (const entry of urls ?? [])
      if (entry.path !== null && entry.signedUrl !== null) signed.set(entry.path, entry.signedUrl);
  }

  const isCreator = loan.created_by === staff.id;
  const decides = staff.role === "manager" || staff.role === "ceo";
  const canDecide =
    request?.status === "pending" &&
    decides &&
    !isCreator &&
    request.requested_by !== staff.id &&
    (request.required_role === "manager" || staff.role === "ceo");
  const canCancel =
    (loan.status === "draft" && isCreator) || (loan.status === "approved" && (isCreator || decides));
  const disbursed = loan.disbursed_on !== null;
  const interestCents = loan.interest_cents ?? 0;
  const penaltyCents = BigInt(balance?.penalty_out ?? 0);
  const activity = activityResult.data ?? [];
  const methodLabel =
    loan.disbursement_method === null ? "" : t(`methods.${loan.disbursement_method as "cash"}`);

  const activityText = (row: (typeof activity)[number]) => {
    if (row.source_type === "disbursement" && row.component === "principal")
      return t("activity.paidOut", { method: methodLabel.toLowerCase() });
    if (row.source_type === "disbursement" && row.component === "interest")
      return t("activity.interest", {
        rate: formatRateBps(loan.interest_rate_bps ?? 0),
        months: loan.term_months,
      });
    return t("activity.other", { component: row.component ?? "", source: row.source_type });
  };

  return (
    <>
      <TopBar title={t("title", { loan: loan.loan_no })} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="grid gap-3">
          <Link href="/loans" className="text-sm font-semibold">
            ← {tLoans("allLoans")}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="tabular text-2xl font-bold text-ink">{loan.loan_no}</h2>
            <Link href={`/customers/${loan.customers.id}`} className="text-lg text-ink-muted">
              {name}
            </Link>
            <StatusBadge tone={pill.tone}>
              <LoanPillText pill={pill} />
            </StatusBadge>
          </div>
        </div>

        {query.submitted === "1" ? <Callout>{t("submittedNotice")}</Callout> : null}
        {query.saved === "1" && loan.status === "draft" ? <Callout>{t("savedNotice")}</Callout> : null}
        {loan.status === "pending_approval" && request?.status === "pending" ? (
          <Callout>
            {t(request.required_role === "ceo" ? "waitingCeo" : "waitingManager", {
              name: people.get(request.requested_by) ?? "",
              date: formatDate(businessDateOf(request.requested_at)),
            })}
          </Callout>
        ) : null}
        {loan.status === "rejected" && request !== null ? (
          <Callout tone="warning">
            {t("rejectedNotice", {
              name: people.get(request.decided_by ?? "") ?? "",
              note: request.decision_note ?? "",
            })}
          </Callout>
        ) : null}

        {/* Actions allowed for this role and status (SPEC 9). */}
        {loan.status === "draft" && isCreator ? <SubmitDraftButton loanId={loan.id} /> : null}
        {canDecide && request !== null ? (
          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">{t("decideHeading")}</h3>
            <DecisionForm requestId={request.id} title={`${name}, ${loan.loan_no}`} />
          </Card>
        ) : null}
        {loan.status === "approved" && staff.role === "cashier" ? (
          <DisburseForm
            loanId={loan.id}
            amount={formatMoney(loan.principal_cents)}
            cashAccount={t("cashAccount", { branch: staff.branch?.name ?? "" })}
          />
        ) : null}
        {loan.status === "approved" && staff.role !== "cashier" ? (
          <Callout>{t("approvedNotice")}</Callout>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <p className="text-sm text-ink-muted">{t("cards.lent")}</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(loan.principal_cents)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {disbursed
                ? t("cards.paidOut", { method: methodLabel, date: formatDate(loan.disbursed_on ?? today) })
                : t("cards.notPaidOut")}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-ink-muted">{t("cards.interest")}</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(interestCents)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {loan.interest_rate_bps === null
                ? t("cards.interestLater")
                : t("cards.interestRule", {
                    rate: formatRateBps(loan.interest_rate_bps),
                    months: loan.term_months,
                  })}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-ink-muted">{t("cards.penalties")}</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(penaltyCents)}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {penaltyCents === 0n
                ? t("cards.noPenalties")
                : t("cards.penaltyRule", { max: loan.penalty_max_periods ?? 0 })}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-ink-muted">{t("cards.paid")}</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(0)}</p>
            <p className="mt-1 text-sm text-ink-muted">{t("cards.noPayments")}</p>
          </Card>
        </div>

        {disbursed ? (
          <section
            aria-labelledby="outstanding-heading"
            className={cn(
              "rounded-card border p-4 sm:p-6",
              owed > 0n && (balance?.days_overdue ?? 0) > 0
                ? "border-warning-border bg-warning-bg text-status-overdue-fg"
                : "border-line bg-surface",
            )}
          >
            <h3 id="outstanding-heading" className="text-sm font-semibold">
              {t("outstanding")}
            </h3>
            <p className="tabular mt-1 text-3xl font-bold">{formatMoney(owed)}</p>
            <p className="tabular mt-1 text-sm">
              {t("components", {
                principal: formatMoney(balance?.principal_out ?? 0),
                interest: formatMoney(balance?.interest_out ?? 0),
                penalty: formatMoney(balance?.penalty_out ?? 0),
              })}
            </p>
          </section>
        ) : null}

        <Card>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
            {(
              [
                ["disbursed", loan.disbursed_on === null ? t("notYet") : formatDate(loan.disbursed_on)],
                ["due", loan.due_date === null ? tLoans("notSet") : formatDate(loan.due_date)],
                ["daysOverdue", String(balance?.days_overdue ?? 0)],
                ["officer", loan.officer_id === null ? t("none") : (people.get(loan.officer_id) ?? "")],
                ["branch", loan.branches.name],
                ["product", loan.loan_products.name],
                ["term", tLoans("wizard.months", { count: loan.term_months })],
                ["purpose", loan.purpose ?? t("none")],
                [
                  "approvedBy",
                  loan.approved_by === null
                    ? t("notYet")
                    : `${people.get(loan.approved_by) ?? ""}, ${formatDate(businessDateOf(loan.approved_at ?? today))}`,
                ],
                ["createdBy", people.get(loan.created_by) ?? ""],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-xs font-medium text-ink-muted">{t(`fields.${key}`)}</dt>
                <dd className="mt-0.5 font-semibold break-words text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
          <section
            aria-labelledby="activity-heading"
            className="min-w-0 rounded-card border border-line bg-surface"
          >
            <h3 id="activity-heading" className="px-4 pt-4 text-base font-bold text-ink sm:px-6 sm:pt-6">
              {t("activity.heading")}
            </h3>
            {activity.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted sm:px-6">{t("activity.empty")}</p>
            ) : (
              <ScrollRegion label={t("activity.table")} className="mt-3">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("activity.date")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("activity.event")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {t("activity.by")}
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                        {t("activity.amount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...activity].reverse().map((row) => (
                      <tr key={`${row.journal_id}-${row.component}`} className="border-t border-page">
                        <td className="tabular px-4 py-3 whitespace-nowrap">{formatDate(row.entry_date)}</td>
                        <td className="px-4 py-3">{activityText(row)}</td>
                        <td className="px-4 py-3">
                          {row.source_type === "disbursement" && row.component === "interest"
                            ? t("activity.system")
                            : (people.get(row.posted_by) ?? "")}
                        </td>
                        <td className="tabular px-4 py-3 text-right">
                          {BigInt(row.amount_cents) > 0n ? "+" : ""}
                          {formatMoney(row.amount_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
            <p className="px-4 py-4 text-xs leading-5 text-ink-muted sm:px-6">{t("activity.note")}</p>
          </section>

          <div className="grid min-w-0 gap-4 lg:gap-5">
            <Card>
              <h3 className="text-base font-bold text-ink">{t("collateral.heading")}</h3>
              {(pledgesResult.data ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">{t("collateral.none")}</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {(pledgesResult.data ?? []).map((pledge) => (
                    <li key={pledge.id} className="grid gap-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-ink">{pledge.collaterals.description}</p>
                        <StatusBadge tone={pledge.collaterals.status === "held" ? "active" : "pending"}>
                          {t(`collateral.status.${pledge.collaterals.status as "held"}`)}
                        </StatusBadge>
                      </div>
                      <p className="text-sm text-ink-muted">
                        {pledge.collaterals.code}
                        {pledge.collaterals.location_note !== null
                          ? ` · ${pledge.collaterals.location_note}`
                          : ""}
                      </p>
                      <p className="text-sm text-ink">
                        {t.rich("collateral.value", {
                          value: formatMoney(pledge.collaterals.estimated_value_cents),
                          owed: formatMoney(owed > 0n ? owed : loan.principal_cents + interestCents),
                          strong: (chunks) => <strong>{chunks}</strong>,
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h3 className="text-base font-bold text-ink">{t("guarantors.heading")}</h3>
              {(guarantorsResult.data ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">{t("guarantors.none")}</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {(guarantorsResult.data ?? []).map((guarantor) => {
                    const url = guarantor.doc_path === null ? undefined : signed.get(guarantor.doc_path);
                    return (
                      <li key={guarantor.id}>
                        <p className="font-semibold text-ink">
                          {guarantor.relationship === null
                            ? guarantor.full_name
                            : `${guarantor.full_name} (${guarantor.relationship})`}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {guarantor.phone}
                          {url !== undefined ? (
                            <>
                              {" · "}
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline"
                              >
                                {t("guarantors.scan")}
                              </a>
                            </>
                          ) : null}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card>
              <h3 className="text-base font-bold text-ink">{t("documents.heading")}</h3>
              {["draft", "pending_approval", "rejected", "cancelled"].includes(loan.status) ? (
                <p className="mt-2 text-sm text-ink-muted">{t("documents.later")}</p>
              ) : (
                <a
                  href={`/api/pdf/loan_agreement/${loan.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-semibold underline"
                >
                  {t("documents.agreement")}
                </a>
              )}
            </Card>
            {canCancel ? (
              <CancelLoanForm
                loanId={loan.id}
                loanNo={loan.loan_no}
                needsReason={loan.status === "approved"}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
