import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("customer questionnaire privacy", () => {
  it("does not render internal AI source labels or evidence metadata", () => {
    const source = readFileSync(new URL("../ClientQuestionnairePage.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("meta.sourceLabel");
    expect(source).not.toContain("meta.sourceName");
    expect(source).not.toContain("Source: {aiSource}");
  });
});
