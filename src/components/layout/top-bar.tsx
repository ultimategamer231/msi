import { getTranslations } from "next-intl/server";
import type * as React from "react";

import type { Staff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";

import { LogoTile } from "./logo-tile";

/*
 * Page header. Desktop (mock-ups 05-15): white bar with the page title and the branch.
 * Phone (mock-ups 02-03): purple header with "name · role · branch", the title and the logo tile.
 * One <h1> serves both layouts.
 */
export async function TopBar({
  title,
  staff,
  actions,
}: {
  title: string;
  staff: Staff;
  actions?: React.ReactNode;
}) {
  const [company, t, tRoles] = await Promise.all([
    getCompany(),
    getTranslations("shell"),
    getTranslations("roles"),
  ]);
  const branch = staff.branch?.name ?? t("allBranches");

  return (
    <header className="flex items-center justify-between gap-3 bg-primary px-4 pt-5 pb-4 text-white lg:border-b lg:border-line lg:bg-surface lg:px-6 lg:py-3.5 lg:text-inherit">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-primary-tint lg:hidden">
          {staff.fullName} · {tRoles(staff.role)} · {branch}
        </p>
        <h1 className="mt-0.5 truncate text-[22px] font-bold lg:mt-0 lg:text-xl">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {actions}
        <p className="hidden text-sm font-medium text-ink-muted lg:block">{branch}</p>
        <LogoTile
          size="sm"
          className="lg:hidden"
          logoUrl={company?.logoUrl ?? null}
          alt={t("logoAlt", { company: company?.name ?? "" })}
          shortName={company?.shortName ?? ""}
        />
      </div>
    </header>
  );
}
