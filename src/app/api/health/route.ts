import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * /api/health (SPEC 11 Observability): public, for uptime checks. Says whether the database
 * answers and when the daily job last ran; nothing else.
 */
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("health_check");
    if (error !== null) throw new Error("database");
    const result = (data ?? {}) as { last_accrual_run?: string | null; business_date?: string };
    return Response.json(
      {
        status: "ok",
        database: "ok",
        lastAccrualRun: result.last_accrual_run ?? null,
        businessDate: result.business_date ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
