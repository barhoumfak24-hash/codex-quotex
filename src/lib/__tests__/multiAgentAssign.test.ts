// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Multi-agent client assignment + per-agent visibility.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("customers.assignAgents — multi-agent client routing", () => {
  it("sets the first id as primary and the rest as additionalAgentIds", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const u = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "shared@example.com",
      name: "Shared Client",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: u.id,
      name: "Shared Client",
      email: "shared@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    const updated = api.customers.assignAgents(c.id, [agentA.id, agentB.id]);
    expect(updated!.assignedAgentId).toBe(agentA.id);
    expect(updated!.additionalAgentIds).toEqual([agentB.id]);
  });

  it("spawns a routing task on every newly-routed agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const u = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "multi@example.com",
      name: "Multi Client",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: u.id,
      name: "Multi Client",
      email: "multi@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    api.customers.assignAgents(c.id, [agentA.id, agentB.id]);
    const tasks = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.customerId === c.id);
    const assignees = new Set(tasks.map((t) => t.assignedToId));
    expect(assignees.has(agentA.id)).toBe(true);
    expect(assignees.has(agentB.id)).toBe(true);
  });

  it("both co-assigned agents see the client via listVisible / canSee", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB, third] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const u = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "share@example.com",
      name: "Share Client",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: u.id,
      name: "Share Client",
      email: "share@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    api.customers.assignAgents(c.id, [agentA.id, agentB.id]);
    const refreshed = api.customers.get(c.id)!;
    expect(api.customers.canSee(refreshed, { id: agentA.id, role: "agent" })).toBe(true);
    expect(api.customers.canSee(refreshed, { id: agentB.id, role: "agent" })).toBe(true);
    if (third) {
      expect(api.customers.canSee(refreshed, { id: third.id, role: "agent" })).toBe(false);
    }
    expect(
      api.customers
        .listVisible(agency.id, { id: agentA.id, role: "agent" })
        .some((x) => x.id === c.id)
    ).toBe(true);
    expect(
      api.customers
        .listVisible(agency.id, { id: agentB.id, role: "agent" })
        .some((x) => x.id === c.id)
    ).toBe(true);
  });
});

describe("prospects.assignAgents — multi-agent prospect routing", () => {
  it("sets primary + additionalAgentIds and spawns a task per agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const p = api.prospects.create({
      tenantId: agency.id,
      name: "Multi Prospect",
      email: "mp@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    const updated = api.prospects.assignAgents(p.id, [agentA.id, agentB.id]);
    expect(updated!.assignedAgentId).toBe(agentA.id);
    expect(updated!.additionalAgentIds).toEqual([agentB.id]);
    const tasks = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.prospectId === p.id);
    const assignees = new Set(tasks.map((t) => t.assignedToId));
    expect(assignees.has(agentA.id)).toBe(true);
    expect(assignees.has(agentB.id)).toBe(true);
  });

  it("converting a multi-owner prospect carries the agent list onto the customer", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const p = api.prospects.create({
      tenantId: agency.id,
      name: "Convertable",
      email: "cv@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgents(p.id, [agentA.id, agentB.id]);
    const out = api.prospects.convert(p.id);
    expect(out.customer.assignedAgentId).toBe(agentA.id);
    expect(out.customer.additionalAgentIds).toEqual([agentB.id]);
  });
});

describe("tasks.logManagerOverride — missing-docs gate bypass audit", () => {
  it("writes a task.manager_override row in api.tasks.history", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update needed.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.logManagerOverride(ack.task.id, manager.id, {
      overrideKind: "missing_docs_gate",
      missingDocCount: 3,
    });
    const audit = api.tasks.history(ack.task.id);
    const override = audit.find((a) => a.action === "task.manager_override")!;
    expect(override).toBeTruthy();
    expect(override.actorId).toBe(manager.id);
    expect((override.metadata as { missingDocCount?: number })?.missingDocCount).toBe(3);
  });
});