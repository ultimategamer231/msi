import { describe, expect, it } from "vitest";

import { fillTemplate } from "./template";

describe("fillTemplate", () => {
  it("replaces known placeholders and leaves unknown ones visible", () => {
    expect(
      fillTemplate("Penalty {penalty_rate} every {penalty_days} days by {company}.", {
        penalty_rate: "20%",
        penalty_days: "7",
        company: "MSI",
      }),
    ).toBe("Penalty 20% every 7 days by MSI.");
    expect(fillTemplate("Hello {nmae}", { name: "Ama" })).toBe("Hello {nmae}");
  });
});
