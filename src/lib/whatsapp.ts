/*
 * WhatsApp reminder links (SPEC 10.3): no API, the officer's phone opens WhatsApp with the text
 * filled in and the officer presses send. Liberian numbers: digits only; a leading 0 becomes 231;
 * a number already starting with 231 is kept.
 */
export function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("231")) return digits;
  if (digits.startsWith("0")) return `231${digits.slice(1)}`;
  return digits;
}

export function whatsappLink(phone: string, text: string): string | null {
  const number = whatsappNumber(phone);
  return number === null ? null : `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
