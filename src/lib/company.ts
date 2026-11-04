import "server-only";

import { cache } from "react";

import { logServerError } from "@/lib/log";
import { blankIfPending } from "@/lib/text";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Company header from settings.company (SPEC 11 Branding: never hard-coded). Fields still waiting
 * for MSI hold "[pending]" and are returned as empty strings so they print blank.
 */
export interface Company {
  name: string;
  shortName: string;
  address: string;
  phone: string;
  email: string;
  receiptFooter: string;
  logoUrl: string | null;
}

const LOGO_URL_SECONDS = 600; // SPEC 11: signed URLs expire in 10 minutes

export const getCompany = cache(async (): Promise<Company | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("settings").select("value").eq("key", "company").maybeSingle();
  if (error !== null) {
    logServerError({ code: `COMPANY_READ_${error.code}`, where: "company.getCompany" });
    return null;
  }
  if (data === null || typeof data.value !== "object" || data.value === null || Array.isArray(data.value))
    return null;
  const value = data.value as Record<string, unknown>;

  let logoUrl: string | null = null;
  const logoPath = blankIfPending(value.logo_path);
  const [bucket, ...rest] = logoPath.split("/");
  if (bucket !== undefined && bucket !== "" && rest.length > 0) {
    const { data: signed } = await supabase.storage
      .from(bucket)
      .createSignedUrl(rest.join("/"), LOGO_URL_SECONDS);
    logoUrl = signed?.signedUrl ?? null;
  }

  return {
    name: blankIfPending(value.name),
    shortName: blankIfPending(value.short_name),
    address: blankIfPending(value.address),
    phone: blankIfPending(value.phone),
    email: blankIfPending(value.email),
    receiptFooter: blankIfPending(value.receipt_footer),
    logoUrl,
  };
});
