// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  allCommercialCarrierSubmissionsHaveReplies,
  commercialCarrierSubmissionHasReply,
  newestOpenQuotingSessionsPerContact,
  summarizeQuotingWorkflow,
} from "../quotingWorkflows";
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
              mode: "manual_workflow",
            },
          },
        ],
      })
    );

    expect(summary.stage).toBe("Policy implemented");
    expect(summary.isClosed).toBe(true);
  });

  it("keeps a completed commercial workflow pending until every carrier replies", () => {
    const summary = summarizeQuotingWorkflow(
      session({
        status: "complete",
        commercialCarrierSubmissions: [
          {
            carrierId: "carrier_replied",
            status: "accepted",
            score: 0.92,
            fitReason: "Strong appetite",
            aiRationale: "Accepted the application.",
          },
          {
            carrierId: "carrier_pending",
            status: "awaiting_response",
            score: 0.84,
            fitReason: "Appetite match",
            aiRationale: "Waiting for the carrier.",
          },
        ],
      })
    );

    expect(summary.stage).toBe("Awaiting carrier replies");
    expect(summary.tone).toBe("info");
    expect(summary.detail).toBe("1 of 2 carrier replies received.");
  });

  it("turns the ranking summary green after every involved carrier replies", () => {
    const summary = summarizeQuotingWorkflow(
      session({
        status: "complete",
        commercialCarrierSubmissions: [
          {
            carrierId: "carrier_accepted",
            status: "accepted",
            score: 0.92,
            fitReason: "Strong appetite",
            aiRationale: "Accepted the application.",
          },
          {
            carrierId: "carrier_declined",
            status: "declined",
            score: 0.7,
            fitReason: "Outside appetite",
            aiRationale: "Declined the application.",
          },
        ],
      })
    );

    expect(summary.stage).toBe("Ranking ready");
    expect(summary.tone).toBe("success");
  });
});

describe("commercial carrier reply completion", () => {
  const submission = (
    overrides: Partial<NonNullable<QuotingSession["commercialCarrierSubmissions"]>[number]>
  ): NonNullable<QuotingSession["commercialCarrierSubmissions"]>[number] => ({
    carrierId: "carrier_test",
    status: "awaiting_response",
    score: 0.9,
    fitReason: "Appetite match",
    aiRationale: "Selected for the quote flow.",
    ...overrides,
  });

  it("does not treat sent, awaiting, or failed delivery as a carrier reply", () => {
    expect(commercialCarrierSubmissionHasReply(submission({ status: "application_sent" }))).toBe(
      false
    );
    expect(commercialCarrierSubmissionHasReply(submission({ status: "awaiting_response" }))).toBe(
      false
    );
    expect(commercialCarrierSubmissionHasReply(submission({ status: "send_failed" }))).toBe(false);
  });

  it("accepts persisted reply evidence even before a stale status is refreshed", () => {
    expect(
      commercialCarrierSubmissionHasReply(
        submission({
          status: "awaiting_response",
          replyCommunicationIds: ["communication_reply"],
        })
      )
    ).toBe(true);
    expect(
      commercialCarrierSubmissionHasReply(
        submission({ status: "application_sent", responseAt: "2026-07-21T12:00:00.000Z" })
      )
    ).toBe(true);
  });

  it("requires a reply from every carrier involved in the quote flow", () => {
    expect(allCommercialCarrierSubmissionsHaveReplies(session({}))).toBe(false);
    expect(
      allCommercialCarrierSubmissionsHaveReplies(
        session({
          commercialCarrierSubmissions: [
            submission({ carrierId: "carrier_one", status: "accepted" }),
            submission({ carrierId: "carrier_two", status: "awaiting_response" }),
          ],
        })
      )
    ).toBe(false);
    expect(
      allCommercialCarrierSubmissionsHaveReplies(
        session({
          commercialCarrierSubmissions: [
            submission({ carrierId: "carrier_one", status: "accepted" }),
            submission({ carrierId: "carrier_two", status: "declined" }),
            submission({ carrierId: "carrier_three", status: "needs_client_info" }),
          ],
        })
      )
    ).toBe(true);
  });
});

describe("newestOpenQuotingSessionsPerContact", () => {
  it("keeps only the newest open flow per client without dropping other clients", () => {
    const older = session({
      id: "qs_older",
      customerId: "customer_one",
      updatedAt: "2026-06-01T12:00:00.000Z",
    });
    const newer = session({
      id: "qs_newer",
      customerId: "customer_one",
      updatedAt: "2026-06-01T13:00:00.000Z",
    });
    const otherClient = session({
      id: "qs_other",
      customerId: "customer_two",
      updatedAt: "2026-06-01T12:30:00.000Z",
    });

    expect(
      newestOpenQuotingSessionsPerContact([older, otherClient, newer]).map((row) => row.id)
    ).toEqual(["qs_newer", "qs_other"]);
  });

  it("allows a new open flow after an older flow has been implemented", () => {
    const implemented = session({
      id: "qs_implemented",
      customerId: "customer_one",
      updatedAt: "2026-06-01T14:00:00.000Z",
      quotes: [
        {
          carrierId: "carrier_one",
          premium: 12000,
          confidence: 0.9,
          score: 0.92,
          fitReason: "Strong appetite",
          apiStatus: "simulated",
          implementation: {
            status: "implemented",
            policyId: "policy_one",
            carrierReference: "REF-1",
            implementedAt: "2026-06-01T14:00:00.000Z",
            implementedById: "user_agent",
            mode: "manual_workflow",
          },
        },
      ],
    });
    const next = session({
      id: "qs_next",
      customerId: "customer_one",
      updatedAt: "2026-06-01T15:00:00.000Z",
    });

    expect(newestOpenQuotingSessionsPerContact([implemented, next]).map((row) => row.id)).toEqual([
      "qs_next",
    ]);
  });

  it("does not count document-only ACORD work as an open quote flow", () => {
    const quoteFlow = session({
      id: "qs_quote_flow",
      customerId: "customer_one",
      updatedAt: "2026-06-01T13:00:00.000Z",
    });
    const documentOnly = session({
      id: "qs_document_only",
      customerId: "customer_one",
      updatedAt: "2026-06-01T14:00:00.000Z",
      aiSummary: "ACORD documents initialized from the client Documents card.",
    });

    expect(newestOpenQuotingSessionsPerContact([quoteFlow, documentOnly]).map((row) => row.id)).toEqual([
      "qs_quote_flow",
    ]);
  });
});
