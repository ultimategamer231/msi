"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { NavIcon } from "./nav-icon";
import type { NavLinkItem } from "./sidebar-nav";

const MAX_TABS = 4;

/*
 * Phone navigation (SPEC 9: bottom tab bar on phones; mock-up 01). The first pages of the role's
 * navigation are tabs; "More" opens a sheet with every page and sign-out. 44px+ touch targets.
 */
export function BottomNav({
  items,
  labels,
  account,
}: {
  items: NavLinkItem[];
  labels: { nav: string; more: string; moreTitle: string; close: string; signOut: string };
  account: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = items.slice(0, MAX_TABS);

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-control text-xs font-semibold transition-colors duration-150 ease-out",
      active ? "text-primary" : "text-ink-muted hover:text-ink",
    );

  return (
    <nav
      aria-label={labels.nav}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {tabs.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={tabClass(active)}
          >
            <NavIcon name={item.key} className="size-5.5" />
            {item.label}
          </Link>
        );
      })}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={tabClass(false)}>
          <Menu aria-hidden="true" className="size-5.5" />
          {labels.more}
        </SheetTrigger>
        <SheetContent
          side="bottom"
          closeLabel={labels.close}
          className="max-h-[85dvh] overflow-y-auto rounded-t-card pb-6"
        >
          <SheetHeader className="pr-14">
            <SheetTitle>{labels.moreTitle}</SheetTitle>
            <SheetDescription>{account}</SheetDescription>
          </SheetHeader>
          <ul className="grid gap-1 px-3">
            {items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-control px-3 text-sm font-semibold",
                      active ? "bg-primary-tint text-primary-dark" : "text-ink hover:bg-page",
                    )}
                  >
                    <NavIcon name={item.key} className="size-5" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <form action="/auth/sign-out" method="post" className="mx-3 border-t border-line pt-3">
            <button
              type="submit"
              className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-sm font-semibold text-ink hover:bg-page"
            >
              <LogOut aria-hidden="true" className="size-5" />
              {labels.signOut}
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
