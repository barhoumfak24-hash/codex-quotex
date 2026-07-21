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

  it("treats a general question as a notification, not a full activity", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({ body: "When does my coverage start?" });
    expect(out.disposition).toBe("notification");
    expect(out.warrants).toBe(false);
  });

  it("keeps routine document/payment/renewal updates notification-only", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(aiClassifyInboundForActivity({ body: "I uploaded the signed form." }).disposition).toBe(
      "notification"
    );
    expect(aiClassifyInboundForActivity({ body: "The invoice was paid today." }).disposition).toBe(
      "notification"
    );
    expect(aiClassifyInboundForActivity({ body: "Renewal packet received." }).disposition).toBe(
      "notification"
    );
  });

  it("still opens activities for failed payments and carrier supplementals", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(
      aiClassifyInboundForActivity({ body: "The card was declined and the policy is past due." })
        .disposition
    ).toBe("activity");
    expect(
      aiClassifyInboundForActivity({
        body: "Carrier needs a supplemental before binding.",
        contactKind: "carrier",
      }).disposition
    ).toBe("activity");
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

  it("logs a notification instead of an activity for informational inbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I uploaded the signed form.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(1);
    expect(created[0].task).toBeUndefined();
    expect(created[0].notification?.kind).toBe("inbound_notice");
    const fresh = api.communications.listByCustomer(customer.id).find((c) => c.id === comm.id)!;
    expect(fresh.aiActivityScannedAt).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBeUndefined();
    expect(fresh.aiActivityNotificationId).toBeTruthy();
    expect(
      api.tasks.listByTenant(agency.id).some((t) => t.messageId === comm.id)
    ).toBe(false);
  });

  it("permanently removes an inbound communication and its notification", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "The requested form was uploaded.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    const notificationId = created[0]?.notification?.id;
    expect(notificationId).toBeTruthy();

    expect(api.communications.remove(comm.id)).toBe(true);
    if (notificationId) expect(api.aiNotifications.remove(notificationId)).toBe(true);

    expect(api.communications.listByCustomer(customer.id)).not.toContainEqual(
      expect.objectContaining({ id: comm.id })
    );
    expect(api.aiNotifications.listByTenant(agency.id)).not.toContainEqual(
      expect.objectContaining({ id: notificationId })
    );
  });

  it("skips AI-authored inbound and outbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I need to file a claim",
      createdById: "ai",
    });
    expect(api.communications.sweepInboundForActivities(agency.id).length).toBe(0);
  });
});
