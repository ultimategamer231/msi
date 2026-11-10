import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { requirePageAccess } from "@/lib/auth/staff";
import { customerName } from "@/lib/customers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CollateralForm } from "./collateral-form";

/* /collateral/new (loan officer, cashier, manager; SPEC 9): register an item, optionally ?customer=. */
export default async function NewCollateralPage(props: PageProps<"/collateral/new">) {
  const t = await getTranslations("collateral.new");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <NewCollateralContent {...props} />
    </Suspense>
  );
}

async function NewCollateralContent({ searchParams }: PageProps<"/collateral/new">) {
  const staff = await requirePageAccess("/collateral/new");
  const [t, params] = await Promise.all([getTranslations("collateral.new"), searchParams]);
  const customerId =
    typeof params.customer === "string" && /^[0-9a-f-]{36}$/.test(params.customer) ? params.customer : "";
  let owner = null;
  if (customerId !== "") {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("customers")
      .select("id, code, type, first_name, last_name, business_name")
      .eq("id", customerId)
      .eq("status", "active")
      .maybeSingle();
    if (data !== null) owner = { id: data.id, code: data.code, name: customerName(data) };
  }
  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="mx-auto grid w-full max-w-3xl animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:p-6">
        <Link href="/collateral" className="text-sm font-semibold">
          ← {t("back")}
        </Link>
        <p className="text-sm text-ink-muted">{t("intro")}</p>
        <CollateralForm owner={owner} />
      </div>
    </>
  );
}
