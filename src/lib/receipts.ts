import "server-only";

import { customerName } from "@/lib/customers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * The facts printed on a receipt (SPEC 10.1), for the screen and the PDF. issue_document gives the
 * receipt its verification token on first view and the same token on every reprint; a voided
 * payment's receipt comes back marked void.
 */
export interface ReceiptFacts {
  paymentId: string;
  receiptNo: string;
  token: string;
  isVoid: boolean;
  receivedOn: string;
  receivedAt: string;
  customer: string;
  loanId: string;
  loanNo: string;
  method: "cash" | "mobile_money" | "bank";
  reference: string | null;
  amountCents: string;
  allocation: { penalty: string; interest: string; principal: string };
  balanceAfterCents: string;
  receivedBy: string;
  branch: string;
  collectedInField: boolean;
}

export type ReceiptResult = { ok: true; receipt: ReceiptFacts } | { ok: false; status: 404 | 403 | 500 };

export async function loadReceipt(paymentId: string): Promise<ReceiptResult> {
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) return { ok: false, status: 404 };
  const supabase = await createSupabaseServerClient();
  const { data: payment, error } = await supabase
    .from("payments")
    .select(
      "id, receipt_no, received_on, received_at, amount_cents, method, reference, received_by, collected_in_field, loan_id, loans!inner(loan_no), customers!inner(type, first_name, last_name, business_name), branches!inner(name)",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (error !== null) return { ok: false, status: 500 };
  if (payment === null) return { ok: false, status: 404 };

  const [documentResult, balanceResult, allocationsResult, receiverResult] = await Promise.all([
    supabase.rpc("issue_document", { p_kind: "receipt", p_entity_id: paymentId }),
    supabase.rpc("receipt_balance_after", { p_payment_id: paymentId }),
    supabase.from("payment_allocations").select("component, amount_cents").eq("payment_id", paymentId),
    supabase.from("profiles").select("full_name").eq("id", payment.received_by).maybeSingle(),
  ]);
  if (documentResult.error !== null || balanceResult.error !== null || allocationsResult.error !== null) {
    const forbidden = [documentResult.error, balanceResult.error].some((item) => item?.code === "42501");
    return { ok: false, status: forbidden ? 403 : 500 };
  }
  const document = documentResult.data as { token: string; is_void: boolean };
  const parts = new Map(allocationsResult.data.map((row) => [row.component, String(row.amount_cents)]));

  return {
    ok: true,
    receipt: {
      paymentId,
      receiptNo: payment.receipt_no,
      token: document.token,
      isVoid: document.is_void,
      receivedOn: payment.received_on,
      receivedAt: payment.received_at,
      customer: customerName(payment.customers),
      loanId: payment.loan_id,
      loanNo: payment.loans.loan_no,
      method: payment.method as ReceiptFacts["method"],
      reference: payment.reference,
      amountCents: String(payment.amount_cents),
      allocation: {
        penalty: parts.get("penalty") ?? "0",
        interest: parts.get("interest") ?? "0",
        principal: parts.get("principal") ?? "0",
      },
      balanceAfterCents: String(balanceResult.data),
      receivedBy: receiverResult.data?.full_name ?? "",
      branch: payment.branches.name,
      collectedInField: payment.collected_in_field,
    },
  };
}
