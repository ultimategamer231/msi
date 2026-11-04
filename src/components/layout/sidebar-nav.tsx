"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActive, type NavIcon } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export interface NavLinkItem {
  key: NavIcon;
  href: string;
  label: string;
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
          </Link>
        );
      })}
    </nav>
  );
}
