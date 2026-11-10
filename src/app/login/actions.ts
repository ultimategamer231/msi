"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { logServerError } from "@/lib/log";
import { safeNextPath } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInError = "invalidInput" | "invalidCredentials" | "inactive" | "rateLimited" | "unavailable";

export interface SignInState {
  error?: SignInError;
  email?: string;
}

const signInSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

/** Account lockout bookkeeping through the service role (login_guard); fails open if unreachable. */
async function loginGuard(email: string, event: "check" | "failed" | "succeeded"): Promise<"locked" | "ok"> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("login_guard", {
      p_email: email,
      p_event: event,
    });
    if (error !== null) {
      logServerError({ code: `LOGIN_GUARD_${error.code}`, where: "login.signIn" });
      return "ok";
    }
    return data === "locked" ? "locked" : "ok";
  } catch {
    logServerError({ code: "LOGIN_GUARD_UNAVAILABLE", where: "login.signIn" });
    return "ok";
  }
}

/*
 * Email + password sign-in (FR-01). Error messages never say whether the email exists.
 * After Supabase accepts the password, the staff profile must be active, otherwise the session
 * is ended at once.
 */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  if (!parsed.success) return { error: "invalidInput", email };

  // SPEC 11: five failed attempts lock the account for 15 minutes (on top of Supabase's per-IP limit).
  const guard = await loginGuard(parsed.data.email, "check");
  if (guard === "locked") return { error: "rateLimited", email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error !== null) {
    if (error.status === 429) return { error: "rateLimited", email };
    if (error.status !== undefined && error.status >= 500) {
      logServerError({ code: `AUTH_${error.code ?? "UNAVAILABLE"}`, where: "login.signIn" });
      return { error: "unavailable", email };
    }
    const after = await loginGuard(parsed.data.email, "failed");
    return { error: after === "locked" ? "rateLimited" : "invalidCredentials", email };
  }
  await loginGuard(parsed.data.email, "succeeded");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError !== null) {
    await supabase.auth.signOut({ scope: "local" });
    logServerError({
      code: `PROFILE_READ_${profileError.code}`,
      userId: data.user.id,
      where: "login.signIn",
    });
    return { error: "unavailable", email };
  }

  if (profile === null || !profile.active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "inactive", email };
  }

  redirect(safeNextPath(parsed.data.next));
}
