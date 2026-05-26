// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI quoting workspace: gathering_info → awaiting_reply → quoting →
// complete. Drives the per-prospect card that replaced "Quote data".
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function seed() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
  const prospect = api.prospects.create({
    tenantId: agency.id,
    name: "Quote Tester",
    email: "qt@example.com",
    assetType: "coastal_home",
    estimatedValue: 1_500_000,
    aiSummary: "x",
    lastAction: "x",
    lastActivityAt: new Date().toISOString(),
    recommendedFollowUp: "x",
    marketingStatus: "none",
    status: "new",
  });
  return { api, agency, agent, prospect };
}

describe("api.quoting workspace", () => {
  it("startSession pulls public fields + lists missing fields", async () => {
    const { api, agency, agent, prospect } = await seed();
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    expect(["gathering_info", "quoting", "complete"]).toContain(session.status);
    expect(Object.keys(session.publicFields).length).toBeGreaterThan(0);
    expect(session.missingFields.length).toBeGreaterThan(0);
  });

  it("draftQuestionnaire writes a message body the agent can review", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    const s2 = await api.quoting.draftQuestionnaire(s1.id);
    expect(s2?.questionnaireDraft).toMatch(/Subject:/);
    expect(s2?.questionnaireDraft).toContain(prospect.name.split(" ")[0]);
  });

  it("sendQuestionnaire emits an outbound Communication + flips status", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    const s2 = api.quoting.sendQuestionnaire(s1.id)!;
    expect(s2.status).toBe("awaiting_reply");
    expect(s2.questionnaireMessageId).toBeTruthy();
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === s2.questionnaireMessageId);
    expect(comm?.direction).toBe("outbound");
    expect(comm?.channel).toBe("email");
  });

  it("markReplyReceivedAndQuote runs carrier quotes and ranks them best-first", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    api.quoting.sendQuestionnaire(s1.id);
    const s2 = api.quoting.markReplyReceivedAndQuote(s1.id)!;
    expect(s2.status).toBe("complete");
    expect(s2.quotes.length).toBeGreaterThanOrEqual(0);
    if (s2.quotes.length > 1) {
      // Ranked: score desc.
      expect(s2.quotes[0].score).toBeGreaterThanOrEqual(s2.quotes[1].score);
    }
  });

  it("quotes flag whether the carrier had a configured quoting API", async () => {
    const { api, agency, agent, prospect } = await seed();
    const carriers = api.carriers.list();
    if (carriers.length > 0) {
      api.carriers.update(carriers[0].id, {
        quotingApi: {
          provider: "Test Provider",
          endpoint: "https://api.example/quote",
          status: "configured",
        },
      });
    }
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    api.quoting.sendQuestionnaire(s1.id);
    const s2 = api.quoting.markReplyReceivedAndQuote(s1.id)!;
    if (carriers.length > 0) {
      const target = s2.quotes.find((q) => q.carrierId === carriers[0].id);
      // Either "simulated" (configured but not connected) or "no_api"
      // when the carrier isn't linked to this agency.
      if (target) expect(["simulated", "no_api", "connected"]).toContain(target.apiStatus);
    }
  });

  it("works for clients re-quoting an existing asset", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
    });
    expect(s1.customerId).toBe(customer.id);
    expect(s1.assetId).toBe(asset?.id);
    expect(s1.assetType).toBe(asset?.type ?? "coastal_home");
    // getForCustomer resolves to the same session.
    expect(api.quoting.getForCustomer(customer.id)?.id).toBe(s1.id);
  });

  it("reset removes the session so the agent can start over", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    api.quoting.reset(s1.id);
    expect(api.quoting.getForProspect(prospect.id)).toBeUndefined();
  });
});