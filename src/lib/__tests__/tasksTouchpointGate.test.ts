// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Resolve-gate behavior for customer activities. Resolving requires
// the agent to (1) mark in progress, (2) send the questionnaire, and
// (3) send the missing-documents request. The missing-docs step is
// auto-satisfied when nothing is outstanding. AI-authored messages do
// not satisfy any of these — only the explicit Send actions.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.canResolve requires the send actions", () => {
  it("blocks resolve before the questionnaire + missing-docs are sent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    const gate = api.tasks.canResolve(
      api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!
    );
    expect(gate.allowed).toBe(false);
    expect(gate.missingSteps).toBeGreaterThan(0);
  });

  it("an AI-authored message does NOT satisfy the questionnaire gate", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "sms",
      direction: "outbound",
      body: "Thanks! An agent will be in touch.",
      createdById: "ai",
    });
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.canResolve(fresh).allowed).toBe(false);
  });

  it("clears once both Send questionnaire and Send missing documents fire", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    api.tasks.sendQuestionnaire(task.id, agent.id);
    let fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    // Questionnaire alone is not enough when docs are outstanding…
    if (!api.tasks.hasSentEsignDocs(fresh)) {
      expect(api.tasks.canResolve(fresh).allowed).toBe(false);
    }
    api.tasks.sendEsignDocuments(task.id, agent.id);
    fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("send actions record audit + create a human outbound communication", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    const before = api.communications.listByCustomer(customer.id).length;
    api.tasks.sendQuestionnaire(task.id, agent.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.hasSentQuestionnaire(fresh)).toBe(true);
    const after = api.communications.listByCustomer(customer.id);
    expect(after.length).toBe(before + 1);
    expect(after[0].createdById).toBe(agent.id);
  });

  it("a no-customer activity only needs in-progress (no contact to message)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const task = api.tasks.create({ tenantId: agency.id, title: "Internal to-do" });
    api.tasks.markInProgress(task.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("e-sign docs gate: send marks them sent; signing auto-files the copy", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    // A document that needs the customer's e-signature.
    const doc = api.documents.create({
      tenantId: agency.id,
      uploadedById: agent.id,
      fileName: "renewal-packet.pdf",
      fileType: "application/pdf",
      type: "endorsement_document",
      visibility: "customer_visible",
      status: "pending",
      customerId: customer.id,
    });
    db.update("documents", doc.id, { customerEsignRequired: true });

    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Renewal",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    // Gate is open while a doc still needs sending.
    expect(api.tasks.hasSentEsignDocs(task)).toBe(false);
    // Send → marks the doc sent and clears the gate.
    api.tasks.sendEsignDocuments(task.id, agent.id);
    expect(api.tasks.hasSentEsignDocs(task)).toBe(true);
    expect(api.documents.get(doc.id)!.customerEsignSentAt).toBeTruthy();
    // Customer signs → executed copy auto-files (approved + signed).
    api.esign.markCustomerSigned(doc.id);
    const filed = api.documents.get(doc.id)!;
    expect(filed.customerEsignSignedAt).toBeTruthy();
    expect(filed.status).toBe("approved");
    expect(filed.visibility).toBe("customer_visible");
  });
});