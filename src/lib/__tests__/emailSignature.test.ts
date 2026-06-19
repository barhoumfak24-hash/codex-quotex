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
    const { splitEmailSignatureBody } = await import("../emailSignature");
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
    const parsed = splitEmailSignatureBody(out.body);
    expect(parsed.message).toBe("Here's the quote.");
    expect(parsed.signature?.text).toBe("Jane Smith\nSenior Advisor");
  });

  it("uses the saved agency logo when the sender has no custom signature image", async () => {
    const { api } = await import("../api");
    const { splitEmailSignatureBody } = await import("../emailSignature");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.agencies.update(agency.id, { logoUrl: "data:image/png;base64,agencylogo" });
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
    const parsed = splitEmailSignatureBody(out.body);
    expect(parsed.signature?.text).toBe("Jane Smith\nSenior Advisor");
    expect(parsed.signature?.images?.[0]).toEqual({
      name: `${agency.name} logo`,
      dataUrl: "data:image/png;base64,agencylogo",
    });
  });

  it("stores embedded logos and e-signatures as renderable signature payloads", async () => {
    const { api } = await import("../api");
    const { splitEmailSignatureBody } = await import("../emailSignature");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.users.update(agent.id, {
      emailSignature: "Jane Smith",
      emailSignatureIncludesEsignature: true,
      electronicSignature: {
        name: "Jane Smith",
        fontFamily: "cursive",
        fontSize: 44,
      },
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
    const parsed = splitEmailSignatureBody(out.body);
    expect(parsed.message).toBe("Body");
    expect(parsed.signature?.text).toBe("Jane Smith");
    expect(parsed.signature?.images?.[0]).toEqual({
      name: "agency-logo.png",
      dataUrl: "data:image/png;base64,abc",
    });
    expect(parsed.signature?.electronicSignature?.name).toBe("Jane Smith");
    expect(parsed.signature?.electronicSignature?.fontSize).toBe(44);
  });

  it("leaves inbound / no-signature bodies untouched", async () => {
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
    const { splitEmailSignatureBody } = await import("../emailSignature");
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
    const parsed = splitEmailSignatureBody(cm.body);
    expect(parsed.message).toBe("Body of the quarterly note.");
    expect(parsed.signature?.text).toBe("Jane Smith");
  });

  it("custom email sends are signed", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.users.update(agent.id, { emailSignature: "Jane" });
    const cm = api.customMessages.create({
      tenantId: agency.id,
      createdById: agent.id,
      channel: "email",
      body: "Quick email.",
      audience: "all_clients",
    });
    expect(cm.body).toContain("Quick email.");
    expect(cm.body).toContain("Jane");
  });
});
