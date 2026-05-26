// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI auto-sent acknowledgment for customer-initiated policy edits.
// The AI sends the customer-facing reply immediately on submission
// (no approval gate). The notification + spawned Task still wire
// through the Activity Center so the agent picks up the carrier
// follow-up, but the customer has already received the reply.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("policies.requestEdit — AI auto-sends on submission", () => {
  it("returns sentEmailId + notificationId, marks the email sent, and resolves the inbound comm", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const beforeSent = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "sent" && m.customerId === customer.id).length;

    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please increase the coverage limit to $750k.",
    });

    expect(out.sentEmailId).not.toBeNull();
    expect(out.notificationId).not.toBeNull();
    const afterSent = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "sent" && m.customerId === customer.id);
    expect(afterSent.length).toBe(beforeSent + 1);
    const email = afterSent.find((m) => m.id === out.sentEmailId)!;
    expect(email.subject).toMatch(/^Re: Policy edit request/);
    expect(email.sentAt).toBeTruthy();
    // Inbound comm is resolved at insert time.
    const inbound = api.communications
      .listByCustomer(customer.id)
      .find((c) => c.id === out.commId)!;
    expect(inbound.resolvedAt).toBeTruthy();
  });

  it("bucket: coverage_limit body gets a coverage-comparison reply", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "I'd like to increase my coverage limit to $1M.",
    });
    const email = api.marketing
      .listMessages(agency.id)
      .find((m) => m.id === out.sentEmailId)!;
    expect(email.content).toMatch(/coverage comparison/i);
    expect(email.content).toMatch(/premium impact/i);
  });

  it("bucket: cancellation body gets an alternatives + cancellation-form reply", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please cancel my policy effective next month.",
    });
    const email = api.marketing
      .listMessages(agency.id)
      .find((m) => m.id === out.sentEmailId)!;
    expect(email.content).toMatch(/alternatives|exploring|quick call/i);
    expect(email.content).toMatch(/cancellation form/i);
    const notif = api.aiNotifications
      .listByTenant(agency.id)
      .find((n) => n.id === out.notificationId)!;
    expect(notif.severity).toBe("urgent");
  });

  it("creates an AI notification on the agent's Activity Center with messageId set", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please add my spouse as additional named insured.",
    });
    const notif = api.aiNotifications
      .listByTenant(agency.id)
      .find((n) => n.id === out.notificationId)!;
    expect(notif.kind).toBe("policy_edit_reply");
    expect(notif.customerId).toBe(customer.id);
    expect(notif.messageId).toBe(out.sentEmailId);
    expect(notif.acknowledgedAt).toBeUndefined();
  });
});

describe("aiNotifications.acknowledge — agent press creates the follow-up Task only", () => {
  it("spawns an open task without firing another send (reply went out on submission)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Quick question about my policy.",
    });
    const beforeSent = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "sent" && m.customerId === customer.id).length;
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    // Acknowledge no longer fires a send.
    expect(
      api.marketing
        .listMessages(agency.id)
        .filter((m) => m.deliveryStatus === "sent" && m.customerId === customer.id).length
    ).toBe(beforeSent);
    expect(ack.task.customerId).toBe(customer.id);
    expect(ack.task.source).toBe("ai_notification");
    expect(api.tasks.listOpen(agency.id).some((t) => t.id === ack.task.id)).toBe(true);
  });

  it("marking the task complete moves it off the open list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please update my deductible.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    const done = api.tasks.markComplete(ack.task.id);
    expect(done!.completedAt).toBeTruthy();
    expect(api.tasks.listOpen(agency.id).some((t) => t.id === ack.task.id)).toBe(false);
    expect(api.tasks.listCompleted(agency.id).some((t) => t.id === ack.task.id)).toBe(true);
  });
});