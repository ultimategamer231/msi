import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { Callout } from "@/components/ui/callout";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { businessDateOf, formatDate, formatMoney } from "@/lib/format";
import { centsToInput } from "@/lib/money-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SaleForm, StepForm, SurplusForm, WriteOffForm } from "../case-forms";

/*
 * /recovery/[caseId] (manager, CEO; SPEC 9, 5.7, mock-up 13): what is owed, the seized collateral,
 * the stage timeline, court steps, the sale with its preview, the surplus and the write-off request.
 * The demand notice PDF comes with M7.
 */
const STAGES = ["opened", "notice_sent", "court_filed", "judgment", "disposal"] as const;

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface p-4 sm:p-6">
      <h3 id={id} className="text-base font-bold text-ink">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function RecoveryCasePage(props: PageProps<"/recovery/[caseId]">) {
  const t = await getTranslations("recovery.case");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <CaseContent {...props} />
    </Suspense>
  );
}

async function CaseContent({ params }: PageProps<"/recovery/[caseId]">) {
  const staff = await requirePageAccess("/recovery/[caseId]");
  const [{ caseId }, t, tStages] = await Promise.all([
    params,
    getTranslations("recovery.case"),
    getTranslations("approvals.recoveryStages"),
  ]);
  if (!/^[0-9a-f-]{36}$/.test(caseId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("recovery_cases")
    .select(
      "*, loans!inner(id, loan_no, status, due_date, penalty_max_periods, due_date_version, customers!inner(type, first_name, last_name, business_name))",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (error !== null) throw new Error("Could not read the case");
  if (row === null) notFound();
  const loan = row.loans;
  const [
    actionsResult,
    pledgesResult,
    preview,
    surplusResult,
    peopleResult,
    penaltiesResult,
    writeOffResult,
  ] = await Promise.all([
    supabase
      .from("recovery_actions")
      .select("id, stage, action_date, note, court_ref, actor_id")
      .eq("case_id", caseId)
      .order("created_at"),
    supabase
      .from("loan_collaterals")
      .select(
        "status, collaterals!inner(id, code, description, plate_no, serial_no, document_no, estimated_value_cents, location_note, status)",
      )
      .eq("loan_id", loan.id),
    supabase.rpc("preview_collateral_sale", { p_case_id: caseId, p_amount_cents: 0 }),
    supabase.rpc("loan_surplus_cents", { p_loan_id: loan.id }),
    supabase.from("profiles").select("id, full_name"),
    supabase
      .from("loan_penalty_events")
      .select("id")
      .eq("loan_id", loan.id)
      .eq("due_date_version", loan.due_date_version),
    supabase
      .from("approval_requests")
      .select("id")
      .eq("type", "write_off")
      .eq("entity_id", loan.id)
      .eq("status", "pending")
      .maybeSingle(),
  ]);
  if (actionsResult.error !== null || pledgesResult.error !== null || preview.error !== null) {
    throw new Error("Could not read the case");
  }
  const people = new Map((peopleResult.data ?? []).map((person) => [person.id, person.full_name]));
  const owed = (preview.data as { owed: Record<"penalty" | "interest" | "principal" | "total", number> })
    .owed;
  const name = customerName(loan.customers);
  const isOpen = row.closed_on === null;
  const surplus = String(surplusResult.data ?? 0);
  const seized = pledgesResult.data.filter(
    (pledge) => pledge.status === "seized" && pledge.collaterals.status === "in_recovery",
  );
  const done = new Map<string, (typeof actionsResult.data)[number]>();
  for (const action of actionsResult.data) if (!done.has(action.stage)) done.set(action.stage, action);
  const currentRank = STAGES.indexOf(row.stage as (typeof STAGES)[number]);
  const nextStages = isOpen ? STAGES.filter((_, index) => index > currentRank && index > 0) : [];
  const decides = staff.role === "manager" || staff.role === "ceo";
  const canWriteOff = isOpen && staff.role === "manager" && owed.total > 0 && writeOffResult.data === null;
  const identifier = (item: (typeof seized)[number]["collaterals"]) =>
    [item.plate_no, item.serial_no, item.document_no].find((value) => value !== null) ?? "";

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="grid gap-3">
          <Link href="/recovery" className="text-sm font-semibold">
            ← {t("back")}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold text-ink">{name}</h2>
            <span className="tabular text-ink-muted">
              <Link href={`/loans/${loan.id}`} className="underline">
                {loan.loan_no}
              </Link>{" "}
              · {t("caseNo", { case: row.case_no })}
            </span>
            <StatusBadge tone={isOpen ? "recovery" : "pending"}>
              {isOpen ? t("inRecovery") : t("closed")}
            </StatusBadge>
          </div>
        </div>

        {decides && isOpen ? (
          <div className="flex flex-wrap items-start gap-2">
            <StepForm caseId={row.id} stages={nextStages} />
            {["overdue", "recovery"].includes(loan.status) ? (
              <a
                href={`/api/pdf/demand_notice/${loan.id}`}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}
              >
                {t("demandNotice")}
              </a>
            ) : null}
            {canWriteOff ? (
              <WriteOffForm loanId={loan.id} override={!["disposal", "closed"].includes(row.stage)} />
            ) : null}
          </div>
        ) : null}
        {writeOffResult.data !== null ? <Callout>{t("writeOffPending")}</Callout> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <div className="grid content-start gap-4">
            <Card id="case-owed" title={t("owed.heading")}>
              <p className="tabular text-3xl font-bold text-status-overdue-fg">{formatMoney(owed.total)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    ["principal", formatMoney(owed.principal)],
                    ["interest", formatMoney(owed.interest)],
                    ["penalties", formatMoney(owed.penalty)],
                    [
                      "rounds",
                      t("owed.roundsValue", {
                        count: (penaltiesResult.data ?? []).length,
                        max: loan.penalty_max_periods ?? 0,
                      }),
                    ],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm text-ink-muted">{t(`owed.${key}`)}</dt>
                    <dd className="tabular font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm text-ink-muted">
                {t("owed.dates", {
                  due: formatDate(loan.due_date ?? row.opened_on),
                  opened: formatDate(row.opened_on),
                })}
              </p>
            </Card>
            <Card id="case-collateral" title={t("collateral.heading")}>
              {pledgesResult.data.length === 0 ? (
                <p className="text-sm text-ink-muted">{t("collateral.none")}</p>
              ) : (
                <ul className="grid gap-3">
                  {pledgesResult.data.map((pledge) => (
                    <li key={pledge.collaterals.id} className="flex items-start justify-between gap-3">
                      <div className="grid">
                        <Link
                          href={`/collateral/${pledge.collaterals.id}`}
                          className="tabular font-semibold underline"
                        >
                          {pledge.collaterals.code}
                        </Link>
                        <span className="text-sm text-ink-muted">
                          {[
                            pledge.collaterals.description,
                            identifier(pledge.collaterals),
                            pledge.collaterals.location_note,
                          ]
                            .filter((part) => part !== null && part !== "")
                            .join(" · ")}
                        </span>
                      </div>
                      <span className="tabular text-right font-bold text-ink">
                        {formatMoney(pledge.collaterals.estimated_value_cents)}
                        <span className="block text-xs font-normal text-ink-muted">
                          {t(`collateral.status.${pledge.status as "seized"}`)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {BigInt(surplus) > 0n ? (
              <Card id="case-surplus" title={t("surplus.heading")}>
                <p className="text-sm text-ink">{t("surplus.intro", { amount: formatMoney(surplus) })}</p>
                {decides ? (
                  <div className="mt-3">
                    <SurplusForm caseId={row.id} loanId={loan.id} surplus={centsToInput(surplus)} />
                  </div>
                ) : null}
              </Card>
            ) : null}
          </div>

          <div className="grid content-start gap-4">
            <Card id="case-stages" title={t("stages.heading")}>
              <ol className="grid gap-4">
                {STAGES.map((stage, index) => {
                  const action = done.get(stage);
                  const isNext = action === undefined && index === currentRank + 1 && isOpen;
                  return (
                    <li key={stage} className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                          action !== undefined
                            ? "border-status-active-fg bg-status-active-fg text-white"
                            : isNext
                              ? "border-primary text-primary"
                              : "border-line-input text-ink-muted",
                        )}
                      >
                        {action !== undefined ? <Check className="size-4" /> : index + 1}
                      </span>
                      <div className="grid">
                        <span className="font-semibold text-ink">
                          {stage === "disposal" ? t("stages.disposal") : tStages(stage)}
                          <span className="sr-only">
                            {" "}
                            {action !== undefined
                              ? t("stages.done")
                              : isNext
                                ? t("stages.next")
                                : t("stages.later")}
                          </span>
                        </span>
                        {action !== undefined ? (
                          <span className="text-sm text-ink-muted">
                            {[
                              formatDate(action.action_date),
                              people.get(action.actor_id ?? "") ?? "",
                              action.note,
                              action.court_ref,
                            ]
                              .filter((part) => part !== null && part !== "")
                              .join(" · ")}
                          </span>
                        ) : isNext ? (
                          <span className="text-sm text-ink-muted">{t("stages.nextStep")}</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {!isOpen ? (
                  <li className="text-sm text-ink-muted">
                    {t("stages.closedOn", {
                      date: formatDate(row.closed_on ?? businessDateOf(row.updated_at)),
                    })}
                  </li>
                ) : null}
              </ol>
            </Card>
            {decides && isOpen ? (
              <SaleForm
                caseId={row.id}
                loanId={loan.id}
                items={seized.map((pledge) => ({
                  id: pledge.collaterals.id,
                  code: pledge.collaterals.code,
                  description: pledge.collaterals.description,
                }))}
                initial={{
                  ok: true,
                  owed: {
                    penalty: String(owed.penalty),
                    interest: String(owed.interest),
                    principal: String(owed.principal),
                    total: String(owed.total),
                  },
                  allocation: { penalty: "0", interest: "0", principal: "0" },
                  surplusCents: "0",
                  shortfallCents: String(owed.total),
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
