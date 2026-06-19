// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Client visibility for the agent portal.
//
// Agents may only see clients their manager has assigned to them.
// Managers (and master_admin) see every active client in the tenant.
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

describe("api.customers.listVisible — access control", () => {
  it("an agent sees only clients explicitly assigned to them", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agents = api.users.list(agency.id).filter((u) => u.role === "agent");
    const [agentA, agentB] = agents;
    if (!agentA || !agentB) return; // demo tenants ship two agents
    // Seed: assign existing customers between two agents.
    const customers = api.customers.list(agency.id);
    if (customers.length === 0) return;
    const [c1] = customers;
    api.customers.update(c1.id, { assignedAgentId: agentA.id });
    // Add a fresh customer assigned to agentB so we can prove agentA
    // cannot see it.
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
    expect(aSees.some((c) => c.id === c2.id)).toBe(false);

    const bSees = api.customers.listVisible(agency.id, {
      id: agentB.id,
      role: "agent",
    });
    expect(bSees.some((c) => c.id === c2.id)).toBe(true);
    expect(bSees.some((c) => c.id === c1.id)).toBe(false);
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

  it("canSee blocks an agent from a client outside their book", async () => {
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
    expect(api.customers.canSee(cB, { id: agentA.id, role: "agent" })).toBe(false);
    expect(api.customers.canSee(cB, { id: agentB.id, role: "agent" })).toBe(true);
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    expect(api.customers.canSee(cB, { id: manager.id, role: "manager" })).toBe(true);
  });

  it("a CSR has agent-level visibility while still keeping the CSR label", async () => {
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

  it("an unassigned client is invisible to every agent (but a manager still sees them)", async () => {
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
    expect(api.customers.canSee(orphan, { id: agent.id, role: "agent" })).toBe(false);
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
