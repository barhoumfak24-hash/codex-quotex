import { describe, expect, it } from "vitest";
import { estimateBallparkPremium, matchCarriersForRisk } from "../ballparkPremium";
import type { Carrier } from "@/types";

// Synthetic two-carrier pool used for the carrier-aware tests. One
// aggressive (tendency 0.80), one premium (tendency 1.20). The
// estimator's centerline should land midway when both match, and
// shift left/right when only one matches.
const SAMPLE_CARRIERS: Carrier[] = [
  {
    id: "carrier_cheap",
    name: "Cheap Co.",
    preferredAssetTypes: ["coastal_home"],
    stateAvailability: ["FL", "GA"],
    appetites: [
      { assetType: "coastal_home", minValue: 500_000, maxValue: 5_000_000, riskLevels: ["low", "medium"], pricingTendency: 0.80 },
    ],
    status: "active",
    createdAt: "2024-01-01",
  },
  {
    id: "carrier_pricey",
    name: "Pricey Co.",
    preferredAssetTypes: ["coastal_home"],
    stateAvailability: ["FL", "NY", "CA"],
    appetites: [
      { assetType: "coastal_home", minValue: 1_000_000, riskLevels: ["low", "medium", "high"], pricingTendency: 1.20 },
    ],
    status: "active",
    createdAt: "2024-01-01",
  },
];

describe("estimateBallparkPremium", () => {
  it("returns a min/max range with min < max for a typical coastal home", () => {
    const out = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
    });
    expect(out.currency).toBe("USD");
    expect(out.min).toBeGreaterThan(0);
    expect(out.max).toBeGreaterThan(out.min);
    // Sanity: ~1.2% of $2M = $24k centerline → range $20k - $28k after snap
    expect(out.min).toBeGreaterThanOrEqual(15_000);
    expect(out.max).toBeLessThanOrEqual(35_000);
  });

  it("raises the range for high risk and lowers it for low risk on the same asset", () => {
    const low = estimateBallparkPremium({ assetType: "coastal_home", value: 2_000_000, riskLevel: "low" });
    const med = estimateBallparkPremium({ assetType: "coastal_home", value: 2_000_000, riskLevel: "medium" });
    const high = estimateBallparkPremium({ assetType: "coastal_home", value: 2_000_000, riskLevel: "high" });
    expect(low.max).toBeLessThan(med.max);
    expect(med.max).toBeLessThan(high.max);
  });

  it("never returns less than the minimum premium floor", () => {
    const out = estimateBallparkPremium({ assetType: "jewelry", value: 100, riskLevel: "low" });
    expect(out.min).toBeGreaterThanOrEqual(250);
  });

  it("caps the upper bound so a $50M yacht doesn't produce $7M premiums", () => {
    const out = estimateBallparkPremium({ assetType: "yacht", value: 50_000_000, riskLevel: "high" });
    expect(out.max).toBeLessThanOrEqual(1_500_000);
  });

  it("treats invalid value as 0 and still returns the floor", () => {
    const out = estimateBallparkPremium({
      assetType: "luxury_vehicle",
      value: Number.NaN,
      riskLevel: "medium",
    });
    expect(out.min).toBe(250);
  });

  it("snaps to readable increments (no $4,217 prices)", () => {
    const out = estimateBallparkPremium({
      assetType: "luxury_vehicle",
      value: 175_000,
      riskLevel: "medium",
    });
    // Each value is divisible by 100 since both fall in the 1k–10k band.
    expect(out.min % 100).toBe(0);
    expect(out.max % 100).toBe(0);
  });

  it("emits a customer-safe summary line and a disclaimer", () => {
    const out = estimateBallparkPremium({ assetType: "jewelry", value: 250_000, riskLevel: "medium" });
    expect(out.summary).toMatch(/Ballpark range:/);
    expect(out.summary).toMatch(/Not a quote/);
    expect(out.disclaimer).toMatch(/Indicative only/);
  });

  it("exposes the multipliers used so the math is reconstructable", () => {
    const out = estimateBallparkPremium({ assetType: "yacht", value: 1_000_000, riskLevel: "high" });
    expect(out.basis.assetType).toBe("yacht");
    expect(out.basis.value).toBe(1_000_000);
    expect(out.basis.riskLevel).toBe("high");
    expect(out.basis.baseRate).toBe(0.015);
    expect(out.basis.riskMultiplier).toBe(1.35);
    expect(out.basis.rangeWidth).toBe(0.15);
    // No carrier pool supplied → carrier bias is the neutral 1.0
    // and the matched-carriers list is empty.
    expect(out.basis.carrierBias).toBe(1.0);
    expect(out.basis.matchedCarriers).toEqual([]);
  });

  it("falls back to the generic base rate for unknown / 'other' asset types", () => {
    const out = estimateBallparkPremium({ assetType: "other", value: 100_000, riskLevel: "medium" });
    expect(out.basis.baseRate).toBe(0.015);
  });
});

describe("matchCarriersForRisk", () => {
  it("returns only carriers whose appetite + state match", () => {
    const matched = matchCarriersForRisk(SAMPLE_CARRIERS, {
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "FL",
    });
    expect(matched.map((m) => m.carrier.id)).toEqual(["carrier_cheap", "carrier_pricey"]);
  });

  it("filters out carriers not licensed in the requested state", () => {
    const matched = matchCarriersForRisk(SAMPLE_CARRIERS, {
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "GA",
    });
    expect(matched.map((m) => m.carrier.id)).toEqual(["carrier_cheap"]);
  });

  it("filters out carriers whose value band excludes this risk", () => {
    const matched = matchCarriersForRisk(SAMPLE_CARRIERS, {
      assetType: "coastal_home",
      value: 750_000, // below Pricey Co.'s $1M floor
      riskLevel: "medium",
      state: "FL",
    });
    expect(matched.map((m) => m.carrier.id)).toEqual(["carrier_cheap"]);
  });

  it("filters out carriers that won't write the requested risk level", () => {
    const matched = matchCarriersForRisk(SAMPLE_CARRIERS, {
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "high", // Cheap Co. only writes low/medium
      state: "FL",
    });
    expect(matched.map((m) => m.carrier.id)).toEqual(["carrier_pricey"]);
  });

  it("sorts matched carriers by pricing tendency ascending (cheapest first)", () => {
    const matched = matchCarriersForRisk(SAMPLE_CARRIERS, {
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "FL",
    });
    expect(matched[0].appetite.pricingTendency).toBeLessThan(matched[1].appetite.pricingTendency);
  });

  it("skips inactive carriers", () => {
    const pool = [
      { ...SAMPLE_CARRIERS[0], status: "inactive" as const },
      SAMPLE_CARRIERS[1],
    ];
    const matched = matchCarriersForRisk(pool, {
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "FL",
    });
    expect(matched.map((m) => m.carrier.id)).toEqual(["carrier_pricey"]);
  });
});

describe("estimateBallparkPremium — carrier-aware bias", () => {
  it("averages tendencies of all matching carriers", () => {
    const out = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "FL",
      carriers: SAMPLE_CARRIERS,
    });
    // (0.80 + 1.20) / 2 = 1.0 — both balance out, centerline lands
    // at the no-carrier baseline.
    expect(out.basis.carrierBias).toBeCloseTo(1.0, 5);
    expect(out.basis.matchedCarriers.map((c) => c.id)).toEqual(["carrier_cheap", "carrier_pricey"]);
  });

  it("biases the centerline DOWN when only aggressive carriers match", () => {
    const noCarrier = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "high",
      state: "FL",
    });
    const cheapOnly = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 750_000, // excludes Pricey Co.
      riskLevel: "medium",
      state: "FL",
      carriers: SAMPLE_CARRIERS,
    });
    // The cheap-only run uses tendency 0.80 → centerline is ~20%
    // below the no-carrier baseline at the same risk band.
    expect(cheapOnly.basis.carrierBias).toBe(0.80);
    expect(cheapOnly.basis.matchedCarriers).toHaveLength(1);
    // Sanity that the no-carrier baseline is in fact 1.0
    expect(noCarrier.basis.carrierBias).toBe(1.0);
  });

  it("biases the centerline UP when only premium carriers match", () => {
    const out = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "high", // Cheap Co. doesn't write high
      state: "FL",
      carriers: SAMPLE_CARRIERS,
    });
    expect(out.basis.carrierBias).toBe(1.20);
    expect(out.basis.matchedCarriers.map((c) => c.id)).toEqual(["carrier_pricey"]);
  });

  it("falls back to neutral bias when no carrier matches", () => {
    const out = estimateBallparkPremium({
      assetType: "jewelry",
      value: 50_000,
      riskLevel: "medium",
      state: "FL",
      carriers: SAMPLE_CARRIERS, // none of these carry jewelry
    });
    expect(out.basis.carrierBias).toBe(1.0);
    expect(out.basis.matchedCarriers).toEqual([]);
  });

  it("rewords the disclaimer when carrier-derived", () => {
    const out = estimateBallparkPremium({
      assetType: "coastal_home",
      value: 2_000_000,
      riskLevel: "medium",
      state: "FL",
      carriers: SAMPLE_CARRIERS,
    });
    expect(out.disclaimer).toMatch(/2 carrier appetites matching this risk/);
  });
});