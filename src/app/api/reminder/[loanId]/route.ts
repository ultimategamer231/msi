import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";

import { getCurrentStaff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { customerName } from "@/lib/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { logServerError } from "@/lib/log";
import { errorCodeFrom } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fillTemplate } from "@/lib/template";
import { whatsappLink } from "@/lib/whatsapp";

/*
 * WhatsApp reminder (SPEC 10.3; FR-13): fills settings.templates.reminder (or reminder_overdue once
 * the loan is overdue), logs the tap as loan.reminder_opened and sends the browser to wa.me. The
 * officer presses send in WhatsApp; there is no delivery guarantee.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  const staff = await getCurrentStaff();
  if (staff.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(loanId)) return new Response("Not found.", { status: 404 });
  const t = await getTranslations("due.reminder");

  const supabase = await createSupabaseServerClient();
  const [{ data: loan }, { data: balance }, { data: templates }, company] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "loan_no, principal_cents, due_date, customers!inner(type, first_name, last_name, business_name, phone), branches!inner(name, phone)",
      )
      .eq("id", loanId)
      .maybeSingle(),
    supabase
      .from("loan_balances")
      .select("total_out, penalty_out, days_overdue")
      .eq("loan_id", loanId)
      .maybeSingle(),
    supabase.from("settings").select("value").eq("key", "templates").maybeSingle(),
    getCompany(),
  ]);
  if (loan === null || loan.due_date === null) return new Response(t("notOpen"), { status: 404 });
  const overdue = (balance?.days_overdue ?? 0) > 0;
  const kind = overdue ? "reminder_overdue" : "reminder";
  const texts = (templates?.value ?? {}) as Record<string, unknown>;
  const template = typeof texts[kind] === "string" ? texts[kind] : "";
  const text = fillTemplate(template, {
    name: customerName(loan.customers),
    loan_no: loan.loan_no,
    amount: formatMoney(loan.principal_cents),
    due_date: formatDate(loan.due_date),
    outstanding: formatMoney(balance?.total_out ?? 0),
    days_overdue: String(balance?.days_overdue ?? 0),
    penalties: formatMoney(balance?.penalty_out ?? 0),
    branch: loan.branches.name,
    branch_phone: loan.branches.phone ?? "",
    company: company?.name ?? "",
  });
  const link = whatsappLink(loan.customers.phone, text);
  if (link === null) return new Response(t("noPhone"), { status: 409 });

  const { error } = await supabase.rpc("log_reminder_opened", { p_loan_id: loanId, p_kind: kind });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.staff.id, where: "reminder" });
    return new Response(code === "FORBIDDEN" ? t("forbidden") : t("notOpen"), {
      status: code === "FORBIDDEN" ? 403 : 409,
    });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: link, "Cache-Control": "private, no-store" },
  });
}
