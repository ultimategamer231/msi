import { getTranslations } from "next-intl/server";

import { getCurrentStaff } from "@/lib/auth/staff";
import { navigationFor } from "@/lib/navigation";

import { BottomNav } from "./bottom-nav";

export async function AppBottomNav() {
  const result = await getCurrentStaff();
  if (result.status !== "ok") return null;
  const { staff } = result;
  const [t, tNav, tRoles] = await Promise.all([
    getTranslations("shell"),
    getTranslations("nav"),
    getTranslations("roles"),
  ]);
  const items = navigationFor(staff.role).map((item) => ({
    key: item.key,
    href: item.href,
    label: tNav(item.key),
  }));
  return (
    <BottomNav
      items={items}
      account={t("account", { name: staff.fullName, role: tRoles(staff.role) })}
      labels={{
        nav: tNav("label"),
        more: tNav("more"),
        moreTitle: tNav("moreTitle"),
        close: tNav("close"),
        signOut: t("signOut"),
      }}
    />
  );
}
