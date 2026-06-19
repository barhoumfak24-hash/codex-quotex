export const QUOTE_MATCH_CRITERIA = [
  { key: "appetite", label: "Carrier appetite / line fit", weight: 40 },
  { key: "valueBand", label: "Risk value inside carrier band", weight: 20 },
  { key: "state", label: "State availability", weight: 20 },
  { key: "pricing", label: "Pricing tendency", weight: 20 },
] as const;

export type QuoteMatchTone = "excellent" | "strong" | "good" | "review" | "weak";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function quotePricingTendencyScore(pricingTendency?: number): number {
  if (typeof pricingTendency !== "number" || !Number.isFinite(pricingTendency) || pricingTendency <= 0) {
    return 0;
  }

  // 0.90x or lower earns the full pricing-fit weight. 1.30x or higher
  // earns none; values between those points taper predictably.
  return clamp((1.3 - pricingTendency) / 0.4, 0, 1) * 0.2;
}

export function quoteMatchPercent(score?: number | null): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  return Math.round(clamp(score, 0, 1) * 100);
}

export function quoteMatchTone(percent: number): QuoteMatchTone {
  if (percent >= 90) return "excellent";
  if (percent >= 80) return "strong";
  if (percent >= 70) return "good";
  if (percent >= 60) return "review";
  return "weak";
}

export function quoteMatchBadgeClass(percent: number): string {
  const tone = quoteMatchTone(percent);
  if (tone === "excellent") return "border-emerald-200 bg-emerald-100 text-emerald-900";
  if (tone === "strong") return "border-green-200 bg-green-50 text-green-800";
  if (tone === "good") return "border-gold-200 bg-gold-50 text-gold-800";
  if (tone === "review") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-red-200 bg-red-50 text-red-700";
}

export function quoteMatchCriteriaTitle(percent: number): string {
  const criteria = QUOTE_MATCH_CRITERIA.map((criterion) => `${criterion.label} ${criterion.weight}%`).join("; ");
  return `${percent}% match based on ${criteria}.`;
}
