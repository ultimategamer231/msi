import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/*
 * Minimal react-hook-form resolver for zod schemas (avoids an extra dependency). Errors are nested
 * by path the way react-hook-form expects (`errors.lines[1].debit`). Messages are message keys,
 * translated by the form.
 */
type ErrorTree = { [key: string]: ErrorTree | { type: string; message: string } } | ErrorTree[];

export function nestIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string; message: string }>,
): ErrorTree {
  const root: Record<string, unknown> = {};
  for (const issue of issues) {
    const path = issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment)));
    if (path.length === 0) continue;
    let node: Record<string | number, unknown> = root;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i] as string | number;
      const nextIsIndex = typeof path[i + 1] === "number";
      if (node[key] === undefined) node[key] = nextIsIndex ? [] : {};
      node = node[key] as Record<string | number, unknown>;
    }
    const last = path[path.length - 1] as string | number;
    // Keep the first error per field.
    if (node[last] === undefined) node[last] = { type: issue.code, message: issue.message };
  }
  return root as ErrorTree;
}

export function zodResolver<T extends FieldValues>(schema: z.ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data, errors: {} };
    return { values: {}, errors: nestIssues(result.error.issues) as FieldErrors<T> };
  };
}
