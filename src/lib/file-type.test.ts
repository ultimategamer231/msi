import { describe, expect, it } from "vitest";

import { cleanFileName, sniffDocumentType } from "./file-type";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffDocumentType", () => {
  it("recognises JPEG, PNG, WebP and PDF by their first bytes", () => {
    expect(sniffDocumentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDocumentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffDocumentType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe(
      "image/webp",
    );
    expect(sniffDocumentType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("refuses anything else, whatever the file is called", () => {
    expect(sniffDocumentType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffDocumentType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20))).toBeNull();
    expect(sniffDocumentType(bytes())).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("drops folders and control characters and limits the length", () => {
    expect(cleanFileName("C:\\Users\\me\\ID card.jpg")).toBe("ID card.jpg");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b.pdf")).toBe("ab.pdf");
    expect(cleanFileName("   ")).toBe("file");
    expect(cleanFileName(`${"x".repeat(200)}.pdf`)).toHaveLength(120);
  });
});
