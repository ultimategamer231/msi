import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/*
 * Minimal react-hook-form resolver for zod schemas (avoids an extra dependency). Error messages are
 * message keys, translated by the form.
 */
export function zodResolver<T extends FieldValues>(schema: z.ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (errors[path] === undefined) errors[path] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
