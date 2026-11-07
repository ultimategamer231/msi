import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";

import { getCurrentStaff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { customerName } from "@/lib/customers";
import { formatDate, formatDateTime, formatMoney, formatRateBps } from "@/lib/format";
import { logServerError } from "@/lib/log";
import { renderLoanAgreement } from "@/lib/pdf/loan-agreement";
import { renderReceipt } from "@/lib/pdf/receipt";
import { loadReceipt } from "@/lib/receipts";
import { errorCodeFrom } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fillTemplate } from "@/lib/template";

/*
 * PDF documents (SPEC 10.1): /api/pdf/<kind>/<id>. Signed-in staff only; issue_document numbers
 * the document and gives it a verification token on first print, and returns the same row on a
 * reprint. Loan agreement (M3) and receipt (M4; `?paper=80mm` for the thermal roll); other kinds
 * follow in M5–M7.
 */
const KINDS = ["loan_agreement", "receipt"] as const;

async function logoBytes(url: string | null): Promise<Buffer | null> {
  if (url === null) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  const staff = await getCurrentStaff();
  if (staff.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (!(KINDS as readonly string[]).includes(kind) || !/^[0-9a-f-]{36}$/.test(id)) {
    return new Response("Not found.", { status: 404 });
  }
  if (kind === "receipt") return receiptPdf(request, id);

  const supabase = await createSupabaseServerClient();
  const { data: document, error } = await supabase.rpc("issue_document", { p_kind: kind, p_entity_id: id });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.staff.id, where: "pdf.issue" });
    return new Response(code === "FORBIDDEN" ? "Not allowed." : "This document cannot be printed yet.", {
      status: code === "FORBIDDEN" ? 403 : 409,
    });
  }
  const doc = document as { number: string; token: string; generated_at: string; generated_by: string };

  const [loanResult, pledgesResult, guarantorsResult, templatesResult, peopleResult, company, t] =
    await Promise.all([
      supabase
        .from("loans")
        .select(
          "*, customers!inner(code, type, first_name, last_name, business_name, phone, address, city, id_type, id_number), loan_products!inner(name), branches!inner(name)",
        )
        .eq("id", id)
        .single(),
      supabase
        .from("loan_collaterals")
        .select(
          "collaterals!inner(code, description, serial_no, plate_no, chassis_no, document_no, estimated_value_cents)",
        )
        .eq("loan_id", id)
        .in("status", ["pledged", "seized"]),
      supabase
        .from("guarantors")
        .select("full_name, phone, relationship, id_type, id_number")
        .eq("loan_id", id)
        .order("created_at"),
      supabase.from("settings").select("value").eq("key", "templates").single(),
      supabase.from("profiles").select("id, full_name"),
      getCompany(),
      getTranslations("pdf.agreement"),
    ]);
  if (loanResult.error !== null || pledgesResult.error !== null || guarantorsResult.error !== null) {
    logServerError({ code: "PDF_READ", userId: staff.staff.id, where: "pdf.loan_agreement" });
    return new Response("Could not read the loan.", { status: 500 });
  }
  const loan = loanResult.data;
  const customer = loan.customers;
  const people = new Map((peopleResult.data ?? []).map((person) => [person.id, person.full_name]));
  const templates = (templatesResult.data?.value ?? {}) as Record<string, unknown>;
  const companyName = company?.name ?? "";
  const verifyUrl = `${request.nextUrl.origin}/verify/${doc.token}`;
  const tIdTypes = await getTranslations("customers.form.idTypes");
  const idText = (type: string | null, number: string | null) =>
    number === null ? "" : `${type === null ? "" : `${tIdTypes(type as "national_id")} `}${number}`;

  const buffer = await renderLoanAgreement({
    company: {
      name: companyName,
      address: company?.address ?? "",
      phone: company?.phone ?? "",
      email: company?.email ?? "",
      logo: await logoBytes(company?.logoUrl ?? null),
    },
    number: doc.number,
    generatedAt: formatDateTime(doc.generated_at),
    preparedBy: people.get(doc.generated_by) ?? staff.staff.fullName,
    qrDataUrl: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 256 }),
    verifyUrl,
    loan: {
      loanNo: loan.loan_no,
      product: loan.loan_products.name,
      branch: loan.branches.name,
      officer: loan.officer_id === null ? "" : (people.get(loan.officer_id) ?? ""),
      principal: formatMoney(loan.principal_cents),
      interest: formatMoney(loan.interest_cents ?? 0),
      total: formatMoney(BigInt(loan.principal_cents) + BigInt(loan.interest_cents ?? 0)),
      rate: t("rate", { rate: formatRateBps(loan.interest_rate_bps ?? 0), months: loan.term_months }),
      term: t("term", { months: loan.term_months }),
      dueDate:
        loan.due_date === null ? t("dueAtPayout", { months: loan.term_months }) : formatDate(loan.due_date),
      purpose: loan.purpose ?? "",
    },
    borrower: {
      name: customerName(customer),
      code: customer.code,
      id: idText(customer.id_type, customer.id_number),
      phone: customer.phone,
      address:
        [customer.address, customer.city].filter((part) => part !== null && part !== "").join(", ") ||
        t("none"),
    },
    terms: fillTemplate(typeof templates.loan_agreement === "string" ? templates.loan_agreement : "", {
      penalty_rate: formatRateBps(loan.penalty_rate_bps ?? 0),
      penalty_days: String(loan.penalty_period_days ?? ""),
      penalty_max: String(loan.penalty_max_periods ?? ""),
      company: companyName,
      total: formatMoney(BigInt(loan.principal_cents) + BigInt(loan.interest_cents ?? 0)),
    }),
    collateral: (pledgesResult.data ?? []).map(({ collaterals: item }) => ({
      code: item.code,
      description: item.description,
      identifier: [item.serial_no, item.plate_no, item.chassis_no, item.document_no]
        .filter((part) => part !== null)
        .join(", "),
      value: formatMoney(item.estimated_value_cents),
    })),
    guarantors: (guarantorsResult.data ?? []).map((guarantor) => ({
      name: guarantor.full_name,
      relationship: guarantor.relationship ?? "",
      phone: guarantor.phone,
      id: idText(guarantor.id_type, guarantor.id_number),
    })),
    labels: {
      title: t("title"),
      loanLine: t("loanLine", { loan: loan.loan_no }),
      parties: t("parties"),
      lender: t("lender"),
      borrower: t("borrower"),
      borrowerId: t("borrowerId"),
      borrowerPhone: t("borrowerPhone"),
      borrowerAddress: t("borrowerAddress"),
      branch: t("branch"),
      loan: t("loan"),
      principal: t("principal"),
      interest: t("interest"),
      total: t("total"),
      term: t("termLabel"),
      dueDate: t("dueDate"),
      product: t("product"),
      purpose: t("purpose"),
      terms: t("terms"),
      collateral: t("collateral"),
      item: t("item"),
      description: t("description"),
      identifier: t("identifier"),
      value: t("value"),
      guarantors: t("guarantors"),
      none: t("none"),
      signBorrower: t("signBorrower"),
      signGuarantor: t("signGuarantor"),
      signCompany: t("signCompany", { company: companyName }),
      dateLine: t("dateLine"),
      preparedBy: t("preparedBy", { name: people.get(doc.generated_by) ?? staff.staff.fullName }),
      verify: t("verify"),
    },
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function receiptPdf(request: NextRequest, paymentId: string): Promise<Response> {
  const result = await loadReceipt(paymentId);
  if (!result.ok) {
    const text = { 403: "Not allowed.", 404: "Not found.", 500: "Could not read the receipt." }[
      result.status
    ];
    return new Response(text, { status: result.status });
  }
  const receipt = result.receipt;
  const supabase = await createSupabaseServerClient();
  const [company, { data: now }, t, tMethods] = await Promise.all([
    getCompany(),
    supabase.rpc("app_now"),
    getTranslations("receipts"),
    getTranslations("payments.methods"),
  ]);
  const paper = request.nextUrl.searchParams.get("paper") === "80mm" ? "80mm" : "a5";
  const verifyUrl = `${request.nextUrl.origin}/verify/${receipt.token}`;
  const buffer = await renderReceipt({
    paper,
    company: {
      name: company?.name ?? "",
      contact: [company?.address ?? "", company?.phone ?? ""].filter((part) => part !== "").join(" · "),
      footer: company?.receiptFooter ?? "",
      logo: await logoBytes(company?.logoUrl ?? null),
    },
    receiptNo: receipt.receiptNo,
    date: formatDate(receipt.receivedOn),
    customer: receipt.customer,
    loanNo: receipt.loanNo,
    method:
      receipt.reference === null
        ? tMethods(receipt.method)
        : `${tMethods(receipt.method)} · ${receipt.reference}`,
    amount: formatMoney(receipt.amountCents),
    allocation: {
      penalty: formatMoney(receipt.allocation.penalty),
      interest: formatMoney(receipt.allocation.interest),
      principal: formatMoney(receipt.allocation.principal),
    },
    balanceAfter: formatMoney(receipt.balanceAfterCents),
    receivedBy: receipt.receivedBy,
    isVoid: receipt.isVoid,
    qrDataUrl: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 256 }),
    labels: {
      official: t("official", { branch: receipt.branch }),
      number: t("number"),
      date: t("date"),
      from: t("from"),
      loan: t("loan"),
      method: t("method"),
      amount: t("amount"),
      penalty: t("applied.penalty"),
      interest: t("applied.interest"),
      principal: t("applied.principal"),
      balanceAfter: t("balanceAfter"),
      receivedBy: t("receivedBy"),
      printed: t("printed", { when: formatDateTime(now ?? receipt.receivedAt) }),
      scan: t("scan"),
      void: t("void"),
    },
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${receipt.receiptNo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
