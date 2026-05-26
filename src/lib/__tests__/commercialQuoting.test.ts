// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Commercial quoting flow. AI infers line of business from the
// contact name, generates a structured questionnaire mixing base
// intake + per-carrier supplemental sections, and ships it to the
// client through a portal link instead of an inline email body.
// Submitting answers auto-fires the carrier ranking + an agent task.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("aiInferLineOfBusiness", () => {
  it("flags LLC / Inc / Corp suffixes as commercial", async () => {
    const { aiInferLineOfBusiness } = await import("../ai");
    expect(
      aiInferLineOfBusiness({
        contactName: "Acme Holdings LLC",
        assetType: "other",
      })
    ).toBe("commercial");
    expect(
      aiInferLineOfBusiness({
        contactName: "Bayside Ventures, Inc.",
        assetType: "other",
      })
    ).toBe("commercial");
  });

  it("treats individual names as personal", async () => {
    const { aiInferLineOfBusiness } = await import("../ai");
    expect(
      aiInferLineOfBusiness({
        contactName: "Jane Smith",
        assetType: "coastal_home",
        estimatedValue: 1_500_000,
      })
    ).toBe("personal");
  });
});

describe("commercial quoting session", () => {
  it("startSession with a commercial contact generates the structured questionnaire", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
    });
    expect(session.lineOfBusiness).toBe("commercial");
    expect((session.questionnaireQuestions ?? []).length).toBeGreaterThan(0);
    // Sections include base intake + at least one carrier-specific row.
    const sections = new Set(
      (session.questionnaireQuestions ?? []).map((q) => q.section)
    );
    expect(sections.size).toBeGreaterThan(1);
  });

  it("sendPortalLink writes an outbound email with the portal URL", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Acme LLC",
      estimatedValue: 1_500_000,
    });
    const updated = api.quoting.sendPortalLink(
      session.id,
      "https://app.example/customer/questionnaire/abc"
    );
    expect(updated?.status).toBe("awaiting_reply");
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === updated?.questionnaireMessageId);
    expect(comm?.body).toContain("https://app.example/customer/questionnaire/abc");
    expect(comm?.subject).toMatch(/questionnaire/i);
  });

  it("personal-lines sessions also get a structured portal questionnaire", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: "Jane Doe",
      estimatedValue: 1_500_000,
    });
    expect(session.lineOfBusiness).toBe("personal");
    expect((session.questionnaireQuestions ?? []).length).toBeGreaterThan(0);
    // Every personal question carries the asset-type section header.
    (session.questionnaireQuestions ?? []).forEach((q) => {
      expect(q.section).toContain(session.assetType.replace(/_/g, " "));
    });
  });

  it("sendPortalLink works for personal sessions too", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: "John Smith",
      estimatedValue: 250_000,
    });
    const updated = api.quoting.sendPortalLink(
      session.id,
      "https://app.example/customer/questionnaire/abc"
    );
    expect(updated?.status).toBe("awaiting_reply");
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === updated?.questionnaireMessageId);
    expect(comm?.body).toContain("https://app.example/customer/questionnaire/abc");
  });

  it("submitQuestionnaireResponses runs quotes and creates an agent task", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Acme LLC",
      estimatedValue: 1_500_000,
    });
    api.quoting.sendPortalLink(session.id, "https://example/link");
    const tasksBefore = api.tasks.listByTenant(agency.id).length;
    const submitted = api.quoting.submitQuestionnaireResponses(session.id, {
      "base-legal-business-name-as-registered": "Acme Logistics LLC",
      "base-federal-ein": "12-3456789",
    });
    expect(submitted?.status).toBe("complete");
    expect(submitted?.replyReceivedAt).toBeTruthy();
    expect(submitted?.questionnaireResponses?.["base-federal-ein"]).toBe("12-3456789");
    const tasksAfter = api.tasks.listByTenant(agency.id).length;
    expect(tasksAfter - tasksBefore).toBe(1);
    const newTask = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.title.includes("submitted quoting questionnaire"));
    expect(newTask?.assignedToId).toBe(agent.id);
  });
});