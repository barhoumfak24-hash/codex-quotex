import { describe, expect, it } from "vitest";
import {
  billingCarrierUrl,
  billingFrequencyLabel,
  billingHasMissingInfo,
  billingMethodLabel,
  billingPayerLabel,
  billingStatusFor,
  billingStatusRank,
} from "@/lib/billing";

const NOW = new Date("2026-06-02T12:00:00.000Z");

describe("billing helpers", () => {
  it("derives past-due, due-soon, current, and paid-in-full statuses", () => {
    expect(billingStatusFor({ nextPaymentDueDate: "2026-06-01T00:00:00.000Z" }, NOW)).toBe("past_due");
    expect(billingStatusFor({ nextPaymentDueDate: "2026-06-12T00:00:00.000Z" }, NOW)).toBe("due_soon");
    expect(billingStatusFor({ nextPaymentDueDate: "2026-07-15T00:00:00.000Z" }, NOW)).toBe("current");
    expect(
      billingStatusFor({ billingStatus: "paid_in_full", nextPaymentDueDate: "2026-06-01T00:00:00.000Z" }, NOW)
    ).toBe("paid_in_full");
  });

  it("labels method, payer, and plan fields for the billing page", () => {
    expect(billingMethodLabel("direct_bill")).toBe("Direct bill");
    expect(billingMethodLabel(undefined)).toBe("Missing info");
    expect(billingPayerLabel({ billingPayer: "premium_finance_company" })).toBe("Finance company");
    expect(billingPayerLabel({ billingPayer: "other", billingPayerName: "Whitford Family Office" })).toBe(
      "Whitford Family Office"
    );
    expect(billingFrequencyLabel({ paymentFrequency: "quarterly" })).toBe("Quarterly");
  });

  it("flags missing billing information and prioritizes statuses", () => {
    expect(
      billingHasMissingInfo({ billingMethod: "unknown", paymentFrequency: "monthly", nextPaymentDueDate: "2026-06-12" })
    ).toBe(true);
    expect(
      billingHasMissingInfo({ billingMethod: "direct_bill", paymentFrequency: "monthly", nextPaymentDueDate: "2026-06-12" })
    ).toBe(false);
    expect(billingStatusRank("past_due")).toBeLessThan(billingStatusRank("current"));
  });

  it("prefers carrier billing portal before agent portal fallback", () => {
    expect(billingCarrierUrl({ billingPortalUrl: "https://billing.example", agentPortalUrl: "https://agent.example" })).toBe(
      "https://billing.example"
    );
    expect(billingCarrierUrl({ agentPortalUrl: "https://agent.example" })).toBe("https://agent.example");
  });
});
