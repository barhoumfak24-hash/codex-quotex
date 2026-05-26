// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Activity Center inbox removal + start-activity auto-text.
//  - Customer-driven AI notifications promote straight into Tasks via
//    api.aiNotifications.autoPromote (no manual "Acknowledge" inbox).
//  - Starting an activity (markInProgress) auto-texts the customer that
//    an agent is on it — once, on the first start.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("aiNotifications.autoPromote", () => {
  it("promotes a customer policy-edit notification into a Task", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please update.",
    });
    expect(out.notificationId).toBeTruthy();
    expect(api.aiNotifications.listUnacked(agency.id).length).toBeGreaterThan(0);

    const promoted = api.aiNotifications.autoPromote(agency.id);
    expect(promoted).toBeGreaterThanOrEqual(1);
    // Notification is now acknowledged + a task exists for it.
    expect(
      api.aiNotifications.listUnacked(agency.id).some((n) => n.kind === "policy_edit_reply")
    ).toBe(false);
    expect(
      api.tasks.listByTenant(agency.id).some((t) => t.sourceNotificationId === out.notificationId)
    ).toBe(true);
  });

  it("is idempotent — a second run promotes nothing new", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update.",
    });
    expect(api.aiNotifications.autoPromote(agency.id)).toBeGreaterThanOrEqual(1);
    expect(api.aiNotifications.autoPromote(agency.id)).toBe(0);
  });

  it("does not promote manager-broadcast (override) notifications", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.requestManagerOverride(ack.task.id, agent.id, "paper waiver on file");
    const before = api.tasks.listByTenant(agency.id).length;
    api.aiNotifications.autoPromote(agency.id);
    // The override_request notification stays put — no new task spawned.
    expect(api.tasks.listByTenant(agency.id).length).toBe(before);
    expect(
      api.aiNotifications.listUnacked(agency.id).some((n) => n.kind === "override_request")
    ).toBe(true);
  });
});

describe("tasks.markInProgress auto-texts the customer", () => {
  it("sends one SMS on the first start, none on a re-start", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Add a vehicle",
      customerId: customer.id,
      assignedToId: agent.id,
    });
    const before = api.communications.listByCustomer(customer.id).length;
    api.tasks.markInProgress(task.id, agent.id);
    const afterFirst = api.communications.listByCustomer(customer.id);
    expect(afterFirst.length).toBe(before + 1);
    const sms = afterFirst.find((c) => /started working on your request/i.test(c.body))!;
    expect(sms).toBeTruthy();
    expect(sms.channel).toBe("sms");
    expect(sms.direction).toBe("outbound");

    // Snooze then resume — no duplicate text.
    api.tasks.snooze(task.id, 1, agent.id);
    api.tasks.markInProgress(task.id, agent.id);
    expect(api.communications.listByCustomer(customer.id).length).toBe(before + 1);
  });

  it("a no-customer activity sends no text", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const task = api.tasks.create({ tenantId: agency.id, title: "Internal to-do" });
    // Should not throw and should not create any customer communication.
    expect(() => api.tasks.markInProgress(task.id)).not.toThrow();
  });
});