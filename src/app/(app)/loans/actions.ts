"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff, type Staff } from "@/lib/auth/staff";
import { customerName, likePattern } from "@/lib/customers";
import { guarantorPayload } from "@/lib/guarantors";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { applicationSchema, termsSchema, type ApplicationValues, type TermsValues } from "./schemas";

const APPLY_ROLES: readonly Role[] = ["loan_officer", "manager"];
const uuid = /^[0-9a-f-]{36}$/;

async function applicant(): Promise<Staff | null> {
  const result = await getCurrentStaff();
  return result.status === "ok" && APPLY_ROLES.includes(result.staff.role) ? result.staff : null;
}

export interface CustomerHit {
  id: string;
  code: string;
  name: string;
  phone: string;
  branchId: string;
  assignedOfficerId: string | null;
}

/* Active customers the user may apply for (a loan officer: their own branch). */
export async function searchLoanCustomers(term: string): Promise<CustomerHit[]> {
  const staff = await applicant();
  const text = term.trim().slice(0, 100);
  if (staff === null || text.length < 2) return [];
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("customers")
    .select("id, code, type, first_name, last_name, business_name, phone, branch_id, assigned_officer_id")
    .eq("status", "active")
    .ilike("search_text", likePattern(text.toLowerCase()))
    .order("code")
    .limit(8);
  if (staff.role === "loan_officer" && staff.branch !== null) query = query.eq("branch_id", staff.branch.id);
  const { data, error } = await query;
  if (error !== null) {
    logServerError({ code: `READ_${error.code}`, userId: staff.id, where: "loans.searchLoanCustomers" });
    return [];
  }
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: customerName(row),
    phone: row.phone,
    branchId: row.branch_id,
    assignedOfficerId: row.assigned_officer_id,
  }));
}

export interface CollateralOption {
  id: string;
  code: string;
  description: string;
  valueCents: string;
  location: string | null;
}

/* The borrower's held items that do not secure another open loan (A-10). */
export async function customerCollateral(customerId: string): Promise<CollateralOption[]> {
  const staff = await applicant();
  if (staff === null || !uuid.test(customerId)) return [];
  const supabase = await createSupabaseServerClient();
  const [{ data: items, error }, { data: pledges, error: pledgeError }] = await Promise.all([
    supabase
      .from("collaterals")
      .select("id, code, description, estimated_value_cents, location_note")
      .eq("owner_customer_id", customerId)
      .eq("status", "held")
      .order("code"),
    supabase
      .from("loan_collaterals")
      .select("collateral_id, loans!inner(status)")
      .in("status", ["pledged", "seized"])
      .not("loans.status", "in", "(closed,written_off,cancelled,rejected)"),
  ]);
  if (error !== null || pledgeError !== null) return [];
  const busy = new Set(pledges.map((pledge) => pledge.collateral_id));
  return items
    .filter((item) => !busy.has(item.id))
    .map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      valueCents: String(item.estimated_value_cents),
      location: item.location_note,
    }));
}

export type PreviewResult =
  | {
      ok: true;
      interestCents: string;
      totalCents: string;
      dueDate: string;
      firstPenaltyOn: string | null;
      firstPenaltyCents: string | null;
      rateBps: number;
    }
  | { ok: false; code: ErrorCode };

/* preview_loan_terms (SPEC 5.1): the same SQL helpers as submission; no formula in TypeScript. */
export async function previewLoan(values: TermsValues): Promise<PreviewResult> {
  const staff = await applicant();
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = termsSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.principal) : null;
  if (!parsed.success || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_loan_terms", {
    p_principal_cents: Number(cents),
    p_product_id: parsed.data.productId,
    p_term_months: Number.parseInt(parsed.data.termMonths, 10),
  });
  if (error !== null) return { ok: false, code: errorCodeFrom(error) };
  const preview = data as Record<string, unknown>;
  return {
    ok: true,
    interestCents: String(preview.interest_cents),
    totalCents: String(preview.total_due_cents),
    dueDate: String(preview.due_date),
    firstPenaltyOn: typeof preview.first_penalty_on === "string" ? preview.first_penalty_on : null,
    firstPenaltyCents: preview.first_penalty_cents === null ? null : String(preview.first_penalty_cents),
    rateBps: Number(preview.interest_rate_bps),
  };
}

export type ApplyResult = { ok: true; loanId: string } | { ok: false; code: ErrorCode; step?: string };

/*
 * The application in the order SPEC 8 lists the RPCs: create_loan_draft (with guarantors),
 * register_collateral for new items, link_collateral, then submit_loan unless saving a draft. If a
 * later step fails, the draft is cancelled so no half-made application is left (its number stays
 * used, like any cancelled draft, B-02).
 */
export async function applyForLoan(values: ApplicationValues, submit: boolean): Promise<ApplyResult> {
  const staff = await applicant();
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = applicationSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.terms.principal) : null;
  if (!parsed.success || cents === null) return { ok: false, code: "INVALID_INPUT" };
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const fail = (
    error: { code?: string; message?: string },
    step: string,
  ): { ok: false; code: ErrorCode; step: string } => {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where: `loans.${step}` });
    return { ok: false, code, step };
  };

  const { data: loanId, error: draftError } = await supabase.rpc("create_loan_draft", {
    p_loan: {
      customer_id: data.customerId,
      product_id: data.terms.productId,
      principal_cents: Number(cents),
      term_months: Number.parseInt(data.terms.termMonths, 10),
      purpose: data.terms.purpose,
      ...(data.officerId === "" ? {} : { officer_id: data.officerId }),
      guarantors: data.guarantors.map((guarantor, index) => {
        const doc = data.guarantorDocs[index] ?? null;
        return {
          ...guarantorPayload(guarantor),
          ...(doc === null ? {} : { doc: { storage_path: doc.storagePath, file_name: doc.fileName } }),
        };
      }),
    },
  });
  if (draftError !== null) return fail(draftError, "draft");

  const undo = async (error: { code?: string; message?: string }, step: string) => {
    await supabase.rpc("cancel_loan", { p_loan_id: loanId, p_reason: "Application not completed" });
    return fail(error, step);
  };

  const collateralIds = [...data.collateralIds];
  for (const item of data.newCollateral) {
    const value = parseDollarsToCents(item.value);
    if (value === null) return undo({ message: "INVALID_STATE:" }, "collateral");
    const { data: itemId, error } = await supabase.rpc("register_collateral", {
      p_item: {
        owner_customer_id: data.customerId,
        type: item.type,
        description: item.description,
        serial_no: item.serialNo,
        plate_no: item.plateNo,
        document_no: item.documentNo,
        estimated_value_cents: Number(value),
        location_note: item.location,
      },
    });
    if (error !== null) return undo(error, "collateral");
    collateralIds.push(itemId);
  }
  for (const collateralId of collateralIds) {
    const { error } = await supabase.rpc("link_collateral", {
      p_loan_id: loanId,
      p_collateral_id: collateralId,
    });
    if (error !== null) return undo(error, "pledge");
  }
  if (submit) {
    const { error } = await supabase.rpc("submit_loan", { p_loan_id: loanId });
    if (error !== null) return undo(error, "submit");
  }
  revalidatePath("/loans");
  revalidatePath("/approvals");
  return { ok: true, loanId };
}

export type LoanActionResult = { ok: true } | { ok: false; code: ErrorCode };

async function loanRpc(
  where: string,
  roles: readonly Role[],
  call: (supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) => PromiseLike<{
    error: { code?: string; message?: string } | null;
  }>,
  loanId: string,
): Promise<LoanActionResult> {
  const result = await getCurrentStaff();
  if (result.status !== "ok" || !roles.includes(result.staff.role)) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(loanId)) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await call(supabase);
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({ code: `RPC_${error.code ?? ""}`, userId: result.staff.id, where });
    return { ok: false, code };
  }
  revalidatePath(`/loans/${loanId}`);
  revalidatePath("/loans");
  revalidatePath("/", "layout");
  return { ok: true };
}

/* submit_loan: the draft's creator sends it for approval. */
export async function submitDraft(loanId: string): Promise<LoanActionResult> {
  return loanRpc(
    "loans.submitDraft",
    APPLY_ROLES,
    (supabase) => supabase.rpc("submit_loan", { p_loan_id: loanId }),
    loanId,
  );
}

/* cancel_loan: a draft by its creator; an approved, unpaid loan by its creator or a manager. */
export async function cancelLoan(loanId: string, reason: string): Promise<LoanActionResult> {
  const trimmed = reason.trim().slice(0, 300);
  return loanRpc(
    "loans.cancelLoan",
    ["loan_officer", "manager", "ceo"],
    (supabase) => supabase.rpc("cancel_loan", { p_loan_id: loanId, p_reason: trimmed }),
    loanId,
  );
}

/* disburse_loan (cashier, R1): today's date; the account follows the method (B-10, SPEC 5.4.5). */
export async function disburseLoan(
  loanId: string,
  method: "cash" | "mobile_money" | "bank",
): Promise<LoanActionResult> {
  if (!["cash", "mobile_money", "bank"].includes(method)) return { ok: false, code: "INVALID_INPUT" };
  return loanRpc(
    "loans.disburseLoan",
    ["cashier"],
    (supabase) => supabase.rpc("disburse_loan", { p_loan_id: loanId, p_method: method }),
    loanId,
  );
}

/* request_extension (SPEC 5.6; FR-18): a loan officer (own branch) or a manager, with a reason. */
export async function requestExtension(
  loanId: string,
  extraMonths: number,
  reason: string,
): Promise<LoanActionResult> {
  const trimmed = reason.trim().slice(0, 300);
  if (!Number.isInteger(extraMonths) || extraMonths < 1 || extraMonths > 36) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const result = await loanRpc(
    "loans.requestExtension",
    ["loan_officer", "manager"],
    (supabase) =>
      supabase.rpc("request_extension", {
        p_loan_id: loanId,
        p_extra_months: extraMonths,
        p_reason: trimmed,
      }),
    loanId,
  );
  if (result.ok) revalidatePath("/approvals");
  return result;
}
