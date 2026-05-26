// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Manual activity creation. The Create-new-activity composer (Activity
// Center + client/prospect profiles) calls api.tasks.create with the
// richer field set: contact link, assignee, severity. Verify those
// land on the Task and that the activity shows up in the open queue.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.create — manual activity", () => {
  it("creates a client-scoped activity with assignee + severity", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Call about wind-mitigation form",
      description: "Need the OIR-B1-1802 before binding.",
      customerId: customer.id,
      assignedToId: agent.id,
      severity: "warning",
      createdById: manager.id,
    });
    expect(task.customerId).toBe(customer.id);
    expect(task.assignedToId).toBe(agent.id);
    expect(task.severity).toBe("warning");
    expect(task.source).toBe("manual");
    // Shows up in the tenant's open queue.
    const open = api.tasks.listOpen(agency.id);
    expect(open.some((t) => t.id === task.id)).toBe(true);
  });

  it("creates a prospect-scoped activity (agent assigned)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Activity Prospect",
      email: "ap@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Follow up on quote interest",
      prospectId: prospect.id,
      assignedToId: agent.id,
      createdById: agent.id,
    });
    expect(task.prospectId).toBe(prospect.id);
    expect(task.customerId).toBeUndefined();
    expect(task.severity).toBe("info"); // default
  });

  it("rejects an agent creating an activity for a prospect not assigned to them", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Someone Else's Prospect",
      email: "se@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(() =>
      api.tasks.create({
        tenantId: agency.id,
        title: "Sneaky activity",
        prospectId: prospect.id,
        createdById: agent.id,
      })
    ).toThrow(/assigned to them/i);
  });

  it("rejects an agent creating an activity for a client not in their book", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    // Find a customer NOT assigned to this agent (force-unassign one).
    const customer = api.customers.list(agency.id)[0];
    db.update("customers", customer.id, {
      assignedAgentId: undefined,
      additionalAgentIds: [],
    });
    expect(() =>
      api.tasks.create({
        tenantId: agency.id,
        title: "Not my client",
        customerId: customer.id,
        createdById: agent.id,
      })
    ).toThrow(/assigned to them/i);
  });

  it("a manager can create an activity for any client or prospect", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    expect(() =>
      api.tasks.create({
        tenantId: agency.id,
        title: "Manager activity",
        customerId: customer.id,
        createdById: manager.id,
      })
    ).not.toThrow();
    expect(
      api.tasks.canCreateActivityFor(
        { id: manager.id, role: "manager" },
        { customerId: customer.id }
      )
    ).toBe(true);
  });

  it("defaults severity to info and source to manual", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "General to-do",
    });
    expect(task.severity).toBe("info");
    expect(task.source).toBe("manual");
    expect(task.status).toBe("open");
  });
});