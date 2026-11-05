import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AppBottomNav } from "@/components/layout/app-bottom-nav";
import { AppSidebar, AppSidebarSkeleton } from "@/components/layout/app-sidebar";

/*
 * Shell for every signed-in page (SPEC 9): left navigation on desktop, bottom tab bar on phones.
 * The layout never authorises: each page calls requirePageAccess(). Session reads sit behind
 * Suspense so the frame renders immediately (Next.js Cache Components guidance).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("shell");
  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-4 py-3 text-sm font-semibold text-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skipToContent")}
      </a>
      <Suspense fallback={<AppSidebarSkeleton />}>
        <AppSidebar />
      </Suspense>
      <main
        id="main"
        className="flex min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0"
      >
        {children}
      </main>
      <Suspense fallback={null}>
        <AppBottomNav />
      </Suspense>
    </div>
  );
}
