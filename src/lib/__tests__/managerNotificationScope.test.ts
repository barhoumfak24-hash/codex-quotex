// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

function clearClientAlerts(api: typeof import("../api").api, tenantId: string, actorId: string) {
  api.claims
    .listByTenant(tenantId)
    .forEach((claim) => api.claims.update(claim.id, { status: "closed" }));
  api.communications
    .listPendingForTenant(tenantId)
    .forEach((communication) => api.communications.markResolved(communication.id, actorId));
  api.customers
    .list(tenantId)
    .forEach((customer) => api.customers.update(customer.id, { assignedAgentId: actorId, assignedCsrId: undefined }));
}

function createClient(
  api: typeof import("../api").api,
  input: {
    tenantId: string;
    assignedAgentId: string;
    name: string;
    email: string;
  }
) {
  const user = api.users.create({
    role: "customer",
    tenantId: input.tenantId,
    email: input.email,
    name: input.name,
  });
  return api.customers.create({
    tenantId: input.tenantId,
    userId: user.id,
    name: input.name,
    email: input.email,
    marketingOptInEmail: false,
    marketingOptInSms: false,
    assignedAgentId: input.assignedAgentId,
  });
}

describe("manager notification scope", () => {
  it("api.customers.listOwned only returns clients assigned to that manager", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;

    const managerClient = createClient(api, {
      tenantId: agency.id,
      assignedAgentId: manager.id,
      name: "Manager Owned Client",
      email: "manager-owned@example.com",
    });
    const agentClient = createClient(api, {
      tenantId: agency.id,
      assignedAgentId: agent.id,
      name: "Agent Owned Client",
      email: "agent-owned@example.com",
    });

    const owned = api.customers.listOwned(agency.id, {
      id: manager.id,
      role: "manager",
    });
    expect(owned.some((customer) => customer.id === managerClient.id)).toBe(true);
    expect(owned.some((customer) => customer.id === agentClient.id)).toBe(false);
  });

  it("sidebar client alerts for a manager ignore another agent's clients", async () => {
    const { api } = await import("../api");
    const { computeEmployeeBadges } = await import("../../components/layout/EmployeeLayout");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    clearClientAlerts(api, agency.id, agent.id);

    const managerClient = createClient(api, {
      tenantId: agency.id,
      assignedAgentId: manager.id,
      name: "Manager Alert Client",
      email: "manager-alert@example.com",
    });
    const agentClient = createClient(api, {
      tenantId: agency.id,
      assignedAgentId: agent.id,
      name: "Agent Alert Client",
      email: "agent-alert@example.com",
    });

    api.claims.create({
      tenantId: agency.id,
      customerId: managerClient.id,
      policyId: "policy_manager_alert",
      carrierId: "carrier_chubb",
      status: "in_review",
    });
    api.communications.create({
      tenantId: agency.id,
      customerId: managerClient.id,
      channel: "email",
      direction: "inbound",
      body: "Manager-owned pending message.",
    });
    api.claims.create({
      tenantId: agency.id,
      customerId: agentClient.id,
      policyId: "policy_agent_alert",
      carrierId: "carrier_chubb",
      status: "in_review",
    });
    api.communications.create({
      tenantId: agency.id,
      customerId: agentClient.id,
      channel: "email",
      direction: "inbound",
      body: "Agent-owned pending message.",
    });

    expect(
      computeEmployeeBadges(agency.id, { id: manager.id, role: "manager" }).clients
    ).toBe(2);
  });
});
