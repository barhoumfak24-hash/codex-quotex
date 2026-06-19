// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// E-sign workflow. Tagging a document only records who must sign.
// Explicit sweeps / send actions handle customer emails and agent
// work items, and those dispatch helpers remain idempotent.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("esign.runAll", () => {
  it("setRequirements only tags the document and does not dispatch anything", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const someDoc = db
      .list("documents")
      .find((d) => d.tenantId === agency.id && d.customerId);
    if (!someDoc) return;
    const commsBefore = api.communications.listByTenant(agency.id).length;
    const tasksBefore = api.tasks.listByTenant(agency.id).length;

    const updated = api.esign.setRequirements(someDoc.id, {
      customerEsignRequired: true,
      agentEsignRequired: true,
      agentEsignAssignedToId: agent.id,
    })!;

    expect(updated.customerEsignRequired).toBe(true);
    expect(updated.agentEsignRequired).toBe(true);
    expect(updated.customerEsignSentAt).toBeUndefined();
    expect(updated.esignCommunicationId).toBeUndefined();
    expect(updated.agentEsignTaskId).toBeUndefined();
    expect(api.communications.listByTenant(agency.id).length).toBe(commsBefore);
    expect(api.tasks.listByTenant(agency.id).length).toBe(tasksBefore);
  });

  it("seeds a renewal packet for any upcoming renewal without one", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const upcoming = api.renewals
      .listByTenant(agency.id)
      .filter((r) => r.status === "upcoming");
    expect(upcoming.length).toBeGreaterThan(0);
    const { seeded } = api.esign.runAll(agency.id);
    expect(seeded.length).toBeGreaterThan(0);
    seeded.forEach((d) => {
      expect(d.customerEsignRequired).toBe(true);
      expect(db.list("documents").find((x) => x.id === d.id)).toBeTruthy();
    });
  });

  it("auto-sends an outbound email per customer with pending customer e-sign docs", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const before = api.communications.listByTenant(agency.id).length;
    const { customerSent } = api.esign.runAll(agency.id);
    const after = api.communications.listByTenant(agency.id).length;
    expect(customerSent.length).toBeGreaterThan(0);
    expect(after - before).toBe(customerSent.length);
  });

  it("creates an Activity Center task per agent-side e-sign requirement", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    // Flip on agent esign on one existing document.
    const someDoc = db
      .list("documents")
      .find((d) => d.tenantId === agency.id && d.customerId);
    if (!someDoc) return;
    api.esign.setRequirements(someDoc.id, {
      agentEsignRequired: true,
      agentEsignAssignedToId: agent.id,
    });
    const { agentTasks } = api.esign.runAll(agency.id);
    expect(agentTasks.length).toBeGreaterThan(0);
    const target = agentTasks.find((t) => t.document.id === someDoc.id);
    expect(target).toBeTruthy();
    expect(target!.task.assignedToId).toBe(agent.id);
    expect(target!.task.title).toContain("E-sign required");
  });

  it("is idempotent across both sides — repeated runs do not duplicate", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const someDoc = db
      .list("documents")
      .find((d) => d.tenantId === agency.id && d.customerId);
    if (someDoc) {
      api.esign.setRequirements(someDoc.id, {
        agentEsignRequired: true,
        agentEsignAssignedToId: agent.id,
      });
    }
    api.esign.runAll(agency.id);
    const commsAfterFirst = api.communications.listByTenant(agency.id).length;
    const tasksAfterFirst = api.tasks.listByTenant(agency.id).length;
    api.esign.runAll(agency.id);
    expect(api.communications.listByTenant(agency.id).length).toBe(commsAfterFirst);
    expect(api.tasks.listByTenant(agency.id).length).toBe(tasksAfterFirst);
  });

  it("listAwaitingCustomerSignature surfaces sent-but-not-signed docs", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.esign.runAll(agency.id);
    const awaiting = api.esign.listAwaitingCustomerSignature(agency.id);
    expect(awaiting.length).toBeGreaterThan(0);
    api.esign.markCustomerSigned(awaiting[0].id);
    expect(
      api.esign
        .listAwaitingCustomerSignature(agency.id)
        .find((d) => d.id === awaiting[0].id)
    ).toBeUndefined();
  });

  it("markCustomerSigned notifies the agent + writes a timeline event", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.esign.runAll(agency.id);
    const awaiting = api.esign.listAwaitingCustomerSignature(agency.id);
    expect(awaiting.length).toBeGreaterThan(0);
    const targetDoc = awaiting[0];
    const customer = api.customers.get(targetDoc.customerId!)!;
    const tasksBefore = api.tasks.listByTenant(agency.id).length;
    const eventsBefore = api.status
      .listFor({ customerId: customer.id })
      .filter((e) => e.message.includes("e-signed")).length;
    api.esign.markCustomerSigned(targetDoc.id);
    expect(api.tasks.listByTenant(agency.id).length - tasksBefore).toBe(
      customer.assignedAgentId ? 1 : 0
    );
    const eventsAfter = api.status
      .listFor({ customerId: customer.id })
      .filter((e) => e.message.includes("e-signed")).length;
    expect(eventsAfter - eventsBefore).toBe(1);
  });

  it("markAgentSigned resolves the linked Activity Center task", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const someDoc = db
      .list("documents")
      .find((d) => d.tenantId === agency.id && d.customerId);
    if (!someDoc) return;
    api.esign.setRequirements(someDoc.id, {
      agentEsignRequired: true,
      agentEsignAssignedToId: agent.id,
    });
    const { agentTasks } = api.esign.runAll(agency.id);
    const target = agentTasks.find((t) => t.document.id === someDoc.id)!;
    api.esign.markAgentSigned(someDoc.id, agent.id);
    const taskAfter = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === target.task.id)!;
    expect(taskAfter.status).toBe("resolved");
    expect(taskAfter.completedAt).toBeTruthy();
  });
});
