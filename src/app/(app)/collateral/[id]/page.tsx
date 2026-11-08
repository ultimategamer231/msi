import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { formatDate, formatDateTime, formatMoney, formatShare } from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoanPillText } from "../../loans/loan-pill";
import { AddFilesForm, CustodyEventForm, ReleaseForm } from "./item-forms";

/*
 * /collateral/[id] (all staff; SPEC 9, 5.9, mock-up 10): details, the loan it secures with how much
 * of the balance it covers, photos and documents, the custody log (append-only), custody events,
 * and release once every loan it secured has ended. The collateral receipt PDF comes with M7.
 */
const ENDED = ["closed", "written_off", "cancelled", "rejected"];

function Card({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className="rounded-card border border-line bg-surface p-4 sm:p-6">
      {children}
    </section>
  );
}

export default async function CollateralItemPage(props: PageProps<"/collateral/[id]">) {
  const t = await getTranslations("collateral.item");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ItemContent {...props} />
    </Suspense>
  );
}

async function ItemContent({ params }: PageProps<"/collateral/[id]">) {
  const staff = await requirePageAccess("/collateral/[id]");
  const [{ id }, t, tList, tTypes] = await Promise.all([
    params,
    getTranslations("collateral.item"),
    getTranslations("collateral"),
    getTranslations("loans.wizard.types"),
  ]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [itemResult, pledgesResult, eventsResult, filesResult, peopleResult, todayResult] = await Promise.all(
    [
      supabase
        .from("collaterals")
        .select(
          "*, customers!inner(id, code, type, first_name, last_name, business_name), branches!inner(name)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("loan_collaterals")
        .select("status, pledged_on, released_on, loans!inner(id, loan_no, status, due_date, closed_on)")
        .eq("collateral_id", id)
        .order("pledged_on", { ascending: false }),
      supabase
        .from("collateral_events")
        .select("id, event_type, from_location, to_location, note, witness_name, actor_id, at")
        .eq("collateral_id", id)
        .order("at", { ascending: false }),
      supabase
        .from("attachments")
        .select("id, kind, storage_path, file_name, mime")
        .eq("entity_type", "collateral")
        .eq("entity_id", id)
        .order("created_at"),
      supabase.from("profiles").select("id, full_name"),
      supabase.rpc("business_today"),
    ],
  );
  if (
    itemResult.error !== null ||
    pledgesResult.error !== null ||
    eventsResult.error !== null ||
    todayResult.error !== null
  ) {
    throw new Error("Could not read the item");
  }
  const item = itemResult.data;
  if (item === null) notFound();
  const today = todayResult.data;
  const people = new Map((peopleResult.data ?? []).map((person) => [person.id, person.full_name]));
  const owner = customerName(item.customers);
  const current = pledgesResult.data.find(
    (pledge) => ["pledged", "seized"].includes(pledge.status) && !ENDED.includes(pledge.loans.status),
  );
  const { data: balance } =
    current === undefined
      ? { data: null }
      : await supabase
          .from("loan_balances")
          .select("total_out, days_overdue")
          .eq("loan_id", current.loans.id)
          .maybeSingle();
  const files = filesResult.data ?? [];
  const signed = new Map<string, string>();
  if (files.length > 0) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(
      files.map((file) => file.storage_path),
      600,
    );
    for (const entry of urls ?? [])
      if (entry.path !== null && entry.signedUrl !== null) signed.set(entry.path, entry.signedUrl);
  }

  const readyToReturn = item.status === "held" && current === undefined && pledgesResult.data.length > 0;
  const canRelease =
    item.status === "held" && current === undefined && ["cashier", "manager"].includes(staff.role);
  const canLog = ["loan_officer", "cashier", "manager"].includes(staff.role);
  const badge: { tone: BadgeTone; text: string } = readyToReturn
    ? { tone: "pending", text: tList("status.to_return") }
    : item.status === "held"
      ? { tone: "active", text: tList("status.held") }
      : item.status === "in_recovery"
        ? { tone: "recovery", text: tList("status.in_recovery") }
        : { tone: "pending", text: tList(`status.${item.status as "released"}`) };
  type DetailKey =
    "type" | "serial" | "plate" | "chassis" | "document" | "value" | "owner" | "location" | "branch";
  const optional: Array<[DetailKey, string | null]> = [
    ["serial", item.serial_no],
    ["plate", item.plate_no],
    ["chassis", item.chassis_no],
    ["document", item.document_no],
  ];
  const details: Array<[DetailKey, string]> = [
    ["type", tTypes(item.type as "vehicle")],
    ...optional.filter((entry): entry is [DetailKey, string] => entry[1] !== null),
    ["value", formatMoney(item.estimated_value_cents)],
    ["owner", owner],
    ["location", item.location_note ?? "–"],
    ["branch", item.branches.name],
  ];
  const eventDetail = (event: (typeof eventsResult.data)[number]) => {
    if (event.event_type === "moved")
      return t("log.moved", { from: event.from_location ?? "–", to: event.to_location ?? "" });
    return event.note ?? "";
  };

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="grid gap-3">
          <Link href="/collateral" className="text-sm font-semibold">
            ← {t("back")}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="tabular text-2xl font-bold text-ink">{item.code}</h2>
            <span className="text-lg text-ink-muted">{item.description}</span>
            <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>
          </div>
        </div>

        {canLog || canRelease ? (
          <div className="flex flex-wrap items-start gap-2">
            {canLog ? <CustodyEventForm collateralId={item.id} canValue={staff.role === "manager"} /> : null}
            {canRelease ? <ReleaseForm collateralId={item.id} ownerName={owner} /> : null}
          </div>
        ) : null}
        {item.status === "held" && current !== undefined ? (
          <p className="text-sm text-ink-muted">{t("releaseLater", { loan: current.loans.loan_no })}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <div className="grid content-start gap-4">
            <Card>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                {details.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-sm text-ink-muted">{t(`details.${key}`)}</dt>
                    <dd className="tabular mt-0.5 font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card labelledBy="item-loan">
              <h3 id="item-loan" className="text-base font-bold text-ink">
                {t("loan.heading")}
              </h3>
              {current === undefined ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {pledgesResult.data.length === 0 ? t("loan.none") : t("loan.ended")}
                </p>
              ) : (
                <div className="mt-2 grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/loans/${current.loans.id}`} className="tabular font-semibold underline">
                      {current.loans.loan_no}
                    </Link>
                    <StatusBadge
                      tone={
                        loanPill({
                          status: current.loans.status,
                          dueDate: current.loans.due_date,
                          daysOverdue: balance?.days_overdue ?? 0,
                          totalOutCents: BigInt(balance?.total_out ?? 0),
                          closedOn: current.loans.closed_on,
                          today,
                        }).tone
                      }
                    >
                      <LoanPillText
                        pill={loanPill({
                          status: current.loans.status,
                          dueDate: current.loans.due_date,
                          daysOverdue: balance?.days_overdue ?? 0,
                          totalOutCents: BigInt(balance?.total_out ?? 0),
                          closedOn: current.loans.closed_on,
                          today,
                        })}
                      />
                    </StatusBadge>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {t("loan.pledged", { name: owner, date: formatDate(current.pledged_on) })}
                  </p>
                  {BigInt(balance?.total_out ?? 0) > 0n ? (
                    <p className="text-sm text-ink">
                      {t("loan.cover", {
                        owed: formatMoney(balance?.total_out ?? 0),
                        share: formatShare(item.estimated_value_cents, balance?.total_out ?? 0, 0),
                      })}
                    </p>
                  ) : null}
                </div>
              )}
            </Card>
          </div>

          <div className="grid content-start gap-4">
            <Card labelledBy="item-files">
              <h3 id="item-files" className="text-base font-bold text-ink">
                {t("files.heading")}
              </h3>
              {files.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">{t("files.none")}</p>
              ) : (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {files.map((file) => {
                    const url = signed.get(file.storage_path);
                    return (
                      <li key={file.id} className="grid gap-1">
                        {url !== undefined && file.mime.startsWith("image/") ? (
                          <a href={url} target="_blank" rel="noopener">
                            <Image
                              src={url}
                              alt={file.file_name}
                              width={240}
                              height={160}
                              unoptimized
                              className="h-28 w-full rounded-control bg-page object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener"
                            className="text-sm font-semibold underline"
                          >
                            {file.file_name}
                          </a>
                        )}
                        <span className="text-xs text-ink-muted">
                          {t(`files.kinds.${file.kind as "photo"}`)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canLog ? (
                <div className="mt-4 border-t border-page pt-4">
                  <AddFilesForm collateralId={item.id} />
                </div>
              ) : null}
            </Card>

            <section
              aria-labelledby="item-log"
              className="min-w-0 rounded-card border border-line bg-surface"
            >
              <div className="px-4 pt-4 sm:px-6 sm:pt-6">
                <h3 id="item-log" className="text-base font-bold text-ink">
                  {t("log.heading")}
                </h3>
                <p className="text-sm text-ink-muted">{t("log.intro")}</p>
              </div>
              <ScrollRegion label={t("log.table")} className="mt-3">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {(["when", "event", "detail", "by", "witness"] as const).map((column) => (
                        <th key={column} scope="col" className="px-4 py-2.5 font-semibold">
                          {t(`log.columns.${column}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eventsResult.data.map((event) => (
                      <tr key={event.id} className="border-t border-page">
                        <td className="tabular px-4 py-3 whitespace-nowrap">{formatDateTime(event.at)}</td>
                        <td className="px-4 py-3">{t(`log.types.${event.event_type as "moved"}`)}</td>
                        <td className="px-4 py-3">{eventDetail(event)}</td>
                        <td className="px-4 py-3">{people.get(event.actor_id) ?? ""}</td>
                        <td className="px-4 py-3">{event.witness_name ?? t("log.noWitness")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
