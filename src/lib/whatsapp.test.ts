import { describe, expect, it } from "vitest";

import { whatsappLink, whatsappNumber } from "./whatsapp";

describe("whatsappNumber (SPEC 10.3)", () => {
  it("replaces a leading 0 with 231", () => {
    expect(whatsappNumber("0770 555 010")).toBe("231770555010");
  });
  it("keeps a number that already starts with 231", () => {
    expect(whatsappNumber("+231 770-555-010")).toBe("231770555010");
  });
  it("has nothing to link without digits", () => {
    expect(whatsappNumber("n/a")).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("encodes the text", () => {
    expect(whatsappLink("0770555010", "Dear Mariama, $1,440.00 – thanks")).toBe(
      "https://wa.me/231770555010?text=Dear%20Mariama%2C%20%241%2C440.00%20%E2%80%93%20thanks",
    );
  });
});
