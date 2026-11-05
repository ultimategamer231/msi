import { describe, expect, it } from "vitest";

import { customerName, likePattern } from "./customers";

describe("customerName", () => {
  it("uses the business name for a business and first plus last name otherwise", () => {
    expect(
      customerName({
        type: "business",
        first_name: null,
        last_name: null,
        business_name: " Dolo & Sons Trading ",
      }),
    ).toBe("Dolo & Sons Trading");
    expect(
      customerName({ type: "individual", first_name: "Mariama", last_name: "Kollie", business_name: null }),
    ).toBe("Mariama Kollie");
  });
});

describe("likePattern", () => {
  it("wraps the term and escapes wildcards", () => {
    expect(likePattern("kollie")).toBe("%kollie%");
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});
