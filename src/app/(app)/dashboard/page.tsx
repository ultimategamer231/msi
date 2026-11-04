import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { Callout } from "@/components/ui/callout";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatWeekdayDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const t = await getTranslations("dashboard");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const staff = await requirePageAccess("/dashboard");
  const supabase = await createSupabaseServerClient();
  const [t, tShell, params, today] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("shell"),
    searchParams,
    supabase.rpc("business_today"),
  ]);
  if (today.error !== null) throw new Error("Could not read the business date");
  const firstName = staff.fullName.split(" ")[0] ?? staff.fullName;

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        {params.notice === "forbidden" ? (
          <Callout tone="warning" role="alert">
            {t("forbidden")}
          </Callout>
        ) : null}
        <section className="rounded-card border border-line bg-surface p-5 lg:p-6" aria-labelledby="greeting">
          <h2 id="greeting" className="text-xl font-bold text-ink lg:text-2xl">
            {t("greeting", { name: firstName })}
          </h2>
          <p className="mt-1 text-sm text-ink-muted" data-testid="business-date">
            {t("today", {
              date: formatWeekdayDate(today.data),
              branch: staff.branch?.name ?? tShell("allBranches"),
            })}
          </p>
          <p className="mt-4 max-w-[65ch] text-sm leading-6 text-ink-muted">{t("comingUp")}</p>
        </section>
      </div>
    </>
  );
}
