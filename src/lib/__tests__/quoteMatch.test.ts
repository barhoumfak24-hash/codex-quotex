import { describe, expect, it } from "vitest";
import {
  quoteMatchBadgeClass,
  quoteMatchCriteriaTitle,
  quoteMatchPercent,
  quoteMatchTone,
  quotePricingTendencyScore,
} from "../quoteMatch";

describe("quote match criteria", () => {
  it("normalizes composite scores into visible percentages", () => {
    expect(quoteMatchPercent(0.875)).toBe(88);
    expect(quoteMatchPercent(1.25)).toBe(100);
    expect(quoteMatchPercent(-0.4)).toBe(0);
    expect(quoteMatchPercent(undefined)).toBe(0);
  });

  it("color-codes match tiers by preconceived thresholds", () => {
    expect(quoteMatchTone(94)).toBe("excellent");
    expect(quoteMatchTone(84)).toBe("strong");
    expect(quoteMatchTone(72)).toBe("good");
    expect(quoteMatchTone(64)).toBe("review");
    expect(quoteMatchTone(42)).toBe("weak");
    expect(quoteMatchBadgeClass(42)).toContain("red");
    expect(quoteMatchBadgeClass(88)).toContain("green");
  });

  it("uses pricing tendency as the fourth weighted criteria", () => {
    expect(quotePricingTendencyScore(0.9)).toBeCloseTo(0.2);
    expect(quotePricingTendencyScore(1.1)).toBeCloseTo(0.1);
    expect(quotePricingTendencyScore(1.3)).toBe(0);
  });

  it("explains the criteria behind the percentage", () => {
    const title = quoteMatchCriteriaTitle(88);
    expect(title).toContain("88% match");
    expect(title).toContain("Carrier appetite / line fit 40%");
    expect(title).toContain("Pricing tendency 20%");
  });
});
