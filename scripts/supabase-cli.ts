import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { join } from "node:path";

/*
 * Runs the project's Supabase CLI (the `supabase` dev dependency) with Node itself, on any system.
 * Calling `pnpm` from a script fails on Windows (pnpm is a .cmd file there, and Node refuses to run
 * those without a shell), and a shell would mangle the SQL passed as arguments. Run from the
 * project folder, as every pnpm script is.
 */
const CLI = join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");

export function runSupabase(args: string[], options: ExecFileSyncOptions = {}): string {
  return String(execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options }));
}
