import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiCarrierMatch } from "../ai";
import type { Carrier } from "@/types";

const carriers: Carrier[] = [
  {
    id: "carrier_exact",
    name: "Exact Appetite",
    preferredAssetTypes: ["coastal_home"],
    stateAvailability: ["FL"],
    appetites: [
      {
        assetType: "coastal_home",
        minValue: 1_000_000,
        maxValue: 3_000_000,
        riskLevels: ["medium"],
        pricingTendency: 0.82,
      },
    ],
    status: "active",
    createdAt: "2026-01-01",
  },
  {
    id: "carrier_preferred",
    name: "Preferred Only",
    preferredAssetTypes: ["coastal_home"],
    stateAvailability: ["FL"],
    appetites: [],
    status: "active",
    createdAt: "2026-01-01",
  },
  {
    id: "carrier_inactive",
    name: "Inactive",
    preferredAssetTypes: ["coastal_home"],
    stateAvailability: ["FL"],
    appetites: [
      {
        assetType: "coastal_home",
        minValue: 1_000_000,
        maxValue: 3_000_000,
        riskLevels: ["medium"],
        pricingTendency: 0.7,
      },
    ],
    status: "inactive",
    createdAt: "2026-01-01",
  },
];

describe("aiCarrierMatch", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_AI_MODE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers exact appetite rows over broad preferred-asset matches", async () => {
    const out = await aiCarrierMatch(
      {
        assetType: "coastal_home",
        parsedData: {
          estimatedValue: 2_000_000,
          address: "100 Ocean Drive, Miami, FL 33139",
          floodZone: "X",
          windMitigation: false,
        },
      },
      carriers
    );
    expect(out?.carrierId).toBe("carrier_exact");
    expect(out?.reason).toMatch(/Matches active appetite row/);
    expect(out?.alternates.map((a) => a.carrierId)).toContain("carrier_preferred");
    expect(out?.alternates.map((a) => a.carrierId)).not.toContain("carrier_inactive");
  });

  it("is deterministic for the same input", async () => {
    const quote = {
      assetType: "coastal_home" as const,
      parsedData: {
        estimatedValue: 2_000_000,
        address: "100 Ocean Drive, Miami, FL 33139",
        floodZone: "X",
        windMitigation: false,
      },
    };
    const first = await aiCarrierMatch(quote, carriers);
    const second = await aiCarrierMatch(quote, carriers);
    expect(second).toEqual(first);
  });
});
