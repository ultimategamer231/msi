import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { requirePageAccess } from "@/lib/auth/staff";

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const staff = await requirePageAccess("/dashboard");
  const [t, tRoles, params] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("roles"),
    searchParams,
  ]);
  const firstName = staff.fullName.split(" ")[0] ?? staff.fullName;

  return (
    <section className="grid gap-5">
      {params.notice === "forbidden" ? (
        <p
          role="alert"
          className="rounded-control border border-warning-border bg-warning-bg px-4 py-3 text-sm text-status-overdue-fg"
        >
          {t("forbidden")}
        </p>
      ) : null}
      <div className="rounded-card border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold text-ink">{t("greeting", { name: firstName })}</h1>
        <p className="mt-2 text-sm text-ink-muted" data-testid="signed-in-as">
          {t("signedInAs", { role: tRoles(staff.role) })}
          {" · "}
          {staff.branch?.name ?? t("allBranches")}
        </p>
        <form action="/auth/sign-out" method="post" className="mt-6">
          <button
            type="submit"
            className="min-h-11 rounded-control border border-line-input bg-white px-4 text-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-page"
          >
            {t("signOut")}
          </button>
        </form>
      </div>
    </section>
  );
}

async function DashboardSkeleton() {
  const t = await getTranslations("dashboard");
  return (
    <div role="status" aria-label={t("loading")} className="rounded-card border border-line bg-surface p-6">
      <div className="h-7 w-56 animate-pulse rounded bg-page" />
      <div className="mt-3 h-4 w-72 animate-pulse rounded bg-page" />
      <div className="mt-6 h-11 w-28 animate-pulse rounded-[10px] bg-page" />
    </div>
  );
}
