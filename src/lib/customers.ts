/* Display helpers for customer records (formatting only; rules live in Postgres). */
export interface CustomerNameParts {
  type: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
}

/** Same rule as customer_display_name() in SQL: business name, or first and last name. */
export function customerName(customer: CustomerNameParts): string {
  if (customer.type === "business") return (customer.business_name ?? "").trim();
  return [customer.first_name, customer.last_name]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ");
}

/** Escapes LIKE wildcards so a search for "50%" matches the text "50%". */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
