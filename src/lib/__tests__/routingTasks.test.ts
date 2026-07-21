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

describe("auto routing", () => {
  it("auto-routes new personal-line prospects evenly across personal-line agents", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const seededPersonalAgent = api.users
      .list(agency.id)
      .find((u) => u.role === "agent" && u.lineOfBusiness === "personal")!;
    const secondPersonalAgent = api.users.create({
      tenantId: agency.id,
      role: "agent",
      email: "personal-two@example.com",
      name: "Personal Two",
      lineOfBusiness: "personal",
    });
    const commercialAgent = api.users.create({
      tenantId: agency.id,
      role: "agent",
      email: "commercial-only@example.com",
      name: "Commercial Only",
      lineOfBusiness: "commercial",
    });

    const first = api.prospects.create({
      tenantId: agency.id,
      name: "Personal Prospect One",
      email: "personal-one@example.com",
      lineOfBusiness: "personal",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    const second = api.prospects.create({
      tenantId: agency.id,
      name: "Personal Prospect Two",
      email: "personal-two-prospect@example.com",
      lineOfBusiness: "personal",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });

    expect(new Set([first.assignedAgentId, second.assignedAgentId])).toEqual(
      new Set([seededPersonalAgent.id, secondPersonalAgent.id])
    );
    expect(first.assignedAgentId).not.toBe(commercialAgent.id);
    expect(second.assignedAgentId).not.toBe(commercialAgent.id);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .filter((task) => [first.id, second.id].includes(task.prospectId ?? ""))
        .map((task) => task.assignedToId)
        .sort()
    ).toEqual([first.assignedAgentId, second.assignedAgentId].sort());
  });

  it("auto-routes commercial clients to commercial-line agents and balances the load", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const commercialA = api.users.create({
      tenantId: agency.id,
      role: "agent",
      email: "commercial-a@example.com",
      name: "Commercial A",
      lineOfBusiness: "commercial",
    });
    const commercialB = api.users.create({
      tenantId: agency.id,
      role: "agent",
      email: "commercial-b@example.com",
      name: "Commercial B",
      lineOfBusiness: "commercial",
    });

    const userA = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "commercial-client-a@example.com",
      name: "Commercial Client A",
    });
    const first = api.customers.create({
      tenantId: agency.id,
      userId: userA.id,
      lineOfBusiness: "commercial",
      businessName: "Commercial Client A LLC",
      name: "Alex Owner",
      email: userA.email,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    const userB = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "commercial-client-b@example.com",
      name: "Commercial Client B",
    });
    const second = api.customers.create({
      tenantId: agency.id,
      userId: userB.id,
      lineOfBusiness: "commercial",
      businessName: "Commercial Client B LLC",
      name: "Blake Owner",
      email: userB.email,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    expect(new Set([first.assignedAgentId, second.assignedAgentId])).toEqual(
      new Set([commercialA.id, commercialB.id])
    );
    expect(
      api.tasks
        .listByTenant(agency.id)
        .filter((task) => [first.id, second.id].includes(task.customerId ?? ""))
        .map((task) => task.assignedToId)
        .sort()
    ).toEqual([first.assignedAgentId, second.assignedAgentId].sort());
  });
});

describe("account ownership inheritance", () => {
  it("does not route a new client away from an existing CSR assignment", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const csr = api.users.create({
      tenantId: agency.id,
      role: "csr",
      email: "account-csr@example.com",
      name: "Account CSR",
    });
    const login = api.users.create({
      tenantId: agency.id,
      role: "customer",
      email: "csr-owned-client@example.com",
      name: "CSR Owned Client",
    });

    const client = api.customers.create({
      tenantId: agency.id,
      userId: login.id,
      name: login.name,
      email: login.email,
      lineOfBusiness: "personal",
      assignedCsrId: csr.id,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    expect(client.assignedAgentId).toBeUndefined();
    expect(client.assignedCsrId).toBe(csr.id);
    expect(api.routing.hasAssignedOwner("client", client.id)).toBe(true);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some((task) => task.customerId === client.id && /new client assigned/i.test(task.title))
    ).toBe(false);
  });

  it("does not silently route an existing ownerless account when its profile is edited", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const login = api.users.create({
      tenantId: agency.id,
      role: "customer",
      email: "existing-unassigned@example.com",
      name: "Existing Unassigned",
    });
    const client = api.customers.create({
      tenantId: agency.id,
      userId: login.id,
      name: login.name,
      email: login.email,
      marketingOptInEmail: false,
      marketingOptInSms: false,
      skipAutoRoute: true,
    });

    const updated = api.customers.update(client.id, { lineOfBusiness: "commercial" });

    expect(updated?.assignedAgentId).toBeUndefined();
    expect(api.routing.hasAssignedOwner("client", client.id)).toBe(false);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some((task) => task.customerId === client.id && /new client assigned/i.test(task.title))
    ).toBe(false);
  });

  it("assigns account-linked activities to every staff member handling the account", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const csr = api.users.create({
      tenantId: agency.id,
      role: "csr",
      email: "shared-account-csr@example.com",
      name: "Shared Account CSR",
    });
    const login = api.users.create({
      tenantId: agency.id,
      role: "customer",
      email: "shared-account@example.com",
      name: "Shared Account",
    });
    const client = api.customers.create({
      tenantId: agency.id,
      userId: login.id,
      name: login.name,
      email: login.email,
      assignedAgentId: manager.id,
      additionalAgentIds: [agent.id],
      assignedCsrId: csr.id,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Account-linked follow-up",
      customerId: client.id,
      createdById: manager.id,
    });

    expect(task.assignedToId).toBe(manager.id);
    expect(new Set(task.additionalAssignedToIds)).toEqual(new Set([agent.id, csr.id]));
    expect(task.awaitingManagerAssignment).not.toBe(true);
  });

  it("repairs existing AI work so it follows the account owner instead of routing", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const wrongAgent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const login = api.users.create({
      tenantId: agency.id,
      role: "customer",
      email: "repair-owner@example.com",
      name: "Repair Owner",
    });
    const client = api.customers.create({
      tenantId: agency.id,
      userId: login.id,
      name: login.name,
      email: login.email,
      assignedAgentId: manager.id,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    db.insert("tasks", {
      id: "task_wrong_owner",
      tenantId: agency.id,
      title: "Existing AI follow-up",
      customerId: client.id,
      source: "ai_notification",
      status: "open",
      assignedToId: wrongAgent.id,
      awaitingManagerAssignment: true,
      createdAt: new Date().toISOString(),
    });

    expect(api.routing.reconcileAccountWorkOwnership(agency.id)).toBeGreaterThan(0);
    const repaired = api.tasks
      .listByTenant(agency.id)
      .find((task) => task.id === "task_wrong_owner");
    expect(repaired?.assignedToId).toBe(manager.id);
    expect(repaired?.awaitingManagerAssignment).toBe(false);
  });
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

describe("contact route requests", () => {
  it("lets an agent request a client reroute without creating a normal assigned activity", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const u = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "reroute-client@example.com",
      name: "Reroute Client",
    });
    const client = api.customers.create({
      tenantId: agency.id,
      userId: u.id,
      name: "Reroute Client",
      email: "reroute-client@example.com",
      assignedAgentId: agent.id,
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    const request = api.routing.requestContactRoute({
      tenantId: agency.id,
      kind: "client",
      targetId: client.id,
      mode: "reroute",
      actorId: agent.id,
      requestedAgentIds: [manager.id],
    });

    expect(request.awaitingManagerAssignment).toBe(true);
    expect(request.assignedToId).toBeUndefined();
    expect(request.routeRequestKind).toBe("client");
    expect(request.routeRequestMode).toBe("reroute");
    expect(request.routeRequestToAgentIds).toEqual([manager.id]);
    expect(api.routing.findOpenContactRouteRequest("client", client.id)?.id).toBe(request.id);

    const completed = api.routing.completeContactRouteRequest(
      request.id,
      [manager.id],
      manager.id
    );
    expect(completed?.completedAt).toBeTruthy();
    expect(api.customers.get(client.id)?.assignedAgentId).toBe(manager.id);
    expect(api.routing.findOpenContactRouteRequest("client", client.id)).toBeUndefined();
  });

  it("routes an unassigned prospect when a manager completes an agent request", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Requested Route Prospect",
      email: "requested-route@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });

    const request = api.routing.requestContactRoute({
      tenantId: agency.id,
      kind: "prospect",
      targetId: prospect.id,
      mode: "route",
      actorId: agent.id,
      requestedAgentIds: [agent.id],
    });
    api.routing.completeContactRouteRequest(request.id, [agent.id], manager.id);

    const updated = api.prospects.get(prospect.id)!;
    expect(updated.assignedAgentId).toBe(agent.id);
    expect(api.routing.findOpenContactRouteRequest("prospect", prospect.id)).toBeUndefined();
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some((t) => t.prospectId === prospect.id && t.assignedToId === agent.id)
    ).toBe(true);
  });
});
