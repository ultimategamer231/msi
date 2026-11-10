import { useTranslations } from "next-intl";

import { formatDate } from "@/lib/format";
import type { LoanPill } from "@/lib/loans";

/* The words inside a loan status pill (mock-ups 06, 07, 08). */
export function LoanPillText({ pill }: { pill: LoanPill }) {
  const t = useTranslations("loans.pill");
  if (pill.key === "overdue") return <>{t("overdue", { count: pill.days })}</>;
  if (pill.key === "closedOn") return <>{t("closedOn", { date: formatDate(pill.date).slice(0, 6) })}</>;
  return <>{t(pill.key)}</>;
}
