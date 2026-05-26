// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Personal email signature: auto-applied inside the API on every
// outbound email a staff member sends (communications + custom
// messages). SMS / inbound / no-signature pass through unchanged.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("auto-appended email signature on api.communications.create", () => {
  it("appends the sender's signature to an outbound email body", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.users.update(agent.id, { emailSignature: "Jane Smith\nSenior Advisor" });
    const out = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Quote update",
      body: "Here's the quote.",
      createdById: agent.id,
    });
    expect(out.body).toContain("Here's the quote.");
    expect(out.body).toContain("—");
    expect(out.body).toContain("Jane Smith");
    expect(out.body).toContain("Senior Advisor");
  });

  it("includes image markers for any embedded logos", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.users.update(agent.id, {
      emailSignature: "Jane Smith",
      emailSignatureImages: [
        { name: "agency-logo.png", dataUrl: "data:image/png;base64,abc" },
      ],
    });
    const out = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      body: "Body",
      createdById: agent.id,
    });
    expect(out.body).toContain("[Image: agency-logo.png]");
  });

  it("leaves SMS / inbound / no-signature bodies untouched", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];

    // No signature on file → body identical.
    const nosig = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      body: "Plain body.",
      createdById: agent.id,
    });
    expect(nosig.body).toBe("Plain body.");

    // SMS with signature set → ignored.
    api.users.update(agent.id, { emailSignature: "Jane" });
    const sms = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "sms",
      direction: "outbound",
      body: "Quick note.",
      createdById: agent.id,
    });
    expect(sms.body).toBe("Quick note.");

    // Inbound (customer reply) → never gets the staff signature.
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Customer reply.",
    });
    expect(inbound.body).toBe("Customer reply.");
  });
});

describe("custom message sends pick up the signature", () => {
  it("appends the sender's signature to a custom-email body on create", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.users.update(agent.id, { emailSignature: "Jane Smith" });
    const cm = api.customMessages.create({
      tenantId: agency.id,
      createdById: agent.id,
      channel: "email",
      subject: "Quarterly note",
      body: "Body of the quarterly note.",
      audience: "all_clients",
    });
    expect(cm.body).toContain("Body of the quarterly note.");
    expect(cm.body).toContain("Jane Smith");
  });

  it("custom SMS sends are not touched", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.users.update(agent.id, { emailSignature: "Jane" });
    const cm = api.customMessages.create({
      tenantId: agency.id,
      createdById: agent.id,
      channel: "sms",
      body: "Quick text.",
      audience: "all_clients",
    });
    expect(cm.body).toBe("Quick text.");
  });
});