// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI-drafted document request flow.
//
// When the customer submits a quote with missing documents, the
// platform stages email outreach as a "draft" status message
// that the agent or manager reviews before sending.
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

describe("marketing.draftDocRequest", () => {
  it("queues exactly one email draft with status='draft'", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const before = api.marketing.listMessages(agency.id).length;
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["Wind mitigation report", "Roof age (or replacement date)"],
    });
    expect(out).not.toBeNull();
    expect(out!.email.channel).toBe("email");
    expect(out!.email.deliveryStatus).toBe("draft");
    expect(api.marketing.listMessages(agency.id).length).toBe(before + 1);
  });

  it("returns null when the missing-docs list is empty (no draft, no status event)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const events0 = api.status.listFor({ customerId: customer.id }).length;
    const msgs0 = api.marketing.listMessages(agency.id).length;
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: [],
    });
    expect(out).toBeNull();
    expect(api.status.listFor({ customerId: customer.id }).length).toBe(events0);
    expect(api.marketing.listMessages(agency.id).length).toBe(msgs0);
  });

  it("fires an internal-visibility status event tagged to the customer", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["Wind mitigation report"],
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.source).toBe("ai");
    expect(event.visibility).toBe("internal");
    expect(event.message).toMatch(/Drafted a document request/);
    expect(event.message).toMatch(/Wind mitigation report/);
  });

  it("includes every doc in the email body bullet list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["Doc A", "Doc B", "Doc C"],
    });
    expect(out!.email.content).toContain("Doc A");
    expect(out!.email.content).toContain("Doc B");
    expect(out!.email.content).toContain("Doc C");
  });
});

describe("marketing.approveMessage + updateMessage + discardDraft", () => {
  it("approveMessage flips a draft to queued", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["X"],
    });
    api.marketing.approveMessage(out!.email.id);
    const after = api.marketing.listMessages(agency.id).find((m) => m.id === out!.email.id);
    expect(after?.deliveryStatus).toBe("queued");
  });

  it("approveMessage no-ops on non-draft rows (so double-clicks can't re-send)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["X"],
    });
    api.marketing.approveMessage(out!.email.id);
    const result = api.marketing.approveMessage(out!.email.id);
    expect(result).toBeNull();
  });

  it("updateMessage patches subject + content on a draft", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["X"],
    });
    api.marketing.updateMessage(out!.email.id, { subject: "Edited subject", content: "Edited body" });
    const after = api.marketing.listMessages(agency.id).find((m) => m.id === out!.email.id);
    expect(after?.subject).toBe("Edited subject");
    expect(after?.content).toBe("Edited body");
  });

  it("discardDraft removes the row entirely", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["X"],
    });
    api.marketing.discardDraft(out!.email.id);
    const after = api.marketing.listMessages(agency.id).find((m) => m.id === out!.email.id);
    expect(after).toBeUndefined();
  });
});
