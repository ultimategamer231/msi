import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { fixtureUser } from "./fixtures";
import { localSupabaseEnv } from "./supabase-env";

/* Service-role client for test assertions on the LOCAL stack only (e.g. reading audit rows). */
export function serviceClient() {
  const env = localSupabaseEnv();
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function latestAudit(action: string, entityId: string) {
  const { data, error } = await serviceClient()
    .from("audit_log")
    .select("action, entity_id, actor_role, before, after")
    .eq("action", action)
    .eq("entity_id", entityId)
    .order("chain_no", { ascending: false })
    .limit(5);
  if (error !== null) throw error;
  return data;
}

/** Runs one SQL statement as the LOCAL database owner (test setup only, e.g. posting a journal). */
export function ownerSql(sql: string): void {
  execFileSync("pnpm", ["-s", "supabase", "db", "query", sql], { stdio: ["ignore", "ignore", "inherit"] });
}

/** A client signed in as a test user, for setting up data through the same RPCs the app uses. */
export async function userClient(user: { email: string; password: string }) {
  const env = localSupabaseEnv();
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error !== null) throw error;
  return client;
}

/** Creates a customer as the given user through create_customer; returns its id and code. */
export async function createTestCustomer(
  user: { email: string; password: string },
  fields: Record<string, string>,
): Promise<{ id: string; code: string }> {
  const client = await userClient(user);
  const { data: code, error } = await client.rpc("create_customer", {
    p_customer: { type: "individual", ...fields },
  });
  if (error !== null) throw error;
  const { data, error: readError } = await client.from("customers").select("id").eq("code", code).single();
  if (readError !== null) throw readError;
  return { id: data.id, code };
}

/** Creates and submits a loan application as the given user; returns the loan id and number. */
export async function submitTestLoan(
  user: { email: string; password: string },
  customerId: string,
  principalCents: number,
): Promise<{ id: string; loanNo: string }> {
  const client = await userClient(user);
  const { data: product, error: productError } = await client
    .from("loan_products")
    .select("id")
    .eq("name", "Standard 1-month")
    .single();
  if (productError !== null) throw productError;
  const { data: id, error } = await client.rpc("create_loan_draft", {
    p_loan: {
      customer_id: customerId,
      product_id: product.id,
      principal_cents: principalCents,
      term_months: 1,
    },
  });
  if (error !== null) throw error;
  const { error: submitError } = await client.rpc("submit_loan", { p_loan_id: id });
  if (submitError !== null) throw submitError;
  const { data: loan, error: readError } = await client.from("loans").select("loan_no").eq("id", id).single();
  if (readError !== null) throw readError;
  return { id, loanNo: loan.loan_no };
}

/** Puts money in a cash account the way the app does: capital in requested and approved (R10). */
export async function fundCash(account: string, amountCents: number): Promise<void> {
  const accountant = await userClient(fixtureUser("accountant"));
  const manager = await userClient(fixtureUser("manager"));
  const { data: today } = await accountant.rpc("business_today");
  const memo = `E2E cash ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { error } = await accountant.rpc("request_capital_in", {
    p_request: { entry_date: today, account, amount_cents: amountCents, memo },
  });
  if (error !== null) throw error;
  const { data: request, error: readError } = await manager
    .from("approval_requests")
    .select("id")
    .eq("type", "capital_in")
    .eq("status", "pending")
    .contains("payload", { memo })
    .single();
  if (readError !== null) throw readError;
  const { error: decideError } = await manager.rpc("decide_approval", {
    p_id: request.id,
    p_decision: "approve",
    p_note: "",
  });
  if (decideError !== null) throw decideError;
}

/** A paid-out loan, made through the same RPCs staff use: applied, pledged, approved, paid out (R1). */
export async function activeTestLoan(
  fields: Record<string, string>,
  principalCents: number,
): Promise<{ id: string; loanNo: string; customerId: string }> {
  const customer = await createTestCustomer(fixtureUser("loan_officer"), fields);
  const loan = await submitTestLoan(fixtureUser("loan_officer"), customer.id, principalCents);
  const officer = await userClient(fixtureUser("loan_officer"));
  const { data: itemId, error } = await officer.rpc("register_collateral", {
    p_item: {
      owner_customer_id: customer.id,
      type: "electronics",
      description: "Samsung TV 43 inch",
      estimated_value_cents: principalCents * 2,
      location_note: "Branch 2 safe",
    },
  });
  if (error !== null) throw error;
  const { error: linkError } = await officer.rpc("link_collateral", {
    p_loan_id: loan.id,
    p_collateral_id: itemId,
  });
  if (linkError !== null) throw linkError;
  await fundCash("1010-BR2", principalCents);
  const manager = await userClient(fixtureUser("manager"));
  const { data: request, error: readError } = await manager
    .from("approval_requests")
    .select("id")
    .eq("type", "loan_approval")
    .eq("entity_id", loan.id)
    .single();
  if (readError !== null) throw readError;
  const { error: decideError } = await manager.rpc("decide_approval", {
    p_id: request.id,
    p_decision: "approve",
    p_note: "",
  });
  if (decideError !== null) throw decideError;
  const cashier = await userClient(fixtureUser("cashier"));
  const { error: payoutError } = await cashier.rpc("disburse_loan", { p_loan_id: loan.id, p_method: "cash" });
  if (payoutError !== null) throw payoutError;
  return { ...loan, customerId: customer.id };
}
