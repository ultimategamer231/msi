import {
  Banknote,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FileText,
  HandCoins,
  Gavel,
  History,
  LayoutDashboard,
  ListChecks,
  Lock,
  Package,
  Receipt,
  Settings,
  Users,
  Wallet,
  type LucideProps,
} from "lucide-react";

import type { NavIcon as NavIconKey } from "@/lib/navigation";

const ICONS = {
  dashboard: LayoutDashboard,
  field: ListChecks,
  customers: Users,
  loans: Wallet,
  payments: Banknote,
  remittance: HandCoins,
  due: CalendarClock,
  collateral: Package,
  recovery: Gavel,
  approvals: ClipboardCheck,
  dayClose: Lock,
  expenses: Receipt,
  reports: FileText,
  ledger: BookOpen,
  audit: History,
  settings: Settings,
} satisfies Record<NavIconKey, React.ComponentType<LucideProps>>;

export function NavIcon({ name, ...props }: { name: NavIconKey } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" strokeWidth={2} {...props} />;
}
