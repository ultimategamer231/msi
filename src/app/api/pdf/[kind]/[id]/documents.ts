import "server-only";

import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";

import type { Staff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { customerName } from "@/lib/customers";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { logServerError } from "@/lib/log";
import { renderOfficialDocument, type Block } from "@/lib/pdf/document";
import { errorCodeFrom } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fillTemplate } from "@/lib/template";

/*
 * Builders for the M7 PDFs (SPEC 10.1): statement, demand notice, collateral receipt and release
 * letter. Numbers, tokens, balances and allocations come from the database (issue_document,
 * loan_statement); this file formats and lays them out.
 */
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Issued = {
  number: string;
  token: string;
  generated_at: string;
  generated_by: string;
  details: Record<string, string> | null;
};

export async function logoBytes(url: string | null): Promise<Buffer | null> {
  if (url === null) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function pdfResponse(buffer: Buffer, number: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function issue(
  supabase: Supabase,
  staff: Staff,
  kind: string,
  id: string,
  options: Record<string, string> = {},
): Promise<{ ok: true; doc: Issued } | { ok: false; response: Response }> {
  const { data, error } = await supabase.rpc("issue_document", {
    p_kind: kind,
    p_entity_id: id,
    p_options: options,
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code}`, userId: staff.id, where: `pdf.${kind}` });
    return {
      ok: false,
      response: new Response(code === "FORBIDDEN" ? "Not allowed." : "This document cannot be printed.", {
        status: code === "FORBIDDEN" ? 403 : 409,
      }),
    };
  }
  return { ok: true, doc: data as Issued };
}

async function frame(request: NextRequest, supabase: Supabase, staff: Staff, doc: Issued) {
  const [company, people, tCommon] = await Promise.all([
    getCompany(),
    supabase.from("profiles").select("full_name").eq("id", doc.generated_by).maybeSingle(),
    getTranslations("pdf.common"),
  ]);
  const verifyUrl = `${request.nextUrl.origin}/verify/${doc.token}`;
  return {
    company: {
      name: company?.name ?? "",
      contact: [company?.address ?? "", company?.phone ?? "", company?.email ?? ""]
        .filter((part) => part !== "")
        .join(" · "),
      logo: await logoBytes(company?.logoUrl ?? null),
    },
    companyName: company?.name ?? "",
    number: doc.number,
    generatedAt: formatDateTime(doc.generated_at),
    preparedBy: tCommon("preparedBy", { name: people.data?.full_name ?? staff.fullName }),
    qrDataUrl: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 256 }),
    verifyUrl,
    verifyLabel: tCommon("verify"),
  };
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

interface StatementJson {
  loan_no: string;
  from: string;
  to: string;
  opening_cents: number;
  debit_cents: number;
  credit_cents: number;
  closing_cents: number;
  outstanding: { penalty: number; interest: number; principal: number };
  due_date: string | null;
  next_penalty_on: string | null;
  lines: Array<{
    date: string;
    source_type: string;
    memo: string;
    receipt_no: string | null;
    penalty_period: number | null;
    reversal: boolean;
    debit_cents: number;
    credit_cents: number;
    balance_cents: number;
  }>;
}

/* Statement of account (SPEC 10.1; FR-14): one loan, or every paid-out loan of a customer. */
export async function statementPdf(request: NextRequest, staff: Staff, id: string): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const options: Record<string, string> = {};
  if (isoDate.test(from)) options.from = from;
  if (isoDate.test(to)) options.to = to;
  const issued = await issue(supabase, staff, "statement", id, options);
  if (!issued.ok) return issued.response;
  const t = await getTranslations("pdf.statement");

  const { data: loan } = await supabase.from("loans").select("id, customer_id").eq("id", id).maybeSingle();
  const customerId = loan?.customer_id ?? id;
  const [{ data: customer }, { data: loans }] = await Promise.all([
    supabase
      .from("customers")
      .select("code, type, first_name, last_name, business_name, phone")
      .eq("id", customerId)
      .single(),
    loan !== null
      ? Promise.resolve({ data: [{ id: loan.id }] })
      : supabase
          .from("loans")
          .select("id")
          .eq("customer_id", customerId)
          .not("disbursed_on", "is", null)
          .order("loan_no"),
  ]);
  const statements: StatementJson[] = [];
  for (const row of loans ?? []) {
    const { data } = await supabase.rpc("loan_statement", {
      p_loan_id: row.id,
      ...(options.from !== undefined && loan !== null ? { p_from: options.from } : {}),
      ...(options.to !== undefined ? { p_to: options.to } : {}),
    });
    if (data !== null) statements.push(data as unknown as StatementJson);
  }

  const describe = (line: StatementJson["lines"][number]) => {
    switch (line.source_type) {
      case "disbursement":
        return t("lines.disbursement");
      case "payment":
      case "field_payment":
        return t("lines.payment", { receipt: line.receipt_no ?? "" });
      case "payment_void":
        return t("lines.void", { receipt: line.receipt_no ?? "" });
      case "penalty":
        return t("lines.penalty", { week: line.penalty_period ?? 0 });
      case "extension":
        return t("lines.extension");
      case "collateral_sale":
        return t("lines.sale");
      case "write_off":
        return t("lines.writeOff");
      default:
        return line.memo;
    }
  };
  const blocks: Block[] = [
    {
      type: "details",
      items: [
        {
          label: t("customer"),
          value: `${customer === null ? "" : customerName(customer)} (${customer?.code ?? ""})`,
        },
        { label: t("phone"), value: customer?.phone ?? "" },
        {
          label: t("period"),
          value:
            statements.length === 1 && statements[0] !== undefined
              ? t("periodValue", { from: formatDate(statements[0].from), to: formatDate(statements[0].to) })
              : t("asAt", { date: formatDate(issued.doc.details?.to ?? to) }),
        },
        {
          label: t("loans"),
          value: statements.map((statement) => statement.loan_no).join(", ") || t("none"),
        },
      ],
    },
  ];
  for (const statement of statements) {
    blocks.push({
      type: "table",
      heading: t("loanHeading", { loan: statement.loan_no }),
      columns: [
        { label: t("columns.date"), width: "16%" },
        { label: t("columns.description"), width: "39%" },
        { label: t("columns.debit"), width: "15%", align: "right" },
        { label: t("columns.credit"), width: "15%", align: "right" },
        { label: t("columns.balance"), width: "15%", align: "right" },
      ],
      rows: [
        [formatDate(statement.from), t("opening"), "", "", formatMoney(statement.opening_cents)],
        ...statement.lines.map((line) => [
          formatDate(line.date),
          describe(line),
          line.debit_cents > 0 ? formatMoney(line.debit_cents) : "",
          line.credit_cents > 0 ? formatMoney(line.credit_cents) : "",
          formatMoney(line.balance_cents),
        ]),
      ],
      total: [
        formatDate(statement.to),
        t("totals"),
        formatMoney(statement.debit_cents),
        formatMoney(statement.credit_cents),
        formatMoney(statement.closing_cents),
      ],
    });
    blocks.push({
      type: "details",
      boxed: true,
      items: [
        { label: t("outstanding.penalty"), value: formatMoney(statement.outstanding.penalty) },
        { label: t("outstanding.interest"), value: formatMoney(statement.outstanding.interest) },
        { label: t("outstanding.principal"), value: formatMoney(statement.outstanding.principal) },
        { label: t("outstanding.total"), value: formatMoney(statement.closing_cents) },
        ...(statement.closing_cents > 0 && statement.due_date !== null
          ? [{ label: t("dueDate"), value: formatDate(statement.due_date) }]
          : []),
        ...(statement.closing_cents > 0 && statement.next_penalty_on !== null
          ? [{ label: t("nextPenalty"), value: formatDate(statement.next_penalty_on) }]
          : []),
      ],
    });
  }
  if (statements.length > 1) {
    blocks.push({
      type: "text",
      strong: true,
      text: t("customerTotal", {
        amount: formatMoney(statements.reduce((sum, statement) => sum + BigInt(statement.closing_cents), 0n)),
      }),
    });
  }
  const base = await frame(request, supabase, staff, issued.doc);
  return pdfResponse(await renderOfficialDocument({ ...base, title: t("title"), blocks }), issued.doc.number);
}

/* Demand notice (SPEC 10.1, 5.7): what is owed, the deadline and the placeholder legal wording. */
export async function demandNoticePdf(request: NextRequest, staff: Staff, id: string): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const issued = await issue(supabase, staff, "demand_notice", id);
  if (!issued.ok) return issued.response;
  const t = await getTranslations("pdf.notice");
  const [{ data: loan }, { data: balance }, { data: templates }, { data: pledges }] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "loan_no, due_date, principal_cents, customers!inner(type, first_name, last_name, business_name, phone, address, city), branches!inner(name, phone)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("loan_balances")
      .select("principal_out, interest_out, penalty_out, total_out, days_overdue")
      .eq("loan_id", id)
      .maybeSingle(),
    supabase.from("settings").select("value").eq("key", "templates").maybeSingle(),
    supabase
      .from("loan_collaterals")
      .select("collaterals!inner(code, description, plate_no, serial_no, document_no, estimated_value_cents)")
      .eq("loan_id", id)
      .in("status", ["pledged", "seized"]),
  ]);
  if (loan === null) return new Response("Not found.", { status: 404 });
  const base = await frame(request, supabase, staff, issued.doc);
  const deadline = issued.doc.details?.deadline ?? "";
  const texts = (templates?.value ?? {}) as Record<string, unknown>;
  const name = customerName(loan.customers);
  const blocks: Block[] = [
    {
      type: "details",
      heading: t("to"),
      items: [
        { label: t("borrower"), value: name },
        { label: t("phone"), value: loan.customers.phone },
        {
          label: t("address"),
          value:
            [loan.customers.address, loan.customers.city]
              .filter((part) => part !== null && part !== "")
              .join(", ") || "–",
        },
        { label: t("loan"), value: loan.loan_no },
      ],
    },
    {
      type: "details",
      heading: t("owed"),
      boxed: true,
      items: [
        { label: t("dueDate"), value: loan.due_date === null ? "" : formatDate(loan.due_date) },
        { label: t("daysOverdue"), value: String(balance?.days_overdue ?? 0) },
        { label: t("principal"), value: formatMoney(balance?.principal_out ?? 0) },
        { label: t("interest"), value: formatMoney(balance?.interest_out ?? 0) },
        { label: t("penalties"), value: formatMoney(balance?.penalty_out ?? 0) },
        { label: t("total"), value: formatMoney(balance?.total_out ?? 0) },
        { label: t("deadline"), value: deadline === "" ? "" : formatDate(deadline) },
      ],
    },
    {
      type: "text",
      heading: t("notice"),
      text: fillTemplate(typeof texts.demand_notice === "string" ? texts.demand_notice : "", {
        loan_no: loan.loan_no,
        due_date: loan.due_date === null ? "" : formatDate(loan.due_date),
        days_overdue: String(balance?.days_overdue ?? 0),
        outstanding: formatMoney(balance?.total_out ?? 0),
        penalties: formatMoney(balance?.penalty_out ?? 0),
        branch: loan.branches.name,
        deadline: deadline === "" ? "" : formatDate(deadline),
        company: base.companyName,
      }),
    },
    {
      type: "table",
      heading: t("collateral"),
      columns: [
        { label: t("item"), width: "20%" },
        { label: t("description"), width: "40%" },
        { label: t("identifier"), width: "22%" },
        { label: t("value"), width: "18%", align: "right" },
      ],
      rows: (pledges ?? []).map(({ collaterals: item }) => [
        item.code,
        item.description,
        [item.plate_no, item.serial_no, item.document_no].find((part) => part !== null) ?? "",
        formatMoney(item.estimated_value_cents),
      ]),
    },
    {
      type: "signatures",
      items: [
        { label: t("signCompany", { company: base.companyName }), name: base.preparedBy },
        { label: t("signReceived"), name },
      ],
      dateLine: t("dateLine"),
    },
  ];
  return pdfResponse(
    await renderOfficialDocument({
      ...base,
      title: t("title"),
      subtitle: t("subtitle", { loan: loan.loan_no }),
      blocks,
    }),
    issued.doc.number,
  );
}

/* Collateral receipt and release letter (SPEC 10.1; FR-15, FR-16). */
export async function collateralPdf(
  request: NextRequest,
  staff: Staff,
  kind: "collateral_receipt" | "collateral_release",
  id: string,
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const issued = await issue(supabase, staff, kind, id);
  if (!issued.ok) return issued.response;
  const t = await getTranslations("pdf.collateral");
  const tTypes = await getTranslations("loans.wizard.types");
  const [{ data: item }, { data: pledges }, { data: photos }, { data: release }] = await Promise.all([
    supabase
      .from("collaterals")
      .select(
        "*, customers!inner(code, type, first_name, last_name, business_name, phone), branches!inner(name)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("loan_collaterals")
      .select("pledged_on, released_on, loans!inner(loan_no, status, closed_on)")
      .eq("collateral_id", id),
    supabase
      .from("attachments")
      .select("storage_path, mime")
      .eq("entity_type", "collateral")
      .eq("entity_id", id)
      .eq("kind", "photo")
      .order("created_at")
      .limit(3),
    supabase
      .from("collateral_events")
      .select("at, note, witness_name")
      .eq("collateral_id", id)
      .eq("event_type", "released")
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (item === null) return new Response("Not found.", { status: 404 });
  const base = await frame(request, supabase, staff, issued.doc);
  const owner = customerName(item.customers);
  const images: Buffer[] = [];
  const imagePaths = (photos ?? [])
    .filter((photo) => ["image/jpeg", "image/png"].includes(photo.mime))
    .map((photo) => photo.storage_path);
  if (kind === "collateral_receipt" && imagePaths.length > 0) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(imagePaths, 120);
    for (const entry of urls ?? []) {
      if (entry.signedUrl === null) continue;
      const bytes = await logoBytes(entry.signedUrl);
      if (bytes !== null) images.push(bytes);
    }
  }
  const loanNos = (pledges ?? []).map((pledge) => pledge.loans.loan_no).join(", ") || "–";
  const details: Block = {
    type: "details",
    heading: t("item"),
    boxed: true,
    items: [
      { label: t("code"), value: item.code },
      { label: t("type"), value: tTypes(item.type as "vehicle") },
      { label: t("description"), value: item.description },
      ...(item.serial_no !== null ? [{ label: t("serial"), value: item.serial_no }] : []),
      ...(item.plate_no !== null ? [{ label: t("plate"), value: item.plate_no }] : []),
      ...(item.chassis_no !== null ? [{ label: t("chassis"), value: item.chassis_no }] : []),
      ...(item.document_no !== null ? [{ label: t("document"), value: item.document_no }] : []),
      { label: t("value"), value: formatMoney(item.estimated_value_cents) },
      { label: t("owner"), value: `${owner} (${item.customers.code})` },
      { label: t("loans"), value: loanNos },
    ],
  };
  const blocks: Block[] =
    kind === "collateral_receipt"
      ? [
          details,
          {
            type: "details",
            items: [
              { label: t("location"), value: item.location_note ?? "–" },
              { label: t("branch"), value: item.branches.name },
            ],
          },
          { type: "images", heading: t("photos"), images },
          {
            type: "text",
            heading: t("custody"),
            text: t("custodyText", { company: base.companyName, loans: loanNos }),
          },
          {
            type: "signatures",
            items: [
              { label: t("signOwner"), name: owner },
              { label: t("signCompany", { company: base.companyName }), name: base.preparedBy },
            ],
            dateLine: t("dateLine"),
          },
        ]
      : [
          details,
          {
            type: "text",
            heading: t("release"),
            text: t("releaseText", {
              loans: loanNos,
              date: release === null ? "" : formatDate(release.at.slice(0, 10)),
              company: base.companyName,
            }),
          },
          ...(release?.witness_name
            ? [{ type: "text" as const, text: t("collectedBy", { name: release.witness_name }) }]
            : []),
          {
            type: "signatures",
            items: [
              { label: t("signReturned"), name: owner },
              { label: t("signCompany", { company: base.companyName }), name: base.preparedBy },
            ],
            dateLine: t("dateLine"),
          },
        ];
  return pdfResponse(
    await renderOfficialDocument({
      ...base,
      title: t(kind === "collateral_receipt" ? "receiptTitle" : "releaseTitle"),
      subtitle: item.description,
      blocks,
    }),
    issued.doc.number,
  );
}
