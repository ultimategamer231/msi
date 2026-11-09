import type { NextRequest } from "next/server";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { centsToInput } from "@/lib/money-input";
import { canAccess } from "@/lib/permissions";
import { REPORT_KEYS, buildReport, formatCell, reportParams, type ReportKey } from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * CSV export of a report (SPEC 10.2): the same rows as the page, one block per table. Money is
 * written as plain dollars ("1234.56"); a value starting with = + - @ is quoted with a leading '
 * so spreadsheets do not run it as a formula.
 */
function csvValue(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const staff = await getCurrentStaff();
  if (staff.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (!canAccess(staff.staff.role, "/api/reports/[report]"))
    return new Response("Not allowed.", { status: 403 });
  if (!(REPORT_KEYS as readonly string[]).includes(report))
    return new Response("Not found.", { status: 404 });
  const key = report as ReportKey;
  const supabase = await createSupabaseServerClient();
  const { data: today } = await supabase.rpc("business_today");
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  try {
    const model = await buildReport(key, reportParams(key, query, String(today)));
    const lines: string[] = [csvValue(model.title), csvValue(model.subtitle), ""];
    for (const section of model.sections) {
      lines.push(csvValue(section.heading));
      lines.push(section.columns.map((column) => csvValue(column.label)).join(","));
      const rows = section.total === undefined ? section.rows : [...section.rows, section.total];
      for (const row of rows) {
        lines.push(
          section.columns
            .map((column) => {
              const value = row[column.key] ?? null;
              if (value === null || value === "") return "";
              return csvValue(
                column.kind === "money" ? centsToInput(String(value)) : formatCell(column.kind, value),
              );
            })
            .join(","),
        );
      }
      lines.push("");
    }
    return new Response(`﻿${lines.join("\r\n")}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${key}-${String(today)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    logServerError({ code: "REPORT_READ", userId: staff.staff.id, where: `reports.${key}` });
    return new Response("Could not read the report.", { status: 500 });
  }
}
