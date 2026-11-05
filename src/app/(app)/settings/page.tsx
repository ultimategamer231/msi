import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { requirePageAccess, type Staff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { formatDateTime } from "@/lib/format";
import { logServerError } from "@/lib/log";
import { centsToInput } from "@/lib/money-input";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { blankIfPending } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Json } from "@/types/database";

import { BranchesPanel } from "./branches-panel";
import { CompanyPanel } from "./company-panel";
import { ProductsPanel } from "./products-panel";
import { RulesPanel } from "./rules-panel";
import type { AllocationComponent } from "./schemas";
import { UsersPanel } from "./users-panel";

/* /settings (admin): company header, branches, rule settings and users (SPEC 9, FR-01, FR-02). */
const TABS = ["company", "branches", "products", "rules", "users"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const t = await getTranslations("settings");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <SettingsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const staff = await requirePageAccess("/settings");
  const [t, params] = await Promise.all([getTranslations("settings"), searchParams]);
  const tab: Tab = TABS.find((candidate) => candidate === params.tab) ?? "company";

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <nav aria-label={t("tabs.label")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-2">
            {TABS.map((candidate) => (
              <li key={candidate}>
                <Link
                  href={candidate === "company" ? "/settings" : `/settings?tab=${candidate}`}
                  aria-current={candidate === tab ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 ease-out lg:min-h-10",
                    candidate === tab
                      ? "border-primary bg-primary text-white hover:text-white"
                      : "border-line-input bg-surface text-ink hover:bg-page hover:text-ink",
                  )}
                >
                  {t(`tabs.${candidate}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {tab === "company" ? <CompanyTab /> : null}
        {tab === "branches" ? <BranchesTab /> : null}
        {tab === "products" ? <ProductsTab /> : null}
        {tab === "rules" ? <RulesTab /> : null}
        {tab === "users" ? <UsersTab staff={staff} /> : null}
      </div>
    </>
  );
}

function asObject(value: Json | undefined): Record<string, Json | undefined> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function readSettings(): Promise<Map<string, Json>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error !== null) {
    logServerError({ code: `SETTINGS_READ_${error.code}`, where: "settings.readSettings" });
    throw new Error("Could not read settings");
  }
  return new Map(data.map((row) => [row.key, row.value]));
}

async function CompanyTab() {
  const [settings, company] = await Promise.all([readSettings(), getCompany()]);
  const raw = asObject(settings.get("company"));
  const templates = asObject(settings.get("templates"));
  return (
    <CompanyPanel
      company={{
        name: blankIfPending(raw.name),
        shortName: blankIfPending(raw.short_name),
        address: blankIfPending(raw.address),
        phone: blankIfPending(raw.phone),
        email: blankIfPending(raw.email),
        receiptFooter: blankIfPending(raw.receipt_footer),
      }}
      logoUrl={company?.logoUrl ?? null}
      templates={{
        reminder: typeof templates.reminder === "string" ? templates.reminder : "",
        reminderOverdue: typeof templates.reminder_overdue === "string" ? templates.reminder_overdue : "",
      }}
    />
  );
}

async function ProductsTab() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("loan_products")
    .select(
      "id, name, interest_rate_bps, default_term_months, max_term_months, penalty_rate_bps, penalty_period_days, penalty_base, penalty_max_periods, recovery_after_days, active",
    )
    .order("name");
  if (error !== null) throw new Error("Could not read loan products");
  return (
    <ProductsPanel
      products={data.map((product) => ({
        id: product.id,
        name: product.name,
        interestRateBps: product.interest_rate_bps,
        defaultTermMonths: product.default_term_months,
        maxTermMonths: product.max_term_months,
        penaltyRateBps: product.penalty_rate_bps,
        penaltyPeriodDays: product.penalty_period_days,
        penaltyBase: product.penalty_base === "original_due" ? "original_due" : "outstanding_total",
        penaltyMaxPeriods: product.penalty_max_periods,
        recoveryAfterDays: product.recovery_after_days,
        active: product.active,
      }))}
    />
  );
}

async function BranchesTab() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id, code, name, address, phone, active")
    .order("code");
  if (error !== null) throw new Error("Could not read branches");
  return (
    <BranchesPanel
      branches={data.map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        address: branch.address ?? "",
        phone: branch.phone ?? "",
        active: branch.active,
      }))}
    />
  );
}

function bool(value: Json | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cents(value: Json | undefined): string {
  return typeof value === "number" && Number.isSafeInteger(value) ? centsToInput(value) : "";
}

async function RulesTab() {
  const supabase = await createSupabaseServerClient();
  const [settings, environment, now] = await Promise.all([
    readSettings(),
    supabase.rpc("environment_kind"),
    supabase.rpc("app_now"),
  ]);
  const allocation = settings.get("payments.allocation_order");
  const order = (Array.isArray(allocation) ? allocation : ["penalty", "interest", "principal"]).filter(
    (item): item is AllocationComponent => item === "penalty" || item === "interest" || item === "principal",
  );
  const clock = asObject(settings.get("clock.override_at"));
  const goLive = settings.get("migration.go_live_date");
  const clockAt = typeof clock.at === "string" ? clock.at : (now.data ?? new Date().toISOString());

  return (
    <RulesPanel
      currency={
        typeof settings.get("currency.base") === "string" ? String(settings.get("currency.base")) : "USD"
      }
      rules={{
        loanManagerLimit: cents(settings.get("approvals.loan_manager_limit_cents")),
        expenseLimit: cents(settings.get("approvals.expense_limit_cents")),
        collateralRequired: bool(settings.get("loans.collateral_required"), true),
        multiLoan: bool(settings.get("collateral.multi_loan"), false),
        extensionEnabled: bool(settings.get("extension.enabled"), true),
        requireRemittance: bool(settings.get("field.require_remittance"), true),
        dayClosesEnforce: bool(settings.get("daycloses.enforce"), true),
        checkFunds: bool(settings.get("disbursement.check_funds"), true),
        allocationOrder: order.length === 3 ? order : ["penalty", "interest", "principal"],
        goLiveDate: typeof goLive === "string" ? goLive : "",
      }}
      clock={{
        allowed:
          environment.data === "demo" || environment.data === "test" || environment.data === "development",
        now: now.data !== null ? formatDateTime(now.data) : "",
        // datetime-local wants "YYYY-MM-DDTHH:MM"; Monrovia is UTC+0, so the UTC text is local time.
        values: {
          useRealTime: false,
          at: new Date(clockAt).toISOString().slice(0, 16),
          frozen: bool(clock.frozen, true),
        },
      }}
    />
  );
}

async function UsersTab({ staff }: { staff: Staff }) {
  const supabase = await createSupabaseServerClient();
  const [{ data: profiles, error }, { data: branches, error: branchError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, role, active, branch_id, branch:branches!profiles_branch_id_fkey(name)")
      .order("full_name"),
    supabase.from("branches").select("id, code, name, active").order("code"),
  ]);
  if (error !== null || branchError !== null) throw new Error("Could not read users");

  // Sign-in emails live in Supabase Auth; only the admin page reads them, through the service role.
  const emails = new Map<string, string>();
  const auth = createSupabaseAdminClient();
  for (let page = 1; ; page += 1) {
    const { data, error: listError } = await auth.auth.admin.listUsers({ page, perPage: 200 });
    if (listError !== null) {
      logServerError({ code: "AUTH_LIST_USERS", userId: staff.id, where: "settings.UsersTab" });
      throw new Error("Could not list sign-in accounts");
    }
    for (const user of data.users) emails.set(user.id, user.email ?? "");
    if (data.users.length < 200) break;
  }

  return (
    <UsersPanel
      selfId={staff.id}
      branches={branches
        .filter((branch) => branch.active)
        .map((branch) => ({ id: branch.id, label: `${branch.code} · ${branch.name}` }))}
      users={profiles.map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        email: emails.get(profile.id) ?? "",
        phone: profile.phone ?? "",
        role: profile.role,
        branchId: profile.branch_id ?? "",
        branchName: profile.branch?.name ?? "",
        active: profile.active,
      }))}
    />
  );
}
