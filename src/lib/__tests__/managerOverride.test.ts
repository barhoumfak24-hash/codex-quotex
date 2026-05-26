// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI resolution checklist + agent-requested manager override.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.checklistFor + canResolve", () => {
  it("a freshly-spawned task starts with the checklist unsatisfied", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update needed.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    const gate = api.tasks.canResolve(ack.task);
    expect(gate.allowed).toBe(false);
    expect(gate.missingSteps).toBeGreaterThan(0);
  });

  it("send actions clear the contact gates but the AI still waits on the policy change", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const carrier = api.carriers.listForTenant(agency.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.markInProgress(ack.task.id, agent.id);
    // Both required outbound actions.
    api.tasks.sendQuestionnaire(ack.task.id, agent.id);
    api.tasks.sendEsignDocuments(ack.task.id, agent.id);
    let refreshed = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === ack.task.id)!;
    // Contact gates are clear, but the AI hasn't seen the policy change
    // land yet — resolve stays locked.
    expect(api.tasks.canResolve(refreshed).allowed).toBe(false);

    // Make the actual policy change → the AI recognizes it + unlocks.
    api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      carrierId: carrier.id,
      status: "bound",
      renewalStatus: "not_due",
      agentId: agent.id,
    });
    refreshed = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === ack.task.id)!;
    expect(api.tasks.canResolve(refreshed).allowed).toBe(true);
  });
});

describe("manager override workflow", () => {
  it("requestManagerOverride flags the task + drops a notification with kind=override_request", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Need.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    const before = api.aiNotifications.listByTenant(agency.id).length;

    const res = api.tasks.requestManagerOverride(
      ack.task.id,
      agent.id,
      "Customer signed a paper waiver in person."
    );

    expect(res.notificationId).toBeTruthy();
    expect(res.task?.overrideRequestedAt).toBeTruthy();
    expect(res.task?.overrideRequestedById).toBe(agent.id);
    expect(res.task?.overrideReason).toMatch(/paper waiver/);
    const after = api.aiNotifications.listByTenant(agency.id);
    expect(after.length).toBe(before + 1);
    const notif = after.find((n) => n.id === res.notificationId)!;
    expect(notif.kind).toBe("override_request");
    expect(notif.taskId).toBe(ack.task.id);
    expect(notif.severity).toBe("urgent");
  });

  it("grantManagerOverride flips canResolve to allowed even with checklist gaps", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Need.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;

    // Before override — locked.
    expect(api.tasks.canResolve(ack.task).allowed).toBe(false);

    api.tasks.grantManagerOverride(ack.task.id, manager.id);

    const refreshed = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === ack.task.id)!;
    expect(refreshed.overrideGrantedAt).toBeTruthy();
    expect(refreshed.overrideGrantedById).toBe(manager.id);
    const gate = api.tasks.canResolve(refreshed);
    expect(gate.allowed).toBe(true);
  });

  it("both request + grant are written to the task audit trail", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Need.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.requestManagerOverride(ack.task.id, agent.id, "reason");
    api.tasks.grantManagerOverride(ack.task.id, manager.id);
    const actions = api.tasks.history(ack.task.id).map((a) => a.action);
    expect(actions).toContain("task.override_requested");
    expect(actions).toContain("task.override_granted");
  });
});