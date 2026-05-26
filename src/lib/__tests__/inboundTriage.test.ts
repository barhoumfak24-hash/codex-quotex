// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI inbound triage — auto-creating activities from incoming messages.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("aiClassifyInboundForActivity", () => {
  it("ignores pure acknowledgements", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(aiClassifyInboundForActivity({ body: "thanks!" }).warrants).toBe(false);
    expect(aiClassifyInboundForActivity({ body: "Got it 👍" }).warrants).toBe(false);
  });

  it("flags an add-a-vehicle request as a coverage change", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      body: "Can you add a new vehicle to my policy?",
      contactName: "Alexandra",
    });
    expect(out.warrants).toBe(true);
    expect(out.topic).toBe("coverage_change");
    expect(out.title).toMatch(/Alexandra/);
  });

  it("flags a loss/accident as an urgent claim", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({ body: "I was in a car accident yesterday." });
    expect(out.warrants).toBe(true);
    expect(out.topic).toBe("claim_filed");
    expect(out.severity).toBe("urgent");
  });

  it("treats a general question as a low-priority follow-up", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({ body: "When does my coverage start?" });
    expect(out.warrants).toBe(true);
  });
});

describe("communications.sweepInboundForActivities", () => {
  it("auto-creates an activity for an inbound message that needs follow-up + links it", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Please add a new vehicle to my policy.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created.length).toBeGreaterThanOrEqual(1);
    const fresh = api.communications.listByCustomer(customer.id).find((c) => c.id === comm.id)!;
    expect(fresh.aiActivityScannedAt).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBeTruthy();
    const task = api.tasks.listByTenant(agency.id).find((t) => t.id === fresh.aiActivityTaskId)!;
    expect(task).toBeTruthy();
    expect(task.assignedToId).toBe(customer.assignedAgentId);
    expect(task.messageId).toBe(comm.id);
  });

  it("does not create an activity for an acknowledgement, and is idempotent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Thank you so much!",
    });
    const before = api.tasks.listByTenant(agency.id).length;
    api.communications.sweepInboundForActivities(agency.id);
    expect(api.tasks.listByTenant(agency.id).length).toBe(before);
    // Second sweep is a no-op (already scanned).
    expect(api.communications.sweepInboundForActivities(agency.id).length).toBe(0);
  });

  it("skips AI-authored inbound and outbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "sms",
      direction: "inbound",
      body: "I need to file a claim",
      createdById: "ai",
    });
    expect(api.communications.sweepInboundForActivities(agency.id).length).toBe(0);
  });
});