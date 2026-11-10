import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/layout/page-skeleton";
import { TopBar } from "@/components/layout/top-bar";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/lib/auth/staff";
import { formatMoney } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { PayeeForm } from "./payee-form";

/* /payees (manager, accountant; SPEC 9, 7.6): suppliers and others, with what each is owed on 2000. */
export default async function PayeesPage() {
  const t = await getTranslations("payees");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <PayeesContent />
    </Suspense>
  );
}

async function PayeesContent() {
  const staff = await requirePageAccess("/payees");
  const t = await getTranslations("payees");
  const tTypes = await getTranslations("payees.types");
  const supabase = await createSupabaseServerClient();
  const [payeesResult, balancesResult] = await Promise.all([
    supabase.from("payees").select("id, name, type, phone, notes, active").order("name"),
    supabase.from("payee_balances").select("payee_id, owed_cents"),
  ]);
  if (payeesResult.error !== null) throw new Error("Could not read the payees");
  const owed = new Map((balancesResult.data ?? []).map((row) => [row.payee_id, row.owed_cents ?? 0]));

  return (
    <>
      <TopBar title={t("title")} staff={staff} />
      <div className="grid animate-in grid-cols-1 gap-4 p-4 duration-200 fade-in lg:gap-5 lg:p-6">
        <Link href="/expenses" className="text-sm font-semibold">
          ← {t("back")}
        </Link>
        <PayeeForm payee={null} />
        <section aria-labelledby="payee-list" className="min-w-0 rounded-card border border-line bg-surface">
          <h2 id="payee-list" className="border-b border-page p-4 text-base font-bold text-ink">
            {t("listHeading")}
          </h2>
          {payeesResult.data.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-muted">{t("empty")}</p>
          ) : (
            <ScrollRegion label={t("tableLabel")}>
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-subtle text-left text-xs text-ink-muted">
                  <tr>
                    {(["name", "type", "phone", "owed", "edit"] as const).map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`px-4 py-2.5 font-semibold ${column === "owed" ? "text-right" : ""}`}
                      >
                        {t(`columns.${column}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payeesResult.data.map((payee) => (
                    <tr key={payee.id} className="border-t border-page align-top">
                      <td className="px-4 py-3 font-semibold">
                        {payee.name}{" "}
                        {!payee.active ? <StatusBadge tone="pending">{t("inactive")}</StatusBadge> : null}
                      </td>
                      <td className="px-4 py-3">{tTypes(payee.type as "supplier")}</td>
                      <td className="tabular px-4 py-3">{payee.phone ?? "–"}</td>
                      <td className="tabular px-4 py-3 text-right font-semibold">
                        {formatMoney(owed.get(payee.id) ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        <PayeeForm
                          payee={{
                            id: payee.id,
                            name: payee.name,
                            type: payee.type as "supplier",
                            phone: payee.phone ?? "",
                            notes: payee.notes ?? "",
                            active: payee.active,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </section>
      </div>
    </>
  );
}
