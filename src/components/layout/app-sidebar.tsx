import { LogOut } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getCurrentStaff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { approvalsWaiting } from "@/lib/approvals";
import { navigationFor } from "@/lib/navigation";
import { initials } from "@/lib/text";

import { LogoTile } from "./logo-tile";
import { SidebarNav } from "./sidebar-nav";

/* Desktop navigation (SPEC 9: left nav on desktop). Mock-ups 05-15, 232px wide, primary-dark. */
export async function AppSidebar() {
  const result = await getCurrentStaff();
  if (result.status !== "ok") return null;
  const { staff } = result;
  const [company, t, tNav, tRoles] = await Promise.all([
    getCompany(),
    getTranslations("shell"),
    getTranslations("nav"),
    getTranslations("roles"),
  ]);
  const waiting = await approvalsWaiting(staff);
  const items = navigationFor(staff.role).map((item) => ({
    key: item.key,
    href: item.href,
    label: tNav(item.key),
    badge:
      item.key === "approvals" && waiting > 0
        ? { count: waiting, label: tNav("waiting", { count: waiting }) }
        : undefined,
  }));
  const companyName = company?.name ?? "";

  return (
    <aside className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col gap-1 bg-primary-dark px-3 py-5 text-white lg:flex">
      <div className="px-1 pb-4">
        <div className="flex items-center gap-2.5 rounded-tile bg-surface px-3 py-2.5">
          <LogoTile
            logoUrl={company?.logoUrl ?? null}
            alt={t("logoAlt", { company: companyName })}
            shortName={company?.shortName ?? ""}
          />
          <div className="min-w-0 leading-tight">
            <p className="line-clamp-2 text-sm font-extrabold text-primary">{companyName}</p>
            <p className="text-[11px] font-semibold text-ink-muted">{t("product")}</p>
          </div>
        </div>
      </div>
      <SidebarNav items={items} label={tNav("label")} />
      <div className="mt-auto flex items-center gap-2.5 border-t border-white/18 px-2 pt-3.5">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[13px] font-bold text-primary-dark"
        >
          {initials(staff.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{staff.fullName}</p>
          <p className="text-xs text-on-primary-muted">{tRoles(staff.role)}</p>
        </div>
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            title={t("signOut")}
            className="inline-flex size-10 items-center justify-center rounded-control text-on-primary-muted transition-colors duration-150 ease-out hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("signOut")}</span>
          </button>
        </form>
      </div>
    </aside>
  );
}

export function AppSidebarSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col gap-2 bg-primary-dark px-3 py-5 lg:flex"
    >
      <div className="mx-1 mb-4 h-15 rounded-tile bg-white/90" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-10 animate-pulse rounded-control bg-white/8" />
      ))}
    </div>
  );
}
