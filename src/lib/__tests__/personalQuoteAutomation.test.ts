// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractQuoteReplyIntake,
  normalizedQuoteIdentifier,
} from "../personalQuoteAutomation";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { resetAiResourceGovernor } = await import("../aiResourceGovernor");
  resetAiResourceGovernor();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("extractQuoteReplyIntake", () => {
  it("extracts and normalizes a VIN from a personal quote reply", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Re: Vehicle quote request",
        body: "This is personal. The VIN is 1hgcm82633a004352.",
        priorQuoteContext: "Please send the VIN so I can start your quote.",
      })
    ).toEqual({
      line: "personal",
      identifierKind: "vin",
      identifier: "1HGCM82633A004352",
      assetType: "luxury_vehicle",
    });
  });

  it("extracts a spaced VIN and personal line from the exact customer reply", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Re: Vehicle quote request",
        body:
          "Hello, it's a personal vehicle and the vin number is 2C3 CDXMG3PH675983 Culture",
        priorQuoteContext:
          "Please send the vehicle's 17-character VIN and whether it is personal or commercial.",
      })
    ).toEqual({
      line: "personal",
      identifierKind: "vin",
      identifier: "2C3CDXMG3PH675983",
      assetType: "luxury_vehicle",
    });
  });

  it("keeps explicit commercial replies manual even for a personal contact", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Re: Truck quote",
        body: "It is for my business. VIN 1HGCM82633A004352.",
        priorQuoteContext: "Please send the VIN for the quote.",
        contactLine: "personal",
      })
    ).toMatchObject({ line: "commercial", identifierKind: "vin" });
  });

  it("extracts a street address from the newest reply without quoted history", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Re: Home quote",
        body: [
          "The property address is 901 McDonald Dr, Northville, MI 48167.",
          "",
          "On Tue, Jul 21, 2026 at 9:12 AM Agent wrote:",
          "Please send the address for the quote.",
        ].join("\n"),
        contactLine: "personal",
      })
    ).toEqual({
      line: "personal",
      identifierKind: "address",
      identifier: "901 McDonald Dr, Northville, MI 48167",
      assetType: "coastal_home",
    });
  });

  it("extracts a hull identifier and generic asset identifier", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Boat quote",
        body: "Personal yacht quote. HIN ABC12345D404",
      })
    ).toMatchObject({
      line: "personal",
      identifierKind: "hin",
      identifier: "ABC12345D404",
      assetType: "yacht",
    });
    expect(
      extractQuoteReplyIntake({
        subject: "Jewelry quote",
        body: "Personal jewelry quote. Appraisal ID ring-82716",
      })
    ).toMatchObject({
      line: "personal",
      identifierKind: "asset_id",
      identifier: "RING-82716",
      assetType: "jewelry",
    });
  });

  it("does not start a flow from an identifier without quote context", () => {
    expect(
      extractQuoteReplyIntake({
        subject: "Account update",
        body: "For your records: 1HGCM82633A004352",
        contactLine: "personal",
      })
    ).toBeNull();
  });
});

describe("normalizedQuoteIdentifier", () => {
  it("matches equivalent VINs and addresses consistently", () => {
    expect(normalizedQuoteIdentifier("vin", "1hgcm82633a004352")).toBe(
      "1HGCM82633A004352"
    );
    expect(normalizedQuoteIdentifier("address", "901 McDonald Dr, Northville, MI")).toBe(
      "901mcdonalddrnorthvillemi"
    );
  });
});

describe("communications.automatePersonalQuoteReplies", () => {
  it("starts the personal quote flow instead of drafting for a spaced VIN reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/ai/enrich-asset") {
          return new Response(
            JSON.stringify({
              fields: {},
              evidence: {},
              sources: [],
              confidence: 0,
              unavailableFields: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "/api/ai/acord-map") {
          return new Response(
            JSON.stringify({
              fields: {},
              publicFieldEvidence: {},
              mappings: [],
              missingFields: [],
              webSources: [],
              summary: "No additional verified public answers were found.",
              confidence: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 404 });
      })
    );

    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const owner = api.users.list(agency.id).find((user) => user.active && user.role === "agent")!;
    api.customers.update(customer.id, {
      lineOfBusiness: "personal",
      assignedAgentId: owner.id,
    });
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Vehicle quote request",
      body:
        "Please send the vehicle's 17-character VIN and whether it is personal or commercial.",
      createdById: owner.id,
    });
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Re: Vehicle quote request",
      body:
        "Hello, it's a personal vehicle and the vin number is 2C3 CDXMG3PH675983 Culture",
    });

    const result = await api.communications.automatePersonalQuoteReplies(
      agency.id,
      owner.id,
      inbound.id
    );

    expect(result).toEqual([
      expect.objectContaining({
        communicationId: inbound.id,
        status: "completed",
      }),
    ]);
    const session = api.quoting.get(result[0].sessionId!)!;
    const asset = api.assets.get(result[0].assetId!)!;
    expect(session.lineOfBusiness).toBe("personal");
    expect(asset.details).toEqual(
      expect.objectContaining({ vin: "2C3CDXMG3PH675983" })
    );
    expect(
      db
        .list("communications")
        .filter((row) => row.aiDraftSourceCommunicationId === inbound.id)
    ).toHaveLength(0);
  });

  it("starts one personal flow and sends one questionnaire for an address reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/ai/enrich-asset") {
          return new Response(
            JSON.stringify({
              fields: {},
              evidence: {},
              sources: [],
              confidence: 0,
              unavailableFields: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url === "/api/ai/acord-map") {
          return new Response(
            JSON.stringify({
              fields: {},
              publicFieldEvidence: {},
              mappings: [],
              missingFields: [],
              webSources: [],
              summary: "No additional verified public answers were found.",
              confidence: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 404 });
      })
    );

    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const owner = api.users.list(agency.id).find((user) => user.active && user.role === "agent")!;
    api.customers.update(customer.id, {
      lineOfBusiness: "personal",
      assignedAgentId: owner.id,
      additionalAgentIds: undefined,
    });
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Re: Home quote request",
      body: "Please send the property address so I can start your personal home quote.",
      createdById: owner.id,
    });
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Re: Home quote request",
      body: "It is personal. The property is 777 Test Lake Rd, Detroit, MI 48201.",
    });
    const assetsBefore = api.assets.listByCustomer(customer.id).length;
    const sessionsBefore = db
      .list("quotingSessions")
      .filter((session) => session.customerId === customer.id).length;
    const outboxBefore = db.list("mailboxOutbox").length;

    const first = await api.communications.automatePersonalQuoteReplies(
      agency.id,
      owner.id,
      inbound.id
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: "completed" });
    expect(api.assets.listByCustomer(customer.id)).toHaveLength(assetsBefore + 1);
    expect(
      db.list("quotingSessions").filter((candidate) => candidate.customerId === customer.id)
    ).toHaveLength(sessionsBefore + 1);
    const session = api.quoting.get(first[0].sessionId!)!;
    expect(session.lineOfBusiness).toBe("personal");
    expect(session.status).toBe("awaiting_reply");
    expect(session.questionnaireMessageId).toBeTruthy();
    expect(session.personalQuestionnairePreparedAt).toBeTruthy();
    expect(session.questionnaireQuestions?.some((question) => question.required)).toBe(true);
    expect(session.questionnaireQuestions?.some((question) => !question.required)).toBe(true);
    expect(
      session.missingFields.every((label) =>
        session.questionnaireQuestions?.some(
          (question) => question.required && question.label === label
        )
      )
    ).toBe(true);
    const processedInbound = db
      .list("communications")
      .find((communication) => communication.id === inbound.id)!;
    const linkedActivity = db
      .list("tasks")
      .find((task) => task.id === processedInbound.aiActivityTaskId)!;
    expect(linkedActivity).toMatchObject({
      quoteSessionId: session.id,
      status: "in_progress",
      assignedToId: owner.id,
      startedById: "ai",
    });
    expect(linkedActivity.startedAt).toBeTruthy();
    const questionnaireOutbox = db
      .list("mailboxOutbox")
      .find((job) => job.communicationId === session.questionnaireMessageId);
    expect(db.list("mailboxOutbox")).toHaveLength(outboxBefore + 1);
    expect(questionnaireOutbox).toMatchObject({ status: "queued" });

    expect(
      await api.communications.automatePersonalQuoteReplies(agency.id, owner.id, inbound.id)
    ).toHaveLength(0);
    expect(api.assets.listByCustomer(customer.id)).toHaveLength(assetsBefore + 1);
    expect(
      db.list("quotingSessions").filter((candidate) => candidate.customerId === customer.id)
    ).toHaveLength(sessionsBefore + 1);

    const responses = Object.fromEntries(
      (session.questionnaireQuestions ?? []).map((question) => [
        question.id,
        question.options?.[0] ?? "Provided by client",
      ])
    );
    const completedSession = api.quoting.submitQuestionnaireResponses(
      session.id,
      responses,
      { id: customer.id, name: customer.name, role: "customer" }
    )!;
    expect(completedSession.status).toBe("complete");
    expect(db.list("tasks").find((task) => task.id === linkedActivity.id)).toMatchObject({
      quoteSessionId: session.id,
      status: "in_progress",
      assignedToId: owner.id,
    });
    expect(
      db
        .list("tasks")
        .filter(
          (task) =>
            task.messageId === inbound.id ||
            (task.quoteSessionId === session.id && !task.activityKey?.startsWith("quote-session:"))
        )
    ).toHaveLength(1);
    expect(
      db
        .list("audit")
        .filter(
          (entry) =>
            entry.entityId === linkedActivity.id &&
            entry.action === "task.in_progress_by_personal_quote_automation"
        )
    ).toHaveLength(1);
    expect(
      db
        .list("audit")
        .filter(
          (entry) =>
            entry.entityId === linkedActivity.id &&
            entry.action === "task.resolved_by_personal_quote_automation"
        )
    ).toHaveLength(0);
  });

  it("keeps an explicitly commercial identifier reply manual", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const owner = api.users.list(agency.id).find((user) => user.active && user.role === "agent")!;
    api.customers.update(customer.id, {
      lineOfBusiness: "personal",
      assignedAgentId: owner.id,
    });
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Commercial truck quote",
      body: "This is for my business. VIN 1HGCM82633A004352.",
    });
    const assetsBefore = api.assets.listByCustomer(customer.id).length;
    const sessionsBefore = db
      .list("quotingSessions")
      .filter((session) => session.customerId === customer.id).length;

    const result = await api.communications.automatePersonalQuoteReplies(
      agency.id,
      owner.id,
      inbound.id
    );
    expect(result).toEqual([
      expect.objectContaining({ communicationId: inbound.id, status: "manual" }),
    ]);
    expect(api.assets.listByCustomer(customer.id)).toHaveLength(assetsBefore);
    expect(
      db.list("quotingSessions").filter((candidate) => candidate.customerId === customer.id)
    ).toHaveLength(sessionsBefore);
    const processedInbound = db
      .list("communications")
      .find((communication) => communication.id === inbound.id)!;
    expect(
      db.list("tasks").find((task) => task.id === processedInbound.aiActivityTaskId)
    ).toMatchObject({ status: "open", assignedToId: owner.id });
  });
});
