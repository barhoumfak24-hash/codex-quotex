// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { aiParseCarrierAppetite } from "../ai";

// =====================================================================
// AI appetite parser smoke tests. Verifies the parser pulls obvious
// signals (asset types, states, value bands, restricted risks,
// emails) and surfaces what it couldn't via missingFields.
// =====================================================================

describe("aiParseCarrierAppetite", () => {
  it("extracts asset types + state availability from a coastal-home brief", async () => {
    const out = await aiParseCarrierAppetite({
      fileName: "Chubb-coastal-home-appetite-2025.pdf",
      text:
        "Chubb writes coastal home (HO-3) policies in FL, GA, SC, NC, and TX for dwellings valued $500,000 - $10,000,000. Broad appetite for preferred-risk masonry construction. Underwriting requirements: wind mitigation form on file, no losses in 5 years.",
    });
    expect(out.preferredAssetTypes).toContain("coastal_home");
    expect(out.stateAvailability).toEqual(expect.arrayContaining(["FL", "GA", "SC", "NC", "TX"]));
    expect(out.appetites?.[0].minValue).toBe(500_000);
    expect(out.appetites?.[0].maxValue).toBe(10_000_000);
    expect(out.confidence).toBeGreaterThan(0.5);
    expect(out.missingFields).not.toContain("Preferred asset types");
    expect(out.missingFields).not.toContain("State availability");
  });

  it("flags missing fields when the source is sparse", async () => {
    const out = await aiParseCarrierAppetite({
      text: "Carrier writes some risks.",
    });
    expect(out.missingFields.length).toBeGreaterThan(3);
    expect(out.missingFields).toContain("Preferred asset types");
    expect(out.confidence).toBeLessThan(0.6);
  });

  it("pulls carrier rep emails as distribution-list hints", async () => {
    const out = await aiParseCarrierAppetite({
      text:
        "Submissions to underwriting@examplecarrier.com — copy newbiz@examplecarrier.com for HNW risks.",
    });
    expect(out.carrierEmailHints?.map((h) => h.email)).toEqual(
      expect.arrayContaining(["underwriting@examplecarrier.com", "newbiz@examplecarrier.com"])
    );
  });

  it("notes excluded / restricted risks when phrased clearly", async () => {
    const out = await aiParseCarrierAppetite({
      text:
        "We will not write coastal exposures within 1 mile of the shore. Standalone flood policies in SFHA are ineligible.",
    });
    expect(out.restrictedRisks?.length).toBeGreaterThan(0);
  });

  it("classifies appetite rows as commercial when the doc calls out commercial lines", async () => {
    const out = await aiParseCarrierAppetite({
      text:
        "Commercial property + commercial auto fleet program for businesses. $100,000 – $5,000,000 TIV.",
    });
    expect(out.appetites?.every((r) => r.line === "commercial")).toBe(true);
  });

  it("classifies appetite rows as personal by default for HNW books", async () => {
    const out = await aiParseCarrierAppetite({
      text:
        "HNW personal lines — coastal homes $1M – $20M in FL and SC for private client business.",
    });
    expect(out.appetites?.every((r) => r.line === "personal")).toBe(true);
  });

  it("emits per-line rows when the doc mentions both commercial and personal", async () => {
    const out = await aiParseCarrierAppetite({
      text:
        "We write personal lines (homeowner HNW $500k – $5M) and commercial property for HOAs / professional liability.",
    });
    const personalRows = out.appetites?.filter((r) => r.line === "personal") ?? [];
    const commercialRows = out.appetites?.filter((r) => r.line === "commercial") ?? [];
    expect(personalRows.length).toBeGreaterThan(0);
    expect(commercialRows.length).toBeGreaterThan(0);
  });
});