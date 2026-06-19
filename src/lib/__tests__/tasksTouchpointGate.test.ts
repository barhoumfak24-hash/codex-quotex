// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Resolve-gate behavior for customer activities. Starting an activity
// now triggers autopilot: AI sends the questionnaire, and any pending
// customer e-signature packets go out automatically. Arbitrary AI
// outbound messages do not satisfy the gate; the task audit actions do.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.canResolve automation gates", () => {
  it("autopilot sends the questionnaire when a customer activity starts", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.tasks.markInProgress(task.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.hasSentQuestionnaire(fresh)).toBe(true);
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("an arbitrary AI-authored message does NOT satisfy the questionnaire gate", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      body: "Thanks! An agent will be in touch.",
      createdById: "ai",
    });
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.hasSentQuestionnaire(fresh)).toBe(false);
    expect(api.tasks.canResolve(fresh).allowed).toBe(false);
  });

  it("manual send actions remain idempotent and clear the gate", async () => {
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
    expect(api.tasks.hasSentQuestionnaire(fresh)).toBe(true);
    api.tasks.sendEsignDocuments(task.id, agent.id);
    fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("autopilot records audit + creates outbound communications", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
      customerId: customer.id,
    });
    const before = api.communications.listByCustomer(customer.id).length;
    api.tasks.markInProgress(task.id, agent.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.hasSentQuestionnaire(fresh)).toBe(true);
    const after = api.communications.listByCustomer(customer.id);
    expect(after.length).toBeGreaterThanOrEqual(before + 2);
    expect(after.some((c) => c.createdById === agent.id && c.channel === "email")).toBe(true);
    expect(api.tasks.history(task.id).some((h) => h.action === "task.questionnaire_sent")).toBe(true);
  });

  it("a no-customer activity only needs in-progress (no contact to message)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const task = api.tasks.create({ tenantId: agency.id, title: "Internal to-do" });
    api.tasks.markInProgress(task.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("e-sign docs autopilot sends requests; signing auto-files the copy", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
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
    api.tasks.markInProgress(task.id, agent.id);
    expect(api.tasks.hasSentEsignDocs(task)).toBe(true);
    expect(api.documents.get(doc.id)!.customerEsignSentAt).toBeTruthy();
    expect(api.tasks.history(task.id).some((h) => h.action === "task.esign_docs_sent")).toBe(true);

    api.esign.markCustomerSigned(doc.id);
    const filed = api.documents.get(doc.id)!;
    expect(filed.customerEsignSignedAt).toBeTruthy();
    expect(filed.status).toBe("approved");
    expect(filed.visibility).toBe("customer_visible");
  });
});
