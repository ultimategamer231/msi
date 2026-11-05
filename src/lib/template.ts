/*
 * Fills "{name}" placeholders in admin-edited texts (settings.templates: agreement wording, later
 * WhatsApp reminders). Unknown placeholders stay as they are, so a typo in a template is visible.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) =>
    key in values ? (values[key] ?? match) : match,
  );
}
