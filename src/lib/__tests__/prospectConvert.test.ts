// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Conversion gating: a prospect cannot become a client until a
// manager has assigned them to an agent (or themself). The new
// customer is auto-assigned to that same agent.
// =====================================================================

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

describe("prospects.convert — assigned-agent gate", () => {
  it("throws when the prospect has no assigned agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Unassigned P",
      email: "u@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(() => api.prospects.convert(prospect.id)).toThrow(/manager must assign/i);
  });

  it("setStatus refuses to mark an unassigned prospect as 'converted' (defense in depth)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Unassigned P2",
      email: "u2@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(() => api.prospects.setStatus(prospect.id, "converted")).toThrow(
      /manager must assign|cannot mark/i
    );
  });

  it("succeeds once a manager assigns an agent, and auto-assigns the new client to that agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Assigned P",
      email: "a@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const out = api.prospects.convert(prospect.id);
    expect(out.prospect.status).toBe("converted");
    expect(out.prospect.customerId).toBe(out.customer.id);
    expect(out.customer.assignedAgentId).toBe(agent.id);
    expect(out.user.role).toBe("customer");
    expect(out.reusedExisting).toBe(false);
  });

  it("a manager assigning themself satisfies the gate", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Manager-owned P",
      email: "m@example.com",
      assetType: "jewelry",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, manager.id);
    const out = api.prospects.convert(prospect.id);
    expect(out.customer.assignedAgentId).toBe(manager.id);
  });

  it("revertToProspect archives the client, clears customerId, and flips status to nurturing", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Revert P",
      email: "r@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const out = api.prospects.convert(prospect.id);
    const customerId = out.customer.id;
    const reverted = api.prospects.revertToProspect(prospect.id);
    expect(reverted.status).toBe("nurturing");
    expect(reverted.customerId).toBeUndefined();
    const client = api.customers.get(customerId);
    expect(client?.archived).toBe(true);
  });

  it("revertToProspect refuses when the client has live policies", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Live policy P",
      email: "lp@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const { customer } = api.prospects.convert(prospect.id);
    // Plant a live policy on the freshly-created customer.
    const { db } = await import("../db");
    db.insert("policies", {
      id: "pol_test",
      tenantId: agency.id,
      customerId: customer.id,
      assetId: "asset_x",
      carrierId: "carrier_x",
      policyNumber: "TEST",
      status: "bound",
      renewalStatus: "not_due",
      premiumEstimate: 1000,
      createdAt: new Date().toISOString(),
    });
    expect(() => api.prospects.revertToProspect(prospect.id)).toThrow(/active polic/i);
  });

  it("revertToProspect throws when the prospect was never converted", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Never-converted",
      email: "nc@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(() => api.prospects.revertToProspect(prospect.id)).toThrow(/never converted/i);
  });

  it("auto-converts the linked prospect when the first policy lands for the customer", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Auto-convert P",
      email: "ac@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const { customer } = api.prospects.convert(prospect.id);
    // Manually flip the prospect status back to nurturing without
    // unlinking the customer — simulates an agent who marked the
    // prospect as nurturing by mistake but already has a client
    // record on file.
    const { db } = await import("../db");
    db.update("prospects", prospect.id, { status: "nurturing" });
    const before = db.list("prospects").find((p) => p.id === prospect.id)!;
    expect(before.status).toBe("nurturing");
    // First policy → auto-convert.
    api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: "asset_x",
      carrierId: "carrier_x",
      status: "bound",
      renewalStatus: "not_due",
    });
    const after = db.list("prospects").find((p) => p.id === prospect.id)!;
    expect(after.status).toBe("converted");
    // Audit event so the timeline shows it was auto-converted.
    const evt = api.status
      .listFor({ prospectId: prospect.id })
      .find((e) => e.message.includes("auto-converted"));
    expect(evt).toBeTruthy();
  });

  it("does not auto-convert when a later policy is added (only fires on the first)", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Later policy P",
      email: "lpp@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const { customer } = api.prospects.convert(prospect.id);
    // First policy → triggers auto-convert (already converted, no-op).
    api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: "a1",
      carrierId: "c1",
      status: "bound",
      renewalStatus: "not_due",
    });
    // Knock status back to test that a SECOND policy add does NOT
    // re-trigger the auto-convert hook.
    db.update("prospects", prospect.id, { status: "nurturing" });
    api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: "a2",
      carrierId: "c2",
      status: "bound",
      renewalStatus: "not_due",
    });
    const after = db.list("prospects").find((p) => p.id === prospect.id)!;
    expect(after.status).toBe("nurturing");
  });

  it("convert rejects when called by an agent who isn't assigned to this prospect", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agents = api.users.list(agency.id).filter((u) => u.role === "agent");
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const owner = agents[0];
    const intruder = api.users.create({
      role: "agent",
      tenantId: agency.id,
      email: "intruder@example.com",
      name: "Intruder Agent",
    });
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Gated P",
      email: "g@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, owner.id);
    expect(() =>
      api.prospects.convert(prospect.id, { actorId: intruder.id })
    ).toThrow(/assigned agents/i);
    // Manager always allowed.
    expect(() =>
      api.prospects.convert(prospect.id, { actorId: manager.id })
    ).not.toThrow();
  });

  it("assigned co-agent (additionalAgentIds) can also convert", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const owner = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const co = api.users.create({
      role: "agent",
      tenantId: agency.id,
      email: "co@example.com",
      name: "Co Agent",
    });
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Co-assigned P",
      email: "co-p@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, owner.id);
    // Add the co-agent on the additionalAgentIds list directly.
    db.update("prospects", prospect.id, { additionalAgentIds: [co.id] });
    expect(() =>
      api.prospects.convert(prospect.id, { actorId: co.id })
    ).not.toThrow();
  });

  it("revertToProspect rejects intruders too", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const owner = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const intruder = api.users.create({
      role: "agent",
      tenantId: agency.id,
      email: "revert-intruder@example.com",
      name: "Revert Intruder",
    });
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Revert gate",
      email: "rg@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, owner.id);
    api.prospects.convert(prospect.id, { actorId: owner.id });
    expect(() =>
      api.prospects.revertToProspect(prospect.id, { actorId: intruder.id })
    ).toThrow(/assigned agents/i);
  });

  it("calling convert twice is idempotent — returns the existing customer the second time", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Double-click P",
      email: "d@example.com",
      assetType: "umbrella_liability",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    const first = api.prospects.convert(prospect.id);
    const second = api.prospects.convert(prospect.id);
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.reusedExisting).toBe(true);
  });
});