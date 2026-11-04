/*
 * Document uploads (SPEC 6.4, 7.2): the file type is read from the file's first bytes, not from
 * the browser's claim or the file name, so a renamed file cannot pass as a scan.
 */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;

export type DocumentMime = keyof typeof DOCUMENT_TYPES;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** The document type from magic bytes, or null when the file is not an accepted type. */
export function sniffDocumentType(bytes: Uint8Array): DocumentMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  return null;
}

/** A safe display name: no path, no control characters, at most 120 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned === "" ? "file" : cleaned).slice(0, 120);
}
