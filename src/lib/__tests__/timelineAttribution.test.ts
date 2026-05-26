// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Service actions land on the client timeline attributed to the staff
// member who facilitated them (createdById), so the timeline reads as
// a complete, agent-stamped service history.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("timeline attribution", () => {
  it("a document shared by an agent is attributed to that agent on the timeline", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const before = api.status.listFor({ customerId: customer.id }).length;
    api.documents.create({
      tenantId: agency.id,
      uploadedById: agent.id,
      fileName: "dec-page.pdf",
      fileType: "application/pdf",
      type: "declarations_page",
      visibility: "customer_visible",
      customerId: customer.id,
    });
    const events = api.status.listFor({ customerId: customer.id });
    expect(events.length).toBe(before + 1);
    const shared = events.find((e) => e.message.includes("dec-page.pdf"))!;
    expect(shared.createdById).toBe(agent.id);
  });

  it("an outbound message by an agent is attributed to that agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Hello",
      body: "Hi there",
      createdById: agent.id,
    });
    const events = api.status.listFor({ customerId: customer.id });
    const evt = events.find((e) => e.createdById === agent.id);
    expect(evt).toBeTruthy();
  });
});