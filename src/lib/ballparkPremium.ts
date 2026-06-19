// =====================================================================
// Ballpark premium estimator — deterministic, no carrier data.
//
// A simple multiplier-based heuristic used when the agency wants a
// quick "in the ballpark" annual premium range to show the customer
// before any carrier appetite check or licensed underwriting review.
// Output is always wrapped in a disclaimer string so callers can
// surface the "not a quote" framing without re-deriving it.
//
// The function is pure (no I/O, no network) and fully unit-tested.
// =====================================================================

import type { AssetType, Carrier } from "@/types";

export type RiskLevel = "low" | "medium" | "high";

export interface BallparkInput {
  assetType: AssetType;
  // Insured value in USD. For umbrella, this is the limit. For
  // jewelry, the appraised replacement value. For homes / vehicles /
  // yachts, the replacement-cost basis the agency would underwrite to.
  value: number;
  riskLevel: RiskLevel;
  // Optional 2-letter US state — used to filter the carrier pool
  // down to those licensed in that state before averaging tendencies.
  state?: string;
  // Optional carrier pool. When provided, the estimator filters to
  // carriers whose appetites match (asset type + value band + risk
  // level + state) and biases the centerline by the average of
  // their pricingTendency values. Without this, the function returns
  // the same pure-industry-average ballpark as before.
  carriers?: Carrier[];
  // Optional uncertainty band. Higher-quality research inputs can use
  // a tighter band; thin intake can widen the range without pretending
  // the estimate is more precise than it is.
  rangeHalfWidth?: number;
}

export interface BallparkRange {
  min: number;       // Annual premium estimate, lower bound (USD)
  max: number;       // Annual premium estimate, upper bound (USD)
  currency: "USD";
  // Snapshot of the inputs + the exact multipliers used so the agent
  // (and a regression test) can reconstruct the math.
  basis: {
    assetType: AssetType;
    value: number;
    riskLevel: RiskLevel;
    baseRate: number;          // Fraction of value used as the centerline
    riskMultiplier: number;    // Applied to the base rate
    rangeWidth: number;        // +/- fraction applied to centerline to get min/max
    // Carrier-derived bias. 1.0 means no carrier data was used (or
    // the matched pool averaged exactly at market). <1 = the carriers
    // licensed to write this risk tend to come in under industry
    // average; >1 = they tend to price above.
    carrierBias: number;
    // Carriers that passed the appetite filter, in priority order
    // (lowest tendency first — most aggressive on price). Empty when
    // no carrier pool was supplied or none matched.
    matchedCarriers: { id: string; name: string; pricingTendency: number }[];
  };
  // One-line, customer-safe summary. e.g.
  //   "Ballpark range: $4,200 – $5,800 / year (USD). Not a quote."
  summary: string;
  disclaimer: string;
}

// Base annual premium as a fraction of insured value. These are
// intentionally conservative midpoints derived from publicly known
// private-client rate-of-line averages; they're not tied to any
// specific carrier and exist only so the demo produces plausible
// numbers without a live carrier feed.
const BASE_RATES: Record<AssetType, number> = {
  coastal_home: 0.012,       // 1.2% of insured value (wind-exposed inflates this in real life)
  luxury_vehicle: 0.025,     // 2.5% — high-value autos run higher than mass market
  yacht: 0.015,              // 1.5% — varies wildly by hull / cruising area
  jewelry: 0.018,            // 1.8% of scheduled value
  umbrella_liability: 0.0006, // ~$60 per $100k of limit — flat, not value-scaled
  full_portfolio: 0.011,     // Blended; agent will rebuild from per-asset estimates
  other: 0.015,              // Generic fallback
};

// Risk-band adjustment. The customer-supplied (or AI-classified)
// risk level shifts the centerline up or down before the +/- band is
// applied. Multipliers are deliberately gentle so the output stays
// "ballpark" rather than pretending to be carrier-grade.
const RISK_MULTIPLIERS: Record<RiskLevel, number> = {
  low: 0.85,
  medium: 1.0,
  high: 1.35,
};

// Half-width of the displayed range as a fraction of the centerline.
// 0.15 → "centerline +/- 15%", i.e. min = 0.85 * c, max = 1.15 * c.
const RANGE_HALF_WIDTH = 0.15;

// Floor and ceiling so tiny / huge inputs still produce sensible
// numbers. Without these, a $1,000 jewelry item would show $18 / yr
// (which no agency would actually bind) and a $50M yacht would show
// $750,000 which is plausible but rounds badly.
const MIN_PREMIUM = 250;
const MAX_PREMIUM = 1_500_000;

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Snap to a nicely readable increment so the range doesn't end in
// odd digits like $4,217. Larger premiums round to coarser steps.
function snapPremium(value: number): number {
  if (value < 1_000) return roundToNearest(value, 25);
  if (value < 10_000) return roundToNearest(value, 100);
  if (value < 100_000) return roundToNearest(value, 500);
  return roundToNearest(value, 1_000);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

// Find the carriers whose appetites match the requested asset + value
// + risk + state. A carrier matches when ANY of its appetite rows
// satisfies all four conditions. Returns the (carrier, appetite)
// pairs sorted by pricing tendency ascending — the cheapest first.
export function matchCarriersForRisk(
  carriers: Carrier[],
  input: { assetType: AssetType; value: number; riskLevel: RiskLevel; state?: string }
): { carrier: Carrier; appetite: NonNullable<Carrier["appetites"]>[number] }[] {
  const { assetType, value, riskLevel, state } = input;
  const stateOk = (c: Carrier) =>
    !state || c.stateAvailability.length === 0 || c.stateAvailability.includes(state.toUpperCase());
  const matches: { carrier: Carrier; appetite: NonNullable<Carrier["appetites"]>[number] }[] = [];
  for (const c of carriers) {
    if (c.status !== "active") continue;
    if (!stateOk(c)) continue;
    for (const ap of c.appetites ?? []) {
      if (ap.assetType !== assetType) continue;
      if (!ap.riskLevels.includes(riskLevel)) continue;
      if (typeof ap.minValue === "number" && value < ap.minValue) continue;
      if (typeof ap.maxValue === "number" && value > ap.maxValue) continue;
      matches.push({ carrier: c, appetite: ap });
      break; // first matching appetite row per carrier wins
    }
  }
  matches.sort((a, b) => a.appetite.pricingTendency - b.appetite.pricingTendency);
  return matches;
}

export function estimateBallparkPremium(input: BallparkInput): BallparkRange {
  const { assetType, value, riskLevel, carriers, state } = input;
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const baseRate = BASE_RATES[assetType] ?? BASE_RATES.other;
  const riskMultiplier = RISK_MULTIPLIERS[riskLevel] ?? RISK_MULTIPLIERS.medium;
  const rangeHalfWidth = Number.isFinite(input.rangeHalfWidth)
    ? Math.max(0.08, Math.min(0.4, Number(input.rangeHalfWidth)))
    : RANGE_HALF_WIDTH;

  // Carrier-aware bias. When the caller passes a pool of carriers,
  // we filter to those whose appetites match this exact risk (asset
  // type + value band + risk level + state) and average their
  // pricingTendency multipliers. The output is a single
  // `carrierBias` factor we apply to the centerline before the +/-
  // band is computed.
  const matched = carriers ? matchCarriersForRisk(carriers, { assetType, value: safeValue, riskLevel, state }) : [];
  const carrierBias =
    matched.length > 0
      ? matched.reduce((acc, m) => acc + m.appetite.pricingTendency, 0) / matched.length
      : 1.0;

  const centerline = safeValue * baseRate * riskMultiplier * carrierBias;
  const lowerRaw = Math.max(MIN_PREMIUM, centerline * (1 - rangeHalfWidth));
  const upperRaw = Math.min(MAX_PREMIUM, centerline * (1 + rangeHalfWidth));

  const min = snapPremium(lowerRaw);
  const max = snapPremium(Math.max(upperRaw, lowerRaw + 1));

  const summary = `Ballpark range: ${formatUsd(min)} – ${formatUsd(max)} / year (USD). Not a quote.`;
  const disclaimer =
    matched.length > 0
      ? `Indicative only — derived from ${matched.length} carrier appetite${matched.length === 1 ? "" : "s"} matching this risk. Final pricing depends on carrier-specific underwriting review, deductible, and limits selected.`
      : "Indicative only — internal multiplier model, no live carrier data. Final pricing depends on carrier appetite, underwriting review, and the deductible / coverage limits selected.";

  return {
    min,
    max,
    currency: "USD",
    basis: {
      assetType,
      value: safeValue,
      riskLevel,
      baseRate,
      riskMultiplier,
      rangeWidth: rangeHalfWidth,
      carrierBias,
      matchedCarriers: matched.map((m) => ({
        id: m.carrier.id,
        name: m.carrier.name,
        pricingTendency: m.appetite.pricingTendency,
      })),
    },
    summary,
    disclaimer,
  };
}
