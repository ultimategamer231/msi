import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { requirePageAccess } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CustomerForm } from "../customer-form";

/*
 * /customers/new (loan officer, manager, admin; SPEC 9): individual or business, KYC fields, photo
 * and document upload, duplicate warning (SPEC 5.11).
 */
export default async function NewCustomerPage() {
  const t = await getTranslations("customers");
  return (
    <Suspense fallback={<PageSkeleton label={t("form.loading")} />}>
      <NewCustomerContent />
    </Suspense>
  );
}

async function NewCustomerContent() {
  const staff = await requirePageAccess("/customers/new");
  const t = await getTranslations("customers");
  const supabase = await createSupabaseServerClient();
  const [{ data: branches, error: branchError }, { data: officers, error: officerError }] = await Promise.all(
    [
      supabase.from("branches").select("id, code, name").eq("active", true).order("code"),
      supabase
        .from("profiles")
        .select("id, full_name, branch_id")
        .eq("role", "loan_officer")
        .eq("active", true)
        .order("full_name"),
    ],
  );
  if (branchError !== null || officerError !== null) throw new Error("Could not read branches and officers");

  const chooseBranch = staff.role !== "loan_officer";
  return (
    <>
      <TopBar title={t("form.title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <div>
          <Link href="/customers" className="text-sm font-semibold">
            ← {t("allCustomers")}
          </Link>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-ink-muted">{t("form.intro")}</p>
        </div>
        <CustomerForm
          mode={{ kind: "create" }}
          branches={branches.map((branch) => ({ id: branch.id, label: `${branch.code} · ${branch.name}` }))}
          officers={officers.flatMap((officer) =>
            officer.branch_id === null
              ? []
              : [{ id: officer.id, name: officer.full_name, branchId: officer.branch_id }],
          )}
          chooseBranch={chooseBranch}
          canOverride={staff.role === "manager"}
          defaultBranchId={staff.branch?.id ?? ""}
          fixedPlacement={t("form.placementFixed", {
            branch: staff.branch?.name ?? "",
            officer: staff.fullName,
          })}
        />
      </div>
    </>
  );
}
