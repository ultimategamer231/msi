import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { RemittanceForm, type CollectorGroup } from "./remittance-form";

/*
 * /remittance (cashier, manager; SPEC 9): field cash waiting for handover, grouped by officer.
 * A cashier sees their own branch; a manager picks the branch (one branch per confirmation).
 */
type Params = Awaited<PageProps<"/remittance">["searchParams"]>;
function single(value: Params[string]): string {
  return typeof value === "string" ? value : "";
}

export default async function RemittancePage(props: PageProps<"/remittance">) {
  const t = await getTranslations("remittance");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <RemittanceContent {...props} />
    </Suspense>
  );
}

async function RemittanceContent({ searchParams }: PageProps<"/remittance">) {
  const staff = await requirePageAccess("/remittance");
  const [t, params] = await Promise.all([getTranslations("remittance"), searchParams]);
  const supabase = await createSupabaseServerClient();
  const [pendingResult, branchesResult, peopleResult] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "id, receipt_no, amount_cents, received_on, received_by, branch_id, loans!inner(loan_no), customers!inner(type, first_name, last_name, business_name)",
      )
      .eq("remittance_status", "pending")
      .eq("status", "posted")
      .order("received_at"),
    supabase.from("branches").select("id, name").order("code"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (pendingResult.error !== null || branchesResult.error !== null || peopleResult.error !== null) {
    throw new Error("Could not read field collections");
  }
  const names = new Map(peopleResult.data.map((person) => [person.id, person.full_name]));
  const pendingByBranch = new Map<string, number>();
  for (const row of pendingResult.data)
    pendingByBranch.set(row.branch_id, (pendingByBranch.get(row.branch_id) ?? 0) + 1);

  // A cashier confirms their own branch; a manager chooses (default: the first branch with cash waiting).
  const requested = single(params.branch);
  const branchId =
    staff.role === "cashier"
      ? (staff.branch?.id ?? "")
      : branchesResult.data.some((branch) => branch.id === requested)
        ? requested
        : (branchesResult.data.find((branch) => pendingByBranch.has(branch.id))?.id ??
          staff.branch?.id ??
          "");

  const groups = new Map<string, CollectorGroup>();
  for (const row of pendingResult.data.filter((item) => item.branch_id === branchId)) {
    const group = groups.get(row.received_by) ?? {
      officerId: row.received_by,
      officer: names.get(row.received_by) ?? "",
      items: [],
    };
    group.items.push({
      id: row.id,
      receiptNo: row.receipt_no,
      customer: customerName(row.customers),
      loanNo: row.loans.loan_no,
      amountCents: String(row.amount_cents),
      receivedOn: row.received_on,
    });
    groups.set(row.received_by, group);
  }

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="mx-auto grid w-full max-w-3xl animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6">
        <p className="text-sm text-ink-muted">{t("intro")}</p>
        {staff.role !== "cashier" ? (
          <nav aria-label={t("branchesLabel")} className="flex flex-wrap gap-2">
            {branchesResult.data.map((branch) => (
              <Link
                key={branch.id}
                href={`/remittance?branch=${branch.id}`}
                aria-current={branch.id === branchId ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-control border px-4 text-sm font-semibold transition-colors duration-150 ease-out lg:min-h-10",
                  branch.id === branchId
                    ? "border-primary bg-primary text-white hover:text-white"
                    : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
                )}
              >
                {branch.name} <span className="tabular">{pendingByBranch.get(branch.id) ?? 0}</span>
              </Link>
            ))}
          </nav>
        ) : null}
        {groups.size === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
            {t("empty")}
          </p>
        ) : (
          <RemittanceForm key={branchId} groups={[...groups.values()]} />
        )}
      </div>
    </>
  );
}
