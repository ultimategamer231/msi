"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, cleanFileName, sniffDocumentType } from "@/lib/file-type";
import { logServerError } from "@/lib/log";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

import {
  CUSTOMER_STATUSES,
  customerPayload,
  customerSchema,
  duplicateOverrideSchema,
  parseDuplicateMatches,
  type CustomerValues,
  type DOCUMENT_KINDS,
  type DuplicateMatch,
} from "./schemas";

export type UploadResult =
  { ok: true; storagePath: string; fileName: string } | { ok: false; code: ErrorCode };

export interface UploadedFile {
  kind: (typeof DOCUMENT_KINDS)[number];
  storagePath: string;
  fileName: string;
}

export type CreateCustomerResult =
  | { ok: true; id: string; code: string }
  | { ok: false; code: "DUPLICATE_CUSTOMER"; matches: DuplicateMatch[] }
  | { ok: false; code: ErrorCode };

const CREATE_ROLES: readonly Role[] = ["loan_officer", "manager", "admin"];
const UPLOAD_ROLES: readonly Role[] = ["loan_officer", "cashier", "manager", "accountant", "admin"]; // accountant: expense receipts (M8)

async function staffWith(roles: readonly Role[]) {
  const result = await getCurrentStaff();
  return result.status === "ok" && roles.includes(result.staff.role) ? result.staff : null;
}

/*
 * Uploads one document to the private bucket, in the caller's own folder (the storage policy
 * allows nothing else). The type is read from the file's bytes. The file is linked to a customer
 * only by the RPC that creates or changes the record, which checks the uploader again.
 */
export async function uploadCustomerFile(formData: FormData): Promise<UploadResult> {
  const staff = await staffWith(UPLOAD_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > DOCUMENT_MAX_BYTES) {
    return { ok: false, code: "UPLOAD_REJECTED" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffDocumentType(bytes);
  if (mime === null) return { ok: false, code: "UPLOAD_REJECTED" };

  const storagePath = `${staff.id}/${randomUUID()}.${DOCUMENT_TYPES[mime]}`;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from("documents")
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (error !== null) {
    logServerError({ code: "UPLOAD_FAILED", userId: staff.id, where: "customers.uploadCustomerFile" });
    return { ok: false, code: "UNKNOWN" };
  }
  return { ok: true, storagePath, fileName: cleanFileName(file.name) };
}

/* create_customer (SPEC 8): the RPC checks the role, branch, fields and duplicates again. */
export async function createCustomer(
  values: CustomerValues,
  files: UploadedFile[],
  override: { reason: string } | null,
): Promise<CreateCustomerResult> {
  const staff = await staffWith(CREATE_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = customerSchema.safeParse(values);
  if (!parsed.success || files.length > 10) return { ok: false, code: "INVALID_INPUT" };
  const overrideReason = override === null ? null : duplicateOverrideSchema.safeParse(override);
  if (overrideReason !== null && !overrideReason.success) return { ok: false, code: "INVALID_INPUT" };

  const supabase = await createSupabaseServerClient();
  const { data: code, error } = await supabase.rpc("create_customer", {
    p_customer: {
      ...customerPayload(parsed.data),
      type: parsed.data.type,
      files: files.map((file) => ({
        kind: file.kind,
        storage_path: file.storagePath,
        file_name: file.fileName,
      })),
      ...(overrideReason === null
        ? {}
        : { duplicate_override: true, duplicate_reason: overrideReason.data.reason }),
    },
  });
  if (error !== null) {
    const errorCode = errorCodeFrom(error);
    if (errorCode === "DUPLICATE_CUSTOMER") {
      return { ok: false, code: "DUPLICATE_CUSTOMER", matches: parseDuplicateMatches(error.details) };
    }
    if (errorCode === "UNKNOWN") {
      logServerError({ code: `RPC_${error.code}`, userId: staff.id, where: "customers.createCustomer" });
    }
    return { ok: false, code: errorCode };
  }

  const { data: created, error: readError } = await supabase
    .from("customers")
    .select("id")
    .eq("code", code)
    .single();
  if (readError !== null) {
    logServerError({ code: `READ_${readError.code}`, userId: staff.id, where: "customers.createCustomer" });
    return { ok: false, code: "UNKNOWN" };
  }
  revalidatePath("/customers");
  return { ok: true, id: created.id, code };
}

export type EditRequestResult =
  | { ok: true }
  | { ok: false; code: "DUPLICATE_CUSTOMER"; matches: DuplicateMatch[] }
  | { ok: false; code: ErrorCode };

const EDIT_ROLES: readonly Role[] = ["loan_officer", "cashier", "manager", "admin"];

async function sendEditRequest(
  where: string,
  staffId: string,
  customerId: string,
  patch: { [key: string]: Json | undefined },
  reason: string,
): Promise<EditRequestResult> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_customer_edit", {
    p_customer_id: customerId,
    p_patch: patch,
    p_reason: reason,
  });
  if (error !== null) {
    const errorCode = errorCodeFrom(error);
    if (errorCode === "DUPLICATE_CUSTOMER") {
      return { ok: false, code: "DUPLICATE_CUSTOMER", matches: parseDuplicateMatches(error.details) };
    }
    if (errorCode === "UNKNOWN") logServerError({ code: `RPC_${error.code}`, userId: staffId, where });
    return { ok: false, code: errorCode };
  }
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/approvals");
  return { ok: true };
}

const uuid = /^[0-9a-f-]{36}$/;

/* request_customer_edit (SPEC 8): the database stores only the fields that change. */
export async function requestCustomerEdit(
  customerId: string,
  values: CustomerValues,
  photo: UploadedFile | null,
  options: { reason: string; override: boolean },
): Promise<EditRequestResult> {
  const staff = await staffWith(EDIT_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const parsed = customerSchema.safeParse(values);
  const reason = options.reason.trim();
  if (!parsed.success || !uuid.test(customerId) || reason.length > 300)
    return { ok: false, code: "INVALID_INPUT" };
  if (options.override && reason === "") return { ok: false, code: "INVALID_INPUT" };

  const patch: { [key: string]: Json | undefined } = { ...customerPayload(parsed.data) };
  if (photo !== null && photo.kind === "photo") {
    patch.photo = { storage_path: photo.storagePath, file_name: photo.fileName };
  }
  if (options.override) patch.duplicate_override = true;
  return sendEditRequest("customers.requestCustomerEdit", staff.id, customerId, patch, reason);
}

/* A status change (blacklist, archive, reactivate) is an approved edit of its own (SPEC 5.11). */
export async function requestCustomerStatus(
  customerId: string,
  status: (typeof CUSTOMER_STATUSES)[number],
  reason: string,
): Promise<EditRequestResult> {
  const staff = await staffWith(EDIT_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  const trimmed = reason.trim();
  if (
    !uuid.test(customerId) ||
    !CUSTOMER_STATUSES.includes(status) ||
    trimmed === "" ||
    trimmed.length > 300
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  return sendEditRequest("customers.requestCustomerStatus", staff.id, customerId, { status }, trimmed);
}

/* add_customer_documents: new scans for an existing customer (B-24). */
export async function addCustomerDocuments(
  customerId: string,
  files: UploadedFile[],
): Promise<{ ok: true } | { ok: false; code: ErrorCode }> {
  const staff = await staffWith(UPLOAD_ROLES);
  if (staff === null) return { ok: false, code: "FORBIDDEN" };
  if (!uuid.test(customerId) || files.length === 0 || files.length > 10)
    return { ok: false, code: "INVALID_INPUT" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_customer_documents", {
    p_customer_id: customerId,
    p_files: files.map((file) => ({
      kind: file.kind,
      storage_path: file.storagePath,
      file_name: file.fileName,
    })),
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({
        code: `RPC_${error.code}`,
        userId: staff.id,
        where: "customers.addCustomerDocuments",
      });
    return { ok: false, code };
  }
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
