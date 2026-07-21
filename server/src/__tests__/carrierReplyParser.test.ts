import { describe, expect, it } from "vitest";
import { parseCarrierReplyDeterministically } from "../services/carrierReplyParser.js";

describe("carrier reply parser", () => {
  it("extracts explicit approved commercial quote terms without an AI dependency", () => {
    const parsed = parseCarrierReplyDeterministically({
      subject: "Re: Commercial application package - Fictional Insured",
      text: `The coverage has been approved based on the information submitted, subject to the following terms:

Carrier: Great Lakes Commercial Insurance Company
Policy Type: Businessowners Policy, including Commercial General Liability and Commercial Property
Proposed Effective Date: August 1, 2026
Annual Premium: $4,850
Policy Limits:
- General Liability: $1,000,000 per occurrence / $2,000,000 aggregate
- Commercial Property: $500,000
Property Deductible: $2,500
Commission: 15%
Required Prior to Binding: Signed ACORD applications and five years of loss runs.

To bind, please send written authorization by July 29, 2026.
Coverage is not bound until written confirmation has been issued by underwriting.`,
    });

    expect(parsed.outcome).toBe("quoted");
    expect(parsed.requiresAgentReview).toBe(false);
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(parsed.policyType).toContain("Businessowners Policy");
    expect(parsed.premiums).toEqual(["$4,850"]);
    expect(parsed.deductibles).toEqual(["$2,500"]);
    expect(parsed.limits.join(" ")).toContain("General Liability");
    expect(parsed.conditions.join(" ")).toContain("Required Prior to Binding");
    expect(parsed.responseDeadline).toBe("2026-07-29");
  });

  it("does not invent a carrier outcome from an ambiguous reply", () => {
    const parsed = parseCarrierReplyDeterministically({
      subject: "Re: application",
      text: "Thank you. The application is with underwriting.",
    });

    expect(parsed.outcome).toBe("pending");
    expect(parsed.requiresAgentReview).toBe(true);
    expect(parsed.premiums).toEqual([]);
  });
});
