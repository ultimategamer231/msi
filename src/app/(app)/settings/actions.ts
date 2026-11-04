"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import { generatePassword } from "@/lib/password";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import {
  branchSchema,
  clockSchema,
  companySchema,
  newUserSchema,
  rulesSchema,
  templatesSchema,
  userSchema,
  type BranchValues,
  type ClockValues,
  type CompanyValues,
  type NewUserValues,
  type RulesValues,
  type TemplatesValues,
  type UserValues,
} from "./schemas";

/*
 * Settings and user administration (FR-01, FR-02). Every action checks the admin role itself and
 * every change goes through an audited Postgres function (FR-26). The service role is used only
 * for Supabase Auth administration (SPEC 8).
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; code: ErrorCode };

const LOGO_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const LOGO_MAX_BYTES = 10 * 1024 * 1024; // SPEC 11: 10 MB

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; code: ErrorCode }> {
  const result = await getCurrentStaff();
  if (result.status !== "ok" || result.staff.role !== "admin") return { ok: false, code: "FORBIDDEN" };
  return { ok: true, userId: result.staff.id };
}

function fail(code: ErrorCode, where: string, userId?: string): { ok: false; code: ErrorCode } {
  if (code === "UNKNOWN") logServerError({ code, userId, where });
  return { ok: false, code };
}

async function updateSetting(
  key: string,
  value: Json,
  where: string,
  userId: string,
): Promise<ErrorCode | null> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_setting", { p_key: key, p_value: value });
  if (error === null) return null;
  const code = errorCodeFrom(error);
  if (code === "UNKNOWN") logServerError({ code: `RPC_${error.code}`, userId, where });
  return code;
}

async function currentSetting(key: string): Promise<Json | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

/*
 * Postgres cannot declare function arguments nullable, so generated RPC types show `string` for
 * arguments that accept SQL NULL (the functions handle null explicitly). This is the one place
 * that passes null through.
 */
function sqlNullable(value: string | null): string {
  return value as string;
}

function done<T>(data: T): ActionResult<T> {
  revalidatePath("/settings");
  return { ok: true, data };
}

export async function saveCompany(values: CompanyValues): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = companySchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.saveCompany");
  const existing = await currentSetting("company");
  const logoPath =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? (existing.logo_path ?? null)
      : null;
  const code = await updateSetting(
    "company",
    {
      name: parsed.data.name,
      short_name: parsed.data.shortName,
      address: parsed.data.address,
      phone: parsed.data.phone,
      email: parsed.data.email,
      receipt_footer: parsed.data.receiptFooter,
      logo_path: logoPath,
    },
    "settings.saveCompany",
    admin.userId,
  );
  return code === null ? done(undefined) : { ok: false, code };
}

export async function uploadLogo(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const file = formData.get("logo");
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > LOGO_MAX_BYTES ||
    LOGO_TYPES[file.type] === undefined
  ) {
    return { ok: false, code: "UPLOAD_REJECTED" };
  }
  const objectName = `logo-${randomUUID()}.${LOGO_TYPES[file.type] ?? "png"}`;
  const supabase = await createSupabaseServerClient();
  const { error: uploadError } = await supabase.storage
    .from("branding")
    .upload(objectName, file, { contentType: file.type, upsert: false });
  if (uploadError !== null) return fail("UNKNOWN", "settings.uploadLogo", admin.userId);

  const existing = await currentSetting("company");
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    return fail("UNKNOWN", "settings.uploadLogo", admin.userId);
  }
  const code = await updateSetting(
    "company",
    { ...existing, logo_path: `branding/${objectName}` },
    "settings.uploadLogo",
    admin.userId,
  );
  return code === null ? done(undefined) : { ok: false, code };
}

export async function saveTemplates(values: TemplatesValues): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = templatesSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.saveTemplates");
  const existing = await currentSetting("templates");
  const base = existing !== null && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const code = await updateSetting(
    "templates",
    { ...base, reminder: parsed.data.reminder, reminder_overdue: parsed.data.reminderOverdue },
    "settings.saveTemplates",
    admin.userId,
  );
  return code === null ? done(undefined) : { ok: false, code };
}

export async function saveBranch(values: BranchValues): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = branchSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.saveBranch");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("upsert_branch", {
    p_branch: {
      ...(parsed.data.id === undefined ? {} : { id: parsed.data.id }),
      code: parsed.data.code,
      name: parsed.data.name,
      address: parsed.data.address,
      phone: parsed.data.phone,
      active: parsed.data.active,
    },
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    return fail(code, "settings.saveBranch", admin.userId);
  }
  return done({ id: data });
}

/* Each changed rule is saved through update_setting, so each change has its own audit row. */
export async function saveRules(values: RulesValues): Promise<ActionResult<{ changed: number }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = rulesSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.saveRules");
  const loanLimit = parseDollarsToCents(parsed.data.loanManagerLimit);
  const expenseLimit = parseDollarsToCents(parsed.data.expenseLimit);
  if (loanLimit === null || expenseLimit === null) return fail("INVALID_INPUT", "settings.saveRules");

  const supabase = await createSupabaseServerClient();
  const { data: rows, error: readError } = await supabase.from("settings").select("key, value");
  if (readError !== null) return fail("UNKNOWN", "settings.saveRules", admin.userId);
  const current = new Map(rows.map((row) => [row.key, JSON.stringify(row.value)]));

  // Whole cents are sent as JSON numbers; Number() is exact here because limits are far below 2^53.
  const next: Array<[string, Json]> = [
    ["approvals.loan_manager_limit_cents", Number(loanLimit)],
    ["approvals.expense_limit_cents", Number(expenseLimit)],
    ["loans.collateral_required", parsed.data.collateralRequired],
    ["collateral.multi_loan", parsed.data.multiLoan],
    ["extension.enabled", parsed.data.extensionEnabled],
    ["field.require_remittance", parsed.data.requireRemittance],
    ["daycloses.enforce", parsed.data.dayClosesEnforce],
    ["disbursement.check_funds", parsed.data.checkFunds],
    ["payments.allocation_order", parsed.data.allocationOrder],
    ["migration.go_live_date", parsed.data.goLiveDate === "" ? null : parsed.data.goLiveDate],
  ];

  let changed = 0;
  for (const [key, value] of next) {
    if (current.get(key) === JSON.stringify(value)) continue;
    const code = await updateSetting(key, value, "settings.saveRules", admin.userId);
    if (code !== null) return { ok: false, code };
    changed += 1;
  }
  return done({ changed });
}

export async function setClock(values: ClockValues): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = clockSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.setClock");
  // Monrovia is UTC+0 all year (D-06), so the local date-time is the UTC instant.
  const value: Json = parsed.data.useRealTime
    ? null
    : { at: `${parsed.data.at}:00Z`, frozen: parsed.data.frozen };
  const code = await updateSetting("clock.override_at", value, "settings.setClock", admin.userId);
  return code === null ? done(undefined) : { ok: false, code };
}

export async function createUser(values: NewUserValues): Promise<ActionResult<{ password: string }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = newUserSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.createUser");

  const password = generatePassword();
  const auth = createSupabaseAdminClient();
  const { data: created, error: createError } = await auth.auth.admin.createUser({
    email: parsed.data.email,
    password,
    email_confirm: true,
  });
  if (createError !== null) {
    if (createError.code === "email_exists" || createError.status === 422)
      return { ok: false, code: "DUPLICATE_EMAIL" };
    return fail("UNKNOWN", "settings.createUser", admin.userId);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_profile", {
    p_user_id: created.user.id,
    p_full_name: parsed.data.fullName,
    p_phone: sqlNullable(parsed.data.phone === "" ? null : parsed.data.phone),
    p_role: parsed.data.role,
    p_branch_id: sqlNullable(parsed.data.branchId === "" ? null : parsed.data.branchId),
    p_active: true,
  });
  if (error !== null) {
    // Undo the sign-in account so no login exists without a staff profile.
    await auth.auth.admin.deleteUser(created.user.id);
    return fail(errorCodeFrom(error), "settings.createUser", admin.userId);
  }
  return done({ password });
}

export async function updateUser(values: UserValues): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  const parsed = userSchema.safeParse(values);
  if (!parsed.success) return fail("INVALID_INPUT", "settings.updateUser");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_set_profile", {
    p_user_id: parsed.data.id,
    p_full_name: parsed.data.fullName,
    p_phone: sqlNullable(parsed.data.phone === "" ? null : parsed.data.phone),
    p_role: parsed.data.role,
    p_branch_id: sqlNullable(parsed.data.branchId === "" ? null : parsed.data.branchId),
    p_active: parsed.data.active,
  });
  if (error !== null) return fail(errorCodeFrom(error), "settings.updateUser", admin.userId);
  return done(undefined);
}

export async function resetPassword(userId: string): Promise<ActionResult<{ password: string }>> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin;
  if (!/^[0-9a-f-]{36}$/.test(userId)) return fail("INVALID_INPUT", "settings.resetPassword");

  const supabase = await createSupabaseServerClient();
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (readError !== null) return fail("UNKNOWN", "settings.resetPassword", admin.userId);
  if (profile === null) return { ok: false, code: "INVALID_STATE" };

  const password = generatePassword();
  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, { password });
  if (error !== null) return fail("UNKNOWN", "settings.resetPassword", admin.userId);

  // Audit after the reset succeeded, so the log never claims a reset that did not happen.
  const { error: auditError } = await supabase.rpc("admin_record_password_reset", { p_user_id: userId });
  if (auditError !== null) {
    logServerError({
      code: "PASSWORD_RESET_AUDIT_FAILED",
      userId: admin.userId,
      where: "settings.resetPassword",
    });
    return fail(errorCodeFrom(auditError), "settings.resetPassword", admin.userId);
  }
  return done({ password });
}
