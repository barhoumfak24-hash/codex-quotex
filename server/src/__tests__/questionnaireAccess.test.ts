import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRemoteState: vi.fn(),
  writeRemoteState: vi.fn(),
}));

vi.mock("../services/supabaseState.js", () => ({
  readRemoteState: mocks.readRemoteState,
  writeRemoteState: mocks.writeRemoteState,
}));

import {
  readPublicQuestionnaire,
  updatePublicQuestionnaire,
} from "../services/questionnaireAccess.js";

const accessToken = "a".repeat(48);

function snapshot() {
  return {
    customers: [{ id: "customer_1", name: "Fictional Insured" }],
    prospects: [],
    quotingSessions: [{
      id: "quote_session_internal",
      tenantId: "tenant_1",
      customerId: "customer_1",
      lineOfBusiness: "personal",
      status: "awaiting_reply",
      questionnaireSentAt: "2026-07-22T20:00:00.000Z",
      questionnaireAccessToken: accessToken,
      questionnaireQuestions: [
        {
          id: "vin",
          section: "Vehicle",
          label: "Vehicle identification number",
          kind: "text",
          required: true,
        },
        {
          id: "notes",
          section: "Vehicle",
          label: "Additional notes",
          kind: "textarea",
        },
      ],
      questionnaireResponses: {},
      questionnaireResponseMeta: {
        notes: {
          updatedAt: "2026-07-22T20:01:00.000Z",
          updatedByName: "Agent One",
          updatedByRole: "agent",
          updatedById: "user_secret",
          sourceUrl: "https://internal.example/evidence",
        },
      },
      createdAt: "2026-07-22T19:00:00.000Z",
      updatedAt: "2026-07-22T20:00:00.000Z",
    }],
  };
}

beforeEach(() => {
  mocks.readRemoteState.mockReset();
  mocks.writeRemoteState.mockReset();
});

describe("public questionnaire access", () => {
  it("resolves an opaque email token without exposing internal edit metadata", async () => {
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 4,
      snapshot: snapshot(),
    });

    const questionnaire = await readPublicQuestionnaire(accessToken);

    expect(questionnaire).toMatchObject({
      contactName: "Fictional Insured",
      lineOfBusiness: "personal",
      status: "awaiting_reply",
    });
    expect(questionnaire?.questions).toHaveLength(2);
    expect(questionnaire?.responseMeta.notes).toEqual({
      updatedAt: "2026-07-22T20:01:00.000Z",
      updatedByName: "Agent One",
      updatedByRole: "agent",
    });
  });

  it("saves answers and advances a complete personal questionnaire", async () => {
    const state = snapshot();
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 4,
      snapshot: state,
    });
    mocks.writeRemoteState.mockImplementation(async (id, nextSnapshot, revision) => ({
      ok: true,
      row: { id, snapshot: nextSnapshot, revision: Number(revision) + 1 },
    }));

    const result = await updatePublicQuestionnaire(
      accessToken,
      { vin: "1HGCM82633A004352", ignored: "not a questionnaire field" },
      true
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missingRequired).toEqual([]);
    expect(result.questionnaire.status).toBe("quoting");
    expect(result.questionnaire.responses).toEqual({ vin: "1HGCM82633A004352" });
    expect(mocks.writeRemoteState).toHaveBeenCalledTimes(1);
    const written = mocks.writeRemoteState.mock.calls[0]?.[1] as ReturnType<typeof snapshot>;
    expect(written.quotingSessions[0]?.questionnaireResponses).toEqual({
      vin: "1HGCM82633A004352",
    });
    expect(written.quotingSessions[0]?.replyReceivedAt).toEqual(expect.any(String));
  });

  it("keeps an incomplete personal questionnaire open while preserving the draft", async () => {
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 4,
      snapshot: snapshot(),
    });
    mocks.writeRemoteState.mockImplementation(async (id, nextSnapshot, revision) => ({
      ok: true,
      row: { id, snapshot: nextSnapshot, revision: Number(revision) + 1 },
    }));

    const result = await updatePublicQuestionnaire(accessToken, { notes: "Saved for later" }, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missingRequired).toEqual(["Vehicle identification number"]);
    expect(result.questionnaire.status).toBe("awaiting_reply");
    expect(result.questionnaire.responses.notes).toBe("Saved for later");
  });
});
