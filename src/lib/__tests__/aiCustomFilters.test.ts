import { describe, expect, it } from "vitest";
import { aiAssetTypeAliases, matchesAiCustomFilter } from "../aiCustomFilters";

describe("matchesAiCustomFilter", () => {
  it("matches free-text names and assigned agents", () => {
    expect(
      matchesAiCustomFilter("Olivia", {
        text: ["Alexandra Whitford", "Olivia Marsh", "customer@demo.example"],
        flags: { assigned: true },
      })
    ).toBe(true);
  });

  it("recognizes client intent phrases", () => {
    expect(
      matchesAiCustomFilter("open claims", {
        text: ["Alexandra Whitford", "claim opened"],
        flags: { claim: true, openClaim: true },
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("unassigned", {
        text: ["Awaiting agent assignment"],
        flags: { assigned: false, unassigned: true },
      })
    ).toBe(true);
  });

  it("recognizes prospect status and value intent", () => {
    expect(
      matchesAiCustomFilter("abandoned", {
        text: ["Robert Jenkins", "Coastal home"],
        flags: { abandoned: true, alert: true },
        numbers: [2_750_000],
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("jewelry over 400k", {
        text: ["Eleanor Carmichael", "Jewelry"],
        numbers: [480_000],
      })
    ).toBe(true);
  });

  it("recognizes non-renewal and rewrite intent", () => {
    expect(
      matchesAiCustomFilter("non renewal rewrite", {
        text: ["Carrier non-renewal file", "rewrite in market", "collector-auto markets"],
        flags: { renewal: true, nonrenewed: true },
      })
    ).toBe(true);
  });

  it("recognizes billing and accounting operational intent", () => {
    expect(
      matchesAiCustomFilter("past due direct bill over 10k", {
        text: ["Alexandra Whitford", "Direct bill", "Past due"],
        flags: { due: true, pastDue: true, directBill: true },
        numbers: [12_500],
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("missing account premium finance", {
        text: ["Premium finance", "Missing info"],
        flags: { missing: true, missingInfo: true, missingAccount: true, premiumFinance: true },
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("needs review unreconciled", {
        text: ["Carrier statement"],
        flags: { needsReview: true, unreconciled: true },
      })
    ).toBe(true);
  });

  it("recognizes claims and policy-contact intent", () => {
    expect(
      matchesAiCustomFilter("no claim number", {
        text: ["Water loss", "Carrier link connected"],
        flags: { claim: true, openClaim: true, missingClaimNumber: true },
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("mortgagees missing email", {
        text: ["First National Mortgage"],
        flags: { mortgagee: true, missing: true, missingEmail: true },
      })
    ).toBe(true);
    expect(
      matchesAiCustomFilter("certificate holders", {
        text: ["Marina certificate"],
        flags: { certificateHolder: true },
      })
    ).toBe(true);
  });

  it("does not let semantic phrases match the wrong status", () => {
    expect(
      matchesAiCustomFilter("past due", {
        text: ["Due soon"],
        flags: { due: true, dueSoon: true, pastDue: false },
      })
    ).toBe(false);
  });

  it("provides natural asset aliases for AI sort prompts", () => {
    expect(aiAssetTypeAliases("luxury_vehicle")).toContain("auto");
    expect(aiAssetTypeAliases("yacht")).toContain("boat");
  });
});
