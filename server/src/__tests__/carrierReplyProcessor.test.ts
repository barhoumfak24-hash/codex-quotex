import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  readRemoteState: vi.fn(),
  writeRemoteState: vi.fn(),
  aiParseCarrierReply: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));

vi.mock("../services/supabaseState.js", () => ({
  readRemoteState: mocks.readRemoteState,
  writeRemoteState: mocks.writeRemoteState,
}));

vi.mock("../services/ai/index.js", () => ({
  aiParseCarrierReply: mocks.aiParseCarrierReply,
}));

import { processPersistedCarrierReplies } from "../services/carrierReplyProcessor.js";

beforeEach(() => {
  mocks.queryRaw.mockReset();
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.readRemoteState.mockReset();
  mocks.writeRemoteState.mockReset();
  mocks.aiParseCarrierReply.mockReset();
});

describe("persisted carrier reply processing", () => {
  it("advances the exact tenant submission and records explicit quote terms", async () => {
    mocks.queryRaw.mockResolvedValue([{
      id: "comm_reply_1",
      tenant_id: "tenant_1",
      subject: "Re: Commercial application package - Fictional Insured",
      body: `The coverage has been approved based on the information submitted.
Policy Type: Businessowners Policy
Proposed Effective Date: August 1, 2026
Annual Premium: $4,850
General Liability: $1,000,000 per occurrence / $2,000,000 aggregate
Property Deductible: $2,500
Required Prior to Binding: Signed ACORD applications and five years of loss runs.
To bind, please send written authorization by July 29, 2026.`,
      body_html: null,
      attachments: [],
      resolution: {
        matchedBy: "mailbox_reply_target",
        carrierSubmissionId: "submission_1",
      },
      sent_at: new Date("2026-07-19T23:59:00.000Z"),
      created_at: new Date("2026-07-20T00:00:00.000Z"),
    }]);
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 12,
      snapshot: {
        quotingSessions: [{
          id: "session_1",
          tenantId: "tenant_1",
          status: "awaiting_reply",
          commercialCarrierSubmissions: [{
            submissionId: "submission_1",
            carrierId: "carrier_1",
            status: "awaiting_response",
          }],
        }],
        carrierEmailProcessing: [],
      },
    });
    mocks.writeRemoteState.mockImplementation(async (_id, snapshot, revision) => ({
      ok: true,
      row: { id: "app_state:default", snapshot, revision: Number(revision) + 1 },
    }));

    const summary = await processPersistedCarrierReplies({ tenantId: "tenant_1" });

    expect(summary).toEqual({
      candidates: 1,
      processed: 1,
      alreadyProcessed: 0,
      unmatched: 0,
      failed: 0,
    });
    expect(mocks.aiParseCarrierReply).not.toHaveBeenCalled();
    expect(mocks.writeRemoteState).toHaveBeenCalledTimes(1);
    const written = mocks.writeRemoteState.mock.calls[0]?.[1] as {
      quotingSessions: Array<{ commercialCarrierSubmissions: Array<Record<string, unknown>> }>;
      carrierEmailProcessing: Array<Record<string, unknown>>;
    };
    const submission = written.quotingSessions[0]?.commercialCarrierSubmissions[0];
    expect(submission).toMatchObject({
      status: "accepted",
      finalPremium: 4850,
      premiumEstimate: 4850,
      replyCommunicationIds: ["comm_reply_1"],
    });
    expect(submission?.quote).toMatchObject({
      outcome: "quoted",
      premiums: ["$4,850"],
      deductibles: ["$2,500"],
    });
    expect(written.carrierEmailProcessing[0]).toMatchObject({
      tenantId: "tenant_1",
      communicationId: "comm_reply_1",
      outcome: "matched_processed",
      matchedSubmissionId: "submission_1",
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });
});
