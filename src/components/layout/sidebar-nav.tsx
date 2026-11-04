"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActive, type NavIcon } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export interface NavLinkItem {
  key: NavIcon;
  href: string;
  label: string;
  /** Count shown as a yellow pill (approvals waiting), with its accessible text. */
  badge?: { count: number; label: string };
}

export function CountBadge({ badge }: { badge: NavLinkItem["badge"] }) {
  if (badge === undefined || badge.count === 0) return null;
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-badge bg-brand-accent px-1.5 text-xs leading-5 font-bold text-on-brand-accent">
      <span aria-hidden="true">{badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

export function SidebarNav({ items, label }: { items: NavLinkItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center justify-between rounded-control px-3 text-sm font-medium transition-colors duration-150 ease-out",
              active
                ? "bg-white/16 font-semibold text-white hover:text-white"
                : "text-on-primary-muted hover:bg-white/8 hover:text-white",
            )}
          >
            {item.label}
            <CountBadge badge={item.badge} />
          </Link>
        );
      })}
    </nav>
  );
}
