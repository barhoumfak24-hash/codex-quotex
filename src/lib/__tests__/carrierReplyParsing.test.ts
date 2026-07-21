import { describe, expect, it, vi } from "vitest";

import { aiParseCarrierReply, fallbackParseCarrierReply } from "@/lib/ai";

const approvedCarrierReply = `
The coverage has been approved based on the information submitted, subject to the following terms:

Carrier: Great Lakes Commercial Insurance Company
Policy Type: Businessowners Policy, including Commercial General Liability and Commercial Property
Proposed Effective Date: August 1, 2026
Annual Premium: $4,850
Policy Limits:
  General Liability: $1,000,000 per occurrence / $2,000,000 aggregate
  Products and Completed Operations: $2,000,000 aggregate
  Commercial Property: $500,000
Property Deductible: $2,500
Commission: 15%
Required Prior to Binding: Signed ACORD applications, five years of currently valued loss runs, confirmation of the monitored fire and burglar alarm systems, and payment of the initial premium deposit.

Please review the approved terms with the insured and let me know whether you would like to proceed with binding coverage. To bind, please send written authorization by July 29, 2026.
Please note that coverage is not bound until written confirmation has been issued by underwriting.
`;

describe("carrier reply parsing", () => {
  it("extracts the explicitly labeled annual premium and approval without treating limits as premiums", () => {
    const parsed = fallbackParseCarrierReply({
      email: {
        subject: "Re: Commercial application package - Fictional Insured",
        text: approvedCarrierReply,
      },
    });

    expect(parsed.outcome).toBe("quoted");
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(parsed.policyType).toContain("Businessowners Policy");
    expect(parsed.premiums).toEqual(["$4,850"]);
    expect(parsed.deductibles).toEqual(["$2,500"]);
    expect(parsed.terms).toContain("Effective date: August 1, 2026");
    expect(parsed.terms).toContain("Commission: 15%");
    expect(parsed.requiresAgentReview).toBe(false);
  });

  it("uses the evidence parser when the server AI route is temporarily unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "ai_failed", message: "temporary provider failure" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    ) as typeof fetch;

    try {
      const parsed = await aiParseCarrierReply({
        email: {
          subject: "Re: Commercial application package - Fictional Insured",
          text: approvedCarrierReply,
        },
      });

      expect(parsed.outcome).toBe("quoted");
      expect(parsed.premiums).toEqual(["$4,850"]);
      expect(parsed.requiresAgentReview).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
