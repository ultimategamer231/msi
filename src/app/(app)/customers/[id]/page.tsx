import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { CUSTOMER_STATUS_TONE, StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { businessDateOf, formatDate, formatMoney } from "@/lib/format";
import { loanPill } from "@/lib/loans";
import { canAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ageOf } from "@/lib/when";

import { CustomerForm } from "../customer-form";
import { changesOf, describeCustomerValue, type Lookups } from "../describe";
import { ID_TYPES, valuesFromRow } from "../schemas";

import { LoanPillText } from "../../loans/loan-pill";

import { AddDocumentForm, StatusRequestForm } from "./profile-forms";

/*
 * /customers/[id] (all staff; SPEC 9, mock-up 08): profile, pending change, documents and
 * "Request edit". Loans, collateral, total owed, "New loan" and "Statement of account" join this
 * page with loans (M3), collateral (M6) and statements (M7).
 */
const EDIT_ROLES = ["loan_officer", "cashier", "manager", "admin"] as const;

export default async function CustomerPage(props: PageProps<"/customers/[id]">) {
  const t = await getTranslations("customers.profile");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <CustomerContent {...props} />
    </Suspense>
  );
}

async function CustomerContent({ params, searchParams }: PageProps<"/customers/[id]">) {
  const staff = await requirePageAccess("/customers/[id]");
  const [{ id }, query, t, tCustomers, tForm, tWhen] = await Promise.all([
    params,
    searchParams,
    getTranslations("customers.profile"),
    getTranslations("customers"),
    getTranslations("customers.form"),
    getTranslations("when"),
  ]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [
    customerResult,
    filesResult,
    pendingResult,
    branchesResult,
    peopleResult,
    nowResult,
    loansResult,
    owedResult,
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("attachments")
      .select("id, kind, storage_path, file_name, mime, created_at, created_by")
      .eq("entity_type", "customer")
      .eq("entity_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("approval_requests")
      .select("id, type, payload, reason, requested_by, requested_at")
      .eq("entity_id", id)
      .in("type", ["customer_edit", "customer_blacklist"])
      .eq("status", "pending")
      .maybeSingle(),
    supabase.from("branches").select("id, code, name").order("code"),
    supabase.from("profiles").select("id, full_name, role, branch_id, active").order("full_name"),
    supabase.rpc("app_now"),
    supabase
      .from("loans")
      .select("id, loan_no, status, principal_cents, due_date, closed_on")
      .eq("customer_id", id)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false }),
    supabase.from("customer_balances").select("total_out").eq("customer_id", id).maybeSingle(),
  ]);
  if (customerResult.error !== null || filesResult.error !== null || branchesResult.error !== null) {
    throw new Error("Could not read the customer");
  }
  if (peopleResult.error !== null || nowResult.error !== null) throw new Error("Could not read the customer");
  const customer = customerResult.data;
  if (customer === null) notFound();
  const files = filesResult.data;
  const loanIds = (loansResult.data ?? []).map((loan) => loan.id);
  const { data: balanceRows } =
    loanIds.length === 0
      ? { data: [] }
      : await supabase
          .from("loan_balances")
          .select("loan_id, total_out, days_overdue")
          .in("loan_id", loanIds);
  const loanBalances = new Map((balanceRows ?? []).map((row) => [row.loan_id, row]));
  // Requests are readable by managers, the CEO and the requester (RLS); others simply see none.
  const pending = pendingResult.data;

  const branches = new Map(branchesResult.data.map((branch) => [branch.id, branch.name]));
  const people = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));
  const lookups: Lookups = {
    branches,
    people,
    idTypes: Object.fromEntries(ID_TYPES.map((idType) => [idType, tForm(`idTypes.${idType}`)])),
    statuses: {
      active: tCustomers("status.active"),
      blacklisted: tCustomers("status.blacklisted"),
      archived: tCustomers("status.archived"),
    },
    none: t("none"),
  };

  // Short-lived signed links (SPEC 6.4): created per page view for signed-in staff only.
  const paths = [...new Set([customer.photo_path, ...files.map((file) => file.storage_path)])].filter(
    (path): path is string => path !== null,
  );
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(paths, 600);
    for (const entry of urls ?? []) {
      if (entry.path !== null && entry.signedUrl !== null && entry.signedUrl !== "") {
        signed.set(entry.path, entry.signedUrl);
      }
    }
  }
  const photoUrl = customer.photo_path === null ? undefined : signed.get(customer.photo_path);

  const name = customerName(customer);
  const canEdit = (EDIT_ROLES as readonly string[]).includes(staff.role);
  const editing = canEdit && query.edit === "1" && pending === null;
  const chooseBranch = staff.role === "manager" || staff.role === "admin";

  const ageText = (at: string) => {
    const age = ageOf(at, nowResult.data);
    switch (age.kind) {
      case "now":
        return tWhen("now");
      case "minutes":
        return tWhen("minutes", { count: age.count });
      case "hours":
        return tWhen("hours", { count: age.count });
      case "today":
        return tWhen("today", { time: age.time });
      case "yesterday":
        return tWhen("yesterday", { time: age.time });
      default:
        return tWhen("date", { date: age.date, time: age.time });
    }
  };

  const details: Array<{ label: string; value: string }> = [
    { label: t("fields.phone"), value: customer.phone },
    ...(customer.phone_alt !== null ? [{ label: t("fields.phoneAlt"), value: customer.phone_alt }] : []),
    {
      label: t("fields.address"),
      value: [customer.address, customer.city].filter((part) => part !== null).join(", ") || t("none"),
    },
    {
      label: t("fields.id"),
      value:
        customer.id_number === null
          ? t("none")
          : `${describeCustomerValue("id_type", customer.id_type, lookups)} ${customer.id_number}`,
    },
    ...(customer.type === "business"
      ? [
          { label: t("fields.registrationNo"), value: customer.registration_no ?? t("none") },
          { label: t("fields.contactPerson"), value: customer.contact_person ?? t("none") },
        ]
      : []),
    ...(customer.date_of_birth !== null
      ? [{ label: t("fields.dateOfBirth"), value: formatDate(customer.date_of_birth) }]
      : []),
    { label: t("fields.occupation"), value: customer.occupation ?? t("none") },
    ...(customer.employer_or_business !== null
      ? [{ label: t("fields.employer"), value: customer.employer_or_business }]
      : []),
    {
      label: t("fields.nextOfKin"),
      value:
        customer.next_of_kin_name === null
          ? t("none")
          : [
              customer.next_of_kin_relation === null
                ? customer.next_of_kin_name
                : `${customer.next_of_kin_name} (${customer.next_of_kin_relation})`,
              customer.next_of_kin_phone,
            ]
              .filter((part) => part !== null)
              .join(", "),
    },
    {
      label: t("fields.officer"),
      value:
        customer.assigned_officer_id === null ? t("none") : (people.get(customer.assigned_officer_id) ?? ""),
    },
    { label: t("fields.branch"), value: branches.get(customer.branch_id) ?? "" },
    { label: t("fields.registered"), value: formatDate(businessDateOf(customer.created_at)) },
  ];

  const pendingChanges = pending === null ? [] : changesOf(pending.payload);
  const pendingPhoto =
    pending !== null &&
    typeof pending.payload === "object" &&
    pending.payload !== null &&
    "photo" in pending.payload;
  const pendingSummary = [
    ...pendingChanges.map((change) =>
      t("pending.change", {
        field: t(`columns.${change.column as "phone"}`),
        before: describeCustomerValue(change.column, change.before, lookups),
        after: describeCustomerValue(change.column, change.after, lookups),
      }),
    ),
    ...(pendingPhoto ? [t("pending.photo")] : []),
  ].join("; ");

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link href="/customers" className="text-sm font-semibold">
              ← {tCustomers("allCustomers")}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-2xl font-bold text-ink">{name}</h2>
              <p className="text-ink-muted">
                <span className="tabular">{customer.code}</span> ·{" "}
                {tCustomers(`types.${customer.type as "individual"}`)}
              </p>
              <StatusBadge tone={CUSTOMER_STATUS_TONE[customer.status] ?? "pending"}>
                {tCustomers(`status.${customer.status as "active"}`)}
              </StatusBadge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            {(staff.role === "loan_officer" || staff.role === "manager") && customer.status === "active" ? (
              <Link
                href={`/loans/new?customer=${customer.id}`}
                className={cn(buttonVariants({ variant: "primary" }), "hover:text-white")}
              >
                {t("newLoan")}
              </Link>
            ) : null}
            {canEdit && !editing && pending === null ? (
              <Link
                href={`/customers/${customer.id}?edit=1`}
                className={cn(buttonVariants({ variant: "secondary" }), "hover:text-ink")}
              >
                {t("requestEdit")}
              </Link>
            ) : null}
          </div>
        </div>

        {query.created === "1" ? <Callout>{t("created", { code: customer.code })}</Callout> : null}
        {query.requested === "1" && pending !== null ? <Callout>{t("requested")}</Callout> : null}
        {pending !== null ? (
          <Callout tone="warning">
            <span className="font-bold">{t("pending.heading")}</span>{" "}
            {t("pending.body", {
              summary: pendingSummary,
              requester: people.get(pending.requested_by) ?? "",
              when: ageText(pending.requested_at),
            })}
          </Callout>
        ) : null}

        {editing ? (
          <CustomerForm
            mode={{
              kind: "edit",
              customerId: customer.id,
              initial: valuesFromRow(customer),
            }}
            branches={branchesResult.data.map((branch) => ({
              id: branch.id,
              label: `${branch.code} · ${branch.name}`,
            }))}
            officers={peopleResult.data.flatMap((person) =>
              person.role === "loan_officer" && person.active && person.branch_id !== null
                ? [{ id: person.id, name: person.full_name, branchId: person.branch_id }]
                : [],
            )}
            chooseBranch={chooseBranch}
            canOverride={staff.role === "manager"}
            defaultBranchId={customer.branch_id}
            fixedPlacement={t("placement", {
              branch: branches.get(customer.branch_id) ?? "",
              officer:
                customer.assigned_officer_id === null
                  ? t("none")
                  : (people.get(customer.assigned_officer_id) ?? ""),
            })}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-5">
            <section
              aria-label={t("detailsLabel")}
              className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6"
            >
              <div className="flex items-center gap-4">
                {photoUrl !== undefined ? (
                  // Signed, short-lived URL from private storage; next/image cannot cache it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl}
                    alt={t("photoAlt", { name })}
                    className="size-24 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="inline-flex size-24 shrink-0 items-center justify-center rounded-full bg-subtle text-sm font-medium text-ink-muted">
                    {t("noPhoto")}
                  </span>
                )}
                <div>
                  <p className="text-sm text-ink-muted">{t("totalOwed")}</p>
                  <p
                    className={cn(
                      "tabular text-3xl font-bold",
                      BigInt(owedResult.data?.total_out ?? 0) > 0n ? "text-status-overdue-fg" : "text-ink",
                    )}
                  >
                    {formatMoney(owedResult.data?.total_out ?? 0)}
                  </p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {details.map((detail) => (
                  <div key={detail.label} className="min-w-0">
                    <dt className="text-xs font-medium text-ink-muted">{detail.label}</dt>
                    <dd className="mt-0.5 font-semibold break-words text-ink">{detail.value}</dd>
                  </div>
                ))}
              </dl>
              {customer.notes !== null ? (
                <div className="mt-4 border-t border-page pt-4">
                  <p className="text-xs font-medium text-ink-muted">{t("fields.notes")}</p>
                  <p className="mt-0.5 text-sm whitespace-pre-line text-ink">{customer.notes}</p>
                </div>
              ) : null}
            </section>

            <div className="grid min-w-0 gap-4 lg:gap-5">
              <section
                aria-labelledby="loans-heading"
                className="min-w-0 rounded-card border border-line bg-surface"
              >
                <h2 id="loans-heading" className="px-4 pt-4 text-base font-bold text-ink sm:px-6 sm:pt-6">
                  {t("loans")}
                </h2>
                {(loansResult.data ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-sm text-ink-muted sm:px-6">{t("noLoans")}</p>
                ) : (
                  <ScrollRegion label={t("loansTable")} className="mt-3">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead className="bg-subtle text-left text-xs text-ink-muted">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-semibold">
                            {t("loanColumns.loan")}
                          </th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            {t("loanColumns.lent")}
                          </th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">
                            {t("loanColumns.due")}
                          </th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                            {t("loanColumns.owes")}
                          </th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">
                            {t("loanColumns.status")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(loansResult.data ?? []).map((loan) => {
                          const balance = loanBalances.get(loan.id);
                          const pill = loanPill({
                            status: loan.status,
                            dueDate: loan.due_date,
                            daysOverdue: balance?.days_overdue ?? 0,
                            totalOutCents: BigInt(balance?.total_out ?? 0),
                            closedOn: loan.closed_on,
                            today: businessDateOf(nowResult.data),
                          });
                          return (
                            <tr key={loan.id} className="border-t border-page">
                              <td className="tabular px-4 py-3">
                                <Link href={`/loans/${loan.id}`} className="font-semibold">
                                  {loan.loan_no}
                                </Link>
                              </td>
                              <td className="tabular px-4 py-3 text-right">
                                {formatMoney(loan.principal_cents)}
                              </td>
                              <td className="tabular px-4 py-3 whitespace-nowrap">
                                {loan.due_date === null ? t("notSet") : formatDate(loan.due_date)}
                              </td>
                              <td className="tabular px-4 py-3 text-right">
                                {formatMoney(balance?.total_out ?? 0)}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge tone={pill.tone}>
                                  <LoanPillText pill={pill} />
                                </StatusBadge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollRegion>
                )}
              </section>
              <section
                aria-labelledby="documents-heading"
                className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6"
              >
                <h2 id="documents-heading" className="text-base font-bold text-ink">
                  {t("documents")}
                </h2>
                {files.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">{t("noDocuments")}</p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {files.map((file) => {
                      const url = signed.get(file.storage_path);
                      return (
                        <li key={file.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          {url !== undefined ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold underline"
                            >
                              {t(`kinds.${file.kind as "other"}`)}
                            </a>
                          ) : (
                            <span className="font-semibold">{t(`kinds.${file.kind as "other"}`)}</span>
                          )}
                          <span className="text-ink-muted">
                            {file.file_name} · {formatDate(businessDateOf(file.created_at))} ·{" "}
                            {people.get(file.created_by) ?? ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {canEdit ? (
                  <div className="mt-5 border-t border-page pt-4">
                    <AddDocumentForm customerId={customer.id} />
                  </div>
                ) : null}
              </section>

              {canEdit && pending === null ? (
                <section
                  aria-labelledby="status-heading"
                  className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6"
                >
                  <h2 id="status-heading" className="text-base font-bold text-ink">
                    {t("statusHeading")}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-ink-muted">{t("statusIntro")}</p>
                  <div className="mt-4">
                    <StatusRequestForm customerId={customer.id} current={customer.status} />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        )}
        {canAccess(staff.role, "/approvals") &&
        pending !== null &&
        (staff.role === "manager" || staff.role === "ceo") ? (
          <p className="text-sm">
            <Link href="/approvals" className="font-semibold">
              {t("openApprovals")}
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
