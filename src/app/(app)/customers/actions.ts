"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getCurrentStaff } from "@/lib/auth/staff";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, cleanFileName, sniffDocumentType } from "@/lib/file-type";
import { logServerError } from "@/lib/log";
import type { Role } from "@/lib/permissions";
import { errorCodeFrom, type ErrorCode } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
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
const UPLOAD_ROLES: readonly Role[] = ["loan_officer", "cashier", "manager", "admin"];

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
