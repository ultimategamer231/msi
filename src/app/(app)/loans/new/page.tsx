import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { Callout } from "@/components/ui/callout";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoanWizard, type WizardCustomer } from "./loan-wizard";

/* /loans/new (loan officer, manager; SPEC 9): the loan application wizard. */
export default async function NewLoanPage({ searchParams }: PageProps<"/loans/new">) {
  const t = await getTranslations("loans.wizard");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <NewLoanContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewLoanContent({ searchParams }: { searchParams: PageProps<"/loans/new">["searchParams"] }) {
  const staff = await requirePageAccess("/loans/new");
  const [t, params] = await Promise.all([getTranslations("loans.wizard"), searchParams]);
  const supabase = await createSupabaseServerClient();
  const customerParam =
    typeof params.customer === "string" && /^[0-9a-f-]{36}$/.test(params.customer) ? params.customer : null;

  const [productsResult, officersResult, settingsResult, customerResult] = await Promise.all([
    supabase
      .from("loan_products")
      .select("id, name, interest_rate_bps, default_term_months, max_term_months")
      .eq("active", true)
      .order("name"),
    supabase
      .from("profiles")
      .select("id, full_name, branch_id")
      .eq("role", "loan_officer")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["loans.collateral_required", "approvals.loan_manager_limit_cents"]),
    customerParam === null
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("customers")
          .select(
            "id, code, type, first_name, last_name, business_name, phone, status, branch_id, assigned_officer_id",
          )
          .eq("id", customerParam)
          .maybeSingle(),
  ]);
  if (productsResult.error !== null || officersResult.error !== null || settingsResult.error !== null) {
    throw new Error("Could not load the loan form");
  }
  const settings = new Map(settingsResult.data.map((row) => [row.key, row.value]));
  const row = customerResult.data;
  const allowedCustomer =
    row !== null &&
    row.status === "active" &&
    (staff.role !== "loan_officer" || row.branch_id === staff.branch?.id);
  const initialCustomer: WizardCustomer | null = allowedCustomer
    ? {
        id: row.id,
        code: row.code,
        name: customerName(row),
        phone: row.phone,
        branchId: row.branch_id,
        assignedOfficerId: row.assigned_officer_id,
      }
    : null;

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div>
          <Link href="/loans" className="text-sm font-semibold">
            ← {t("allLoans")}
          </Link>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-ink-muted">{t("intro")}</p>
        </div>
        {productsResult.data.length === 0 ? (
          <Callout tone="warning">{t("noProducts")}</Callout>
        ) : (
          <LoanWizard
            products={productsResult.data.map((product) => ({
              id: product.id,
              name: product.name,
              rateBps: product.interest_rate_bps,
              defaultTermMonths: product.default_term_months,
              maxTermMonths: product.max_term_months,
            }))}
            officers={officersResult.data.flatMap((officer) =>
              officer.branch_id === null
                ? []
                : [{ id: officer.id, name: officer.full_name, branchId: officer.branch_id }],
            )}
            chooseOfficer={staff.role === "manager"}
            collateralRequired={settings.get("loans.collateral_required") !== false}
            managerLimitCents={String(settings.get("approvals.loan_manager_limit_cents") ?? "0")}
            initialCustomer={initialCustomer}
          />
        )}
      </div>
    </>
  );
}
