// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { summarizeQuotingWorkflow } from "../quotingWorkflows";
import type { QuotingSession } from "@/types";

function session(overrides: Partial<QuotingSession>): QuotingSession {
  return {
    id: "qs_test",
    tenantId: "tenant_demo",
    customerId: "customer_demo",
    createdById: "user_agent",
    assetType: "other",
    estimatedValue: 1_000_000,
    lineOfBusiness: "commercial",
    status: "awaiting_reply",
    publicFields: {},
    missingFields: [],
    quotes: [],
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeQuotingWorkflow", () => {
  it("shows accepted commercial rankings while supplemental info is still missing", () => {
    const summary = summarizeQuotingWorkflow(
      session({
        commercialSecondRoundSentAt: "2026-06-01T12:30:00.000Z",
        commercialCarrierSubmissions: [
          {
            carrierId: "carrier_accepted",
            status: "accepted",
            sentAt: "2026-06-01T12:00:00.000Z",
            score: 0.92,
            fitReason: "Strong appetite",
            aiRationale: "Accepted without more client data.",
          },
          {
            carrierId: "carrier_waiting",
            status: "needs_client_info",
            sentAt: "2026-06-01T12:00:00.000Z",
            score: 0.82,
            fitReason: "Needs details",
            aiRationale: "Supplemental requested.",
            missingFields: ["Payroll by state"],
          },
        ],
        quotes: [
          {
            carrierId: "carrier_accepted",
            premium: 12000,
            confidence: 0.9,
            score: 0.92,
            fitReason: "Strong appetite",
            apiStatus: "simulated",
          },
        ],
      })
    );

    expect(summary.stage).toBe("Accepted ranking live");
    expect(summary.acceptedCount).toBe(1);
    expect(summary.waitingCount).toBe(1);
    expect(summary.quoteCount).toBe(1);
    expect(summary.isClosed).toBe(false);
  });

  it("marks implemented quote workflows as closed", () => {
    const summary = summarizeQuotingWorkflow(
      session({
        status: "complete",
        quotes: [
          {
            carrierId: "carrier_accepted",
            premium: 12000,
            confidence: 0.9,
            score: 0.92,
            fitReason: "Strong appetite",
            apiStatus: "simulated",
            implementation: {
              status: "implemented",
              policyId: "policy_bound",
              carrierReference: "REF-123",
              implementedAt: "2026-06-01T13:00:00.000Z",
              implementedById: "user_agent",
              mode: "demo_adapter",
            },
          },
        ],
      })
    );

    expect(summary.stage).toBe("Policy implemented");
    expect(summary.isClosed).toBe(true);
  });
});
