"use server";

import { revalidatePath } from "next/cache";

import { getCurrentStaff, type Staff } from "@/lib/auth/staff";
import { customerName, likePattern } from "@/lib/customers";
import { logServerError } from "@/lib/log";
import { parseDollarsToCents } from "@/lib/money-input";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { collateralSchema, eventSchema, type CollateralValues, type EventValues } from "./schemas";

const REGISTER_ROLES: readonly Role[] = ["loan_officer", "cashier", "manager"];
const RELEASE_ROLES: readonly Role[] = ["cashier", "manager"];
const uuid = /^[0-9a-f-]{36}$/;

async function staffIn(roles: readonly Role[]): Promise<Staff | null> {
  const result = await getCurrentStaff();
  return result.status === "ok" && roles.includes(result.staff.role) ? result.staff : null;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type RpcError = { code?: string; message?: string };

function failure(error: RpcError, staff: Staff, where: string): { ok: false; code: ErrorCode } {
  const code = errorCodeFrom(error);
  if (code === "UNKNOWN") logServerError({ code: `RPC_${error.code ?? ""}`, userId: staff.id, where });
  return { ok: false, code };
}

export interface OwnerHit {
  id: string;
  code: string;
  name: string;
}

/* Active customers who can own an item. */
export async function searchOwners(term: string): Promise<OwnerHit[]> {
  const staff = await staffIn(REGISTER_ROLES);
  const text = term.trim().slice(0, 100);
  if (staff === null || text.length < 2) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("customers")
    .select("id, code, type, first_name, last_name, business_name")
    .eq("status", "active")
    .ilike("search_text", likePattern(text.toLowerCase()))
    .order("code")
    .limit(8);
  return (data ?? []).map((row) => ({ id: row.id, code: row.code, name: customerName(row) }));
}

export interface DuplicateItem {
  id: string;
  code: string;
  description: string;
  matched: string;
}

/* SPEC 5.9: warn before registering an identifier already on another active item. */
export async function findDuplicates(values: CollateralValues, exclude?: string): Promise<DuplicateItem[]> {
  const staff = await staffIn(REGISTER_ROLES);
  if (staff === null) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("find_duplicate_collateral", {
    p_serial_no: values.serialNo,
    p_plate_no: values.plateNo,
    p_chassis_no: values.chassisNo,
    p_document_no: values.documentNo,
    ...(exclude !== undefined && uuid.test(exclude) ? { p_exclude: exclude } : {}),
  });
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description,
    matched: row.matched,
  }));
}

export interface CollateralFile {
  kind: "photo" | "document" | "other";
  storagePath: string;
  fileName: string;
}

async function attach(supabase: Supabase, collateralId: string, files: CollateralFile[]) {
  if (files.length === 0) return { error: null };
  return supabase.rpc("add_collateral_documents", {
    p_collateral_id: collateralId,
    p_files: files.map((file) => ({
      kind: file.kind,
      storage_path: file.storagePath,
      file_name: file.fileName,
    })),
  });
}

export type RegisterResult = { ok: true; id: string } | { ok: false; code: ErrorCode };

/* register_collateral (SPEC 8) and its photos and documents. */
export async function registerCollateral(
  values: CollateralValues,
  files: CollateralFile[],
): Promise<RegisterResult> {
  const staff = await staffIn(REGISTER_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = collateralSchema.safeParse(values);
  const cents = parsed.success ? parseDollarsToCents(parsed.data.value) : null;
  if (!parsed.success || cents === null || files.length > 10) return { ok: false, code: "INVALID_INPUT" };
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: id, error } = await supabase.rpc("register_collateral", {
    p_item: {
      owner_customer_id: data.ownerId,
      type: data.type,
      description: data.description,
      serial_no: data.serialNo,
      plate_no: data.plateNo,
      chassis_no: data.chassisNo,
      document_no: data.documentNo,
      estimated_value_cents: Number(cents),
      location_note: data.location,
    },
  });
  if (error !== null) return failure(error, staff, "collateral.register");
  const { error: fileError } = await attach(supabase, String(id), files);
  if (fileError !== null) return failure(fileError, staff, "collateral.registerFiles");
  revalidatePath("/collateral");
  return { ok: true, id: String(id) };
}

export type ActionResult = { ok: true } | { ok: false; code: ErrorCode };

export async function addCollateralFiles(
  collateralId: string,
  files: CollateralFile[],
): Promise<ActionResult> {
  const staff = await staffIn(REGISTER_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(collateralId) || files.length === 0 || files.length > 10)
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await attach(supabase, collateralId, files);
  if (error !== null) return failure(error, staff, "collateral.addFiles");
  revalidatePath(`/collateral/${collateralId}`);
  return { ok: true };
}

/* log_collateral_event (SPEC 5.9): moved, valued, note or lost. */
export async function logCustodyEvent(collateralId: string, values: EventValues): Promise<ActionResult> {
  const staff = await staffIn(REGISTER_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = eventSchema.safeParse(values);
  if (!parsed.success || !uuid.test(collateralId)) return { ok: false, code: "INVALID_INPUT" };
  const event = parsed.data;
  const cents = event.type === "valued" ? parseDollarsToCents(event.value) : null;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("log_collateral_event", {
    p_collateral_id: collateralId,
    p_event: {
      event_type: event.type,
      to_location: event.toLocation,
      note: event.note,
      witness_name: event.witness,
      ...(cents === null ? {} : { value_cents: Number(cents) }),
    },
  });
  if (error !== null) return failure(error, staff, "collateral.logEvent");
  revalidatePath(`/collateral/${collateralId}`);
  revalidatePath("/collateral");
  return { ok: true };
}

/* release_collateral (SPEC 5.9; FR-16): every loan the item secured has ended. */
export async function releaseCollateral(
  collateralId: string,
  note: string,
  witness: string,
): Promise<ActionResult> {
  const staff = await staffIn(RELEASE_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(collateralId)) return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("release_collateral", {
    p_collateral_id: collateralId,
    p_note: note.trim().slice(0, 500),
    p_witness_name: witness.trim().slice(0, 120),
  });
  if (error !== null) return failure(error, staff, "collateral.release");
  revalidatePath(`/collateral/${collateralId}`);
  revalidatePath("/collateral");
  return { ok: true };
}
