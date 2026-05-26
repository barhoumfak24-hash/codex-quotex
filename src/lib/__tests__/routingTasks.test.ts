// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Routing → Activity Center: when a manager assigns an unrouted
// prospect or client to an agent (including themselves), the
// platform spawns a Task on that agent's queue so the work
// actually shows up in their Activity Center.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("prospects.assignAgent — routing surfaces in the Activity Center", () => {
  it("assigning an unrouted prospect spawns a follow-up task on the agent's queue", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Routable Prospect",
      email: "r@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    const beforeTasks = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.assignedToId === agent.id).length;

    api.prospects.assignAgent(prospect.id, agent.id, manager.id);

    const afterTasks = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.assignedToId === agent.id);
    expect(afterTasks.length).toBe(beforeTasks + 1);
    const routedTask = afterTasks.find((t) => t.prospectId === prospect.id)!;
    expect(routedTask.title).toMatch(/new prospect assigned/i);
    expect(routedTask.assignedToId).toBe(agent.id);
    expect(api.tasks.statusOf(routedTask)).toBe("open");
  });

  it("manager assigning a prospect to themselves shows up in their own queue", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Self-route",
      email: "s@example.com",
      assetType: "jewelry",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, manager.id, manager.id);
    const ownQueue = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.assignedToId === manager.id);
    expect(ownQueue.some((t) => t.prospectId === prospect.id)).toBe(true);
  });

  it("re-assigning an already-routed prospect does NOT spawn another task", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Re-route",
      email: "rr@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agentA.id);
    const after1 = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.prospectId === prospect.id).length;
    api.prospects.assignAgent(prospect.id, agentB.id);
    const after2 = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.prospectId === prospect.id).length;
    expect(after2).toBe(after1);
  });
});

describe("customers.assignAgent — same routing flow for clients", () => {
  it("assigning a previously-unassigned client spawns a task on the agent's queue", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    // Create an unassigned customer
    const u = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "unassigned@example.com",
      name: "Unassigned Client",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: u.id,
      name: "Unassigned Client",
      email: "unassigned@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    api.customers.assignAgent(c.id, agent.id, agent.id);

    const tasks = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.customerId === c.id && t.assignedToId === agent.id);
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toMatch(/new client assigned/i);
  });
});