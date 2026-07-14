// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Client visibility for the agent portal.
//
// The Clients category is an agency-wide directory: agents, CSRs,
// managers, and master_admin can see every active client in their
// tenant. Assignment still drives listOwned(), routing, notifications,
// and "My clients" surfaces.
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

describe("api.customers.listVisible - access control", () => {
  it("an agent sees every active client in their agency directory", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agents = api.users.list(agency.id).filter((u) => u.role === "agent");
    const [agentA, agentB] = agents;
    if (!agentA || !agentB) return;

    const customers = api.customers.list(agency.id);
    if (customers.length === 0) return;
    const [c1] = customers;
    api.customers.update(c1.id, { assignedAgentId: agentA.id });

    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "other@example.com",
      name: "Other Client",
    });
    const c2 = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "Other Client",
      email: "other@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
      assignedAgentId: agentB.id,
    });

    const aSees = api.customers.listVisible(agency.id, {
      id: agentA.id,
      role: "agent",
    });
    expect(aSees.some((c) => c.id === c1.id)).toBe(true);
    expect(aSees.some((c) => c.id === c2.id)).toBe(true);

    const aOwned = api.customers.listOwned(agency.id, {
      id: agentA.id,
      role: "agent",
    });
    expect(aOwned.some((c) => c.id === c1.id)).toBe(true);
    expect(aOwned.some((c) => c.id === c2.id)).toBe(false);

    const bOwned = api.customers.listOwned(agency.id, {
      id: agentB.id,
      role: "agent",
    });
    expect(bOwned.some((c) => c.id === c2.id)).toBe(true);
    expect(bOwned.some((c) => c.id === c1.id)).toBe(false);
  });

  it("a manager sees every active client in the tenant", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const all = api.customers.list(agency.id);
    const managerSees = api.customers.listVisible(agency.id, {
      id: manager.id,
      role: "manager",
    });
    expect(managerSees.length).toBe(all.length);
  });

  it("does not hide tenant clients when a live auth staff id is not in the local user table", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const all = api.customers.list(agency.id);
    if (all.length === 0) return;
    const liveAuthViewer = {
      id: "auth_user_created_outside_seed_data",
      role: "agent" as const,
    };

    const visible = api.customers.listVisible(agency.id, liveAuthViewer);

    expect(visible.length).toBe(all.length);
    expect(api.customers.canSee(all[0], liveAuthViewer)).toBe(true);
  });

  it("canSee lets an agent open another assigned client's profile inside their agency", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users.list(agency.id).filter((u) => u.role === "agent");
    if (!agentA || !agentB) return;
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "bclient@example.com",
      name: "B's Client",
    });
    const cB = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "B's Client",
      email: "bclient@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
      assignedAgentId: agentB.id,
    });
    expect(api.customers.canSee(cB, { id: agentA.id, role: "agent" })).toBe(true);
    expect(api.customers.canSee(cB, { id: agentB.id, role: "agent" })).toBe(true);
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    expect(api.customers.canSee(cB, { id: manager.id, role: "manager" })).toBe(true);
  });

  it("a CSR has agency-wide client visibility while still keeping the CSR label", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const csr = api.users.list(agency.id).find((u) => u.role === "csr")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;

    const primaryUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "csr-primary@example.com",
      name: "CSR Primary Client",
    });
    const primaryClient = api.customers.create({
      tenantId: agency.id,
      userId: primaryUser.id,
      name: "CSR Primary Client",
      email: "csr-primary@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
      assignedAgentId: csr.id,
    });

    const serviceUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "csr-service@example.com",
      name: "CSR Service Client",
    });
    const serviceClient = api.customers.create({
      tenantId: agency.id,
      userId: serviceUser.id,
      name: "CSR Service Client",
      email: "csr-service@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
      assignedAgentId: agent.id,
      assignedCsrId: csr.id,
    });

    const csrSees = api.customers.listVisible(agency.id, {
      id: csr.id,
      role: "csr",
    });
    expect(csrSees.some((c) => c.id === primaryClient.id)).toBe(true);
    expect(csrSees.some((c) => c.id === serviceClient.id)).toBe(true);
    expect(api.customers.canSee(primaryClient, { id: csr.id, role: "csr" })).toBe(true);
    expect(api.customers.canSee(serviceClient, { id: csr.id, role: "csr" })).toBe(true);
  });

  it("an unassigned client is still visible in the agency directory", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "orphan@example.com",
      name: "Orphan",
    });
    const orphan = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "Orphan",
      email: "orphan@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    expect(api.customers.canSee(orphan, { id: agent.id, role: "agent" })).toBe(true);
    expect(
      api.customers
        .listVisible(agency.id, { id: agent.id, role: "agent" })
        .some((c) => c.id === orphan.id)
    ).toBe(true);
    expect(
      api.customers
        .listOwned(agency.id, { id: agent.id, role: "agent" })
        .some((c) => c.id === orphan.id)
    ).toBe(false);
    expect(api.customers.canSee(orphan, { id: manager.id, role: "manager" })).toBe(true);
  });

  it("persists commercial client line and business name on the customer profile", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "commercial-client@example.com",
      name: "Avery Stone",
    });
    const customer = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      lineOfBusiness: "commercial",
      businessName: "Stone Coastal Holdings LLC",
      operationsDescription: "Marine construction management, coastal property maintenance, and consulting operations.",
      name: "Avery Stone",
      email: "commercial-client@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });

    expect(customer.lineOfBusiness).toBe("commercial");
    expect(customer.businessName).toBe("Stone Coastal Holdings LLC");
    expect(api.customers.get(customer.id)?.businessName).toBe("Stone Coastal Holdings LLC");
    expect(api.customers.get(customer.id)?.operationsDescription).toContain("Marine construction");
  });
});

describe("api.prospects.listVisible - access control", () => {
  it("an agent sees every active prospect in their agency directory", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agents = api.users.list(agency.id).filter((u) => u.role === "agent");
    const [agentA, agentB] = agents;
    if (!agentA || !agentB) return;

    const prospectForB = api.prospects.create({
      tenantId: agency.id,
      name: "Agent B Prospect",
      email: "prospect-b@example.com",
      assetType: "coastal_home",
      aiSummary: "Created to prove agency-wide prospect directory visibility.",
      lastAction: "Submitted quote intake",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "Review prospect details.",
      marketingStatus: "active",
      status: "new",
      assignedAgentId: agentB.id,
    });

    const aSees = api.prospects.listVisible(agency.id, {
      id: agentA.id,
      role: "agent",
    });
    expect(aSees.some((p) => p.id === prospectForB.id)).toBe(true);
    expect(api.prospects.canSee(prospectForB, { id: agentA.id, role: "agent" })).toBe(true);

    const aOwned = api.prospects.listOwned(agency.id, {
      id: agentA.id,
      role: "agent",
    });
    expect(aOwned.some((p) => p.id === prospectForB.id)).toBe(false);
  });

  it("a CSR can see unassigned and agent-assigned prospects in the agency directory", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const csr = api.users.list(agency.id).find((u) => u.role === "csr")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;

    const unassigned = api.prospects.create({
      tenantId: agency.id,
      name: "Unassigned Directory Prospect",
      email: "unassigned-prospect@example.com",
      assetType: "jewelry",
      aiSummary: "Visible even before routing.",
      lastAction: "Submitted website contact form",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "Route when ready.",
      marketingStatus: "active",
      status: "new",
      skipAutoRoute: true,
    });
    const assigned = api.prospects.create({
      tenantId: agency.id,
      name: "Agent Directory Prospect",
      email: "agent-prospect@example.com",
      assetType: "yacht",
      aiSummary: "Visible to the agency CSR even though the agent owns routing.",
      lastAction: "Requested a call",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "Review intake.",
      marketingStatus: "active",
      status: "contacted",
      assignedAgentId: agent.id,
    });

    const csrSees = api.prospects.listVisible(agency.id, {
      id: csr.id,
      role: "csr",
    });
    expect(csrSees.some((p) => p.id === unassigned.id)).toBe(true);
    expect(csrSees.some((p) => p.id === assigned.id)).toBe(true);
    expect(api.prospects.canSee(unassigned, { id: csr.id, role: "csr" })).toBe(true);
    expect(api.prospects.canSee(assigned, { id: csr.id, role: "csr" })).toBe(true);
  });

  it("does not hide tenant prospects when a live auth staff id is not in the local user table", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const all = api.prospects.listByTenant(agency.id);
    if (all.length === 0) return;
    const liveAuthViewer = {
      id: "auth_user_created_outside_seed_data",
      role: "agent" as const,
    };

    const visible = api.prospects.listVisible(agency.id, liveAuthViewer);

    expect(visible.length).toBe(all.length);
    expect(api.prospects.canSee(all[0], liveAuthViewer)).toBe(true);
  });
});
