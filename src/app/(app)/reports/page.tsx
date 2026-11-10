import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { requirePageAccess } from "@/lib/auth/staff";
import { REPORT_KEYS } from "@/lib/reports";

/* /reports (CEO, manager, accountant, admin; SPEC 10.2): the list of reports. */
export default async function ReportsPage() {
  const t = await getTranslations("reports");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <ReportsIndex />
    </Suspense>
  );
}

async function ReportsIndex() {
  const staff = await requirePageAccess("/reports");
  const t = await getTranslations("reports");
  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <p className="text-sm text-ink-muted">{t("indexIntro")}</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {REPORT_KEYS.map((key) => (
            <li key={key}>
              <Link
                href={`/reports/${key}`}
                className="grid h-full gap-1 rounded-card border border-line bg-surface p-4 text-ink hover:border-primary hover:text-ink sm:p-5"
              >
                <span className="font-bold text-primary">{t(`titles.${key}`)}</span>
                <span className="text-sm text-ink-muted">{t(`descriptions.${key}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
