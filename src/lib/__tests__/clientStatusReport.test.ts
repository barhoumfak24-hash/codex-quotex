// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Client status report — auto-emission contract.
//
// The agent / manager activity timeline must reflect renewal reminders,
// file uploads, email/SMS comms, and custom notes without callers
// having to remember to insert a StatusEvent. These tests lock that
// contract by verifying side effects of the underlying create methods.
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

describe("documents.create auto-emits a status event", () => {
  it("creates a customer-visible event when the document is customer-visible", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const before = api.status.listFor({ customerId: customer.id }).length;
    api.documents.create({
      tenantId: agency.id,
      uploadedById: staff.id,
      customerId: customer.id,
      fileName: "wind-mitigation.pdf",
      fileType: "application/pdf",
      type: "wind_mitigation",
      visibility: "customer_visible",
    });
    const after = api.status.listFor({ customerId: customer.id });
    expect(after.length).toBe(before + 1);
    const event = after[0];
    expect(event.message).toMatch(/Document shared.*wind-mitigation\.pdf/);
    expect(event.visibility).toBe("customer_visible");
    expect(event.source).toBe("agent");
  });

  it("creates an internal event for employee_only docs (still in the activity report, hidden from customer)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.documents.create({
      tenantId: agency.id,
      uploadedById: staff.id,
      customerId: customer.id,
      fileName: "internal-memo.pdf",
      fileType: "application/pdf",
      type: "other",
      visibility: "employee_only",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.visibility).toBe("internal");
  });

  it("uses source=customer when the uploader is a customer-role user", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const customerUser = api.users.list(agency.id).find((u) => u.role === "customer")!;
    api.documents.create({
      tenantId: agency.id,
      uploadedById: customerUser.id,
      customerId: customer.id,
      fileName: "appraisal.pdf",
      fileType: "application/pdf",
      type: "appraisal",
      visibility: "customer_visible",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.source).toBe("customer");
    expect(event.message).toMatch(/Document uploaded/);
  });
});

describe("communications.create auto-emits a status event", () => {
  it("outbound email to the customer surfaces as a customer-visible agent event", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Quote update",
      body: "We've heard back from the carrier.",
      createdById: staff.id,
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.message).toMatch(/Email sent: Quote update/);
    expect(event.visibility).toBe("customer_visible");
    expect(event.source).toBe("agent");
  });

  it("inbound email from the customer surfaces as a customer-source event", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Can we add my new car?",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.source).toBe("customer");
    expect(event.message).toMatch(/Inbound email remark/);
  });

  it("internal channel=note stays internal so customers don't see staff scratch", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "note",
      direction: "outbound",
      body: "Reminder to follow up about the wind mitigation report.",
      createdById: staff.id,
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.visibility).toBe("internal");
  });
});

describe("notes.create — manual time-stamped agent notes", () => {
  it("creates an internal status event with the author's name in the message", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.notes.create({
      tenantId: agency.id,
      customerId: customer.id,
      authorId: staff.id,
      body: "Called client about hurricane prep checklist. Will follow up Friday.",
      visibility: "internal",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.visibility).toBe("internal");
    expect(event.source).toBe("agent");
    expect(event.message).toMatch(/Note by/);
    expect(event.message).toMatch(/hurricane prep checklist/);
  });

  it("preserves the full body verbatim (no truncation — the timeline IS the permanent record)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const longBody = "Detailed call log: " + "x".repeat(500);
    api.notes.create({
      tenantId: agency.id,
      customerId: customer.id,
      authorId: staff.id,
      body: longBody,
      visibility: "internal",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.message).toContain(longBody);
    expect(event.createdAt).toBeTruthy();
  });
});

describe("immutability — internal notes and status events cannot be edited or deleted", () => {
  it("api.notes exposes no update or remove method", async () => {
    const { api } = await import("../api");
    // The keys present on api.notes are the only public surface — if
    // a future change adds `update` or `remove` this assertion fires
    // and we re-evaluate the immutability story explicitly.
    const keys = Object.keys(api.notes).sort();
    expect(keys).toEqual(["create", "listByCustomer", "listByProspect"]);
  });

  it("api.status exposes no update or remove method", async () => {
    const { api } = await import("../api");
    const keys = Object.keys(api.status).sort();
    expect(keys).toEqual(["create", "listByTenant", "listFor"]);
  });

  it("creating a note produces a status event with a fixed creation timestamp", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.notes.create({
      tenantId: agency.id,
      customerId: customer.id,
      authorId: staff.id,
      body: "Audit anchor.",
      visibility: "internal",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    const beforeTs = event.createdAt;
    // Even if we try to re-fetch later, the timestamp must be stable.
    const again = api.status.listFor({ customerId: customer.id })[0];
    expect(again.createdAt).toBe(beforeTs);
    expect(again.id).toBe(event.id);
    expect(again.message).toBe(event.message);
  });
});

describe("claims.submitInquiry — customer contacts agency about a claim", () => {
  it("creates one Communication and one claim-tagged status event with the asset attached", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const beforeComms = api.communications.listByCustomer(customer.id).length;
    const beforeEvents = api.status.listFor({ customerId: customer.id }).length;

    api.claims.submitInquiry({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      body: "Tree fell on the garage during last night's storm. Need to start a claim.",
    });

    // Exactly one comm row + one status event — not two of either.
    expect(api.communications.listByCustomer(customer.id).length).toBe(beforeComms + 1);
    const events = api.status.listFor({ customerId: customer.id });
    expect(events.length).toBe(beforeEvents + 1);
    const event = events[0];
    expect(event.source).toBe("customer");
    expect(event.visibility).toBe("customer_visible");
    expect(event.assetId).toBe(asset?.id);
    expect(event.message).toMatch(/Claim inquiry submitted for/);
    expect(event.message).toMatch(/Tree fell on the garage/);
  });

  it("handles 'not sure' asset selection (no assetId) without breaking", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.claims.submitInquiry({
      tenantId: agency.id,
      customerId: customer.id,
      body: "Something happened to one of my vehicles, will share details soon.",
    });
    const event = api.status.listFor({ customerId: customer.id })[0];
    expect(event.assetId).toBeUndefined();
    expect(event.message).toMatch(/unspecified asset/);
  });

  it("comm row uses email channel + inbound direction so it surfaces in the agent inbox", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    api.claims.submitInquiry({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      body: "Help.",
    });
    const comms = api.communications.listByCustomer(customer.id);
    const last = comms[0];
    expect(last.channel).toBe("email");
    expect(last.direction).toBe("inbound");
    expect(last.subject).toMatch(/Claim inquiry/);
    expect(last.body).toBe("Help.");
  });

  it("subject line names the asset so the agent sees what's affected at a glance", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    api.claims.submitInquiry({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "x",
    });
    const last = api.communications.listByCustomer(customer.id)[0];
    expect(last.subject).toContain(asset.label);
  });
});

describe("policies.requestEdit — customer asks to change something on a policy", () => {
  it("inserts inbound + outbound comms and customer + AI status events tagged with asset + policy", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const policy = api.policies.listByAsset(asset!.id)[0];
    if (!asset || !policy) return;
    const beforeComms = api.communications.listByCustomer(customer.id).length;
    const beforeEvents = api.status.listFor({ customerId: customer.id }).length;

    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
      body: "Bump coverage to $750k and add my spouse as additional named insured.",
    });

    // Two Communication rows (inbound + AI's outbound reply) and
    // two status events: the customer-visible crumb AND the
    // internal "AI auto-sent" notice.
    expect(api.communications.listByCustomer(customer.id).length).toBe(beforeComms + 2);
    const events = api.status.listFor({ customerId: customer.id });
    expect(events.length).toBe(beforeEvents + 2);
    const customerEvent = events.find((e) => e.source === "customer")!;
    expect(customerEvent.visibility).toBe("customer_visible");
    expect(customerEvent.assetId).toBe(asset.id);
    expect(customerEvent.policyId).toBe(policy.id);
    expect(customerEvent.message).toMatch(/Policy edit requested for/);
    expect(customerEvent.message).toMatch(/Bump coverage to \$750k/);
    const aiEvent = events.find((e) => e.source === "ai")!;
    expect(aiEvent.visibility).toBe("internal");
    expect(aiEvent.message).toMatch(/AI auto-sent/);
  });

  it("inbound comm row uses email channel + inbound direction so it surfaces in the agent inbox", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "x",
    });
    const inbound = api.communications
      .listByCustomer(customer.id)
      .find((c) => c.direction === "inbound" && c.subject?.startsWith("Policy edit request"))!;
    expect(inbound.channel).toBe("email");
    expect(inbound.subject).toContain(asset.label);
  });

  it("works without an asset reference (customer doesn't pick one) — message reads 'an asset'", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      body: "Generic question about my coverage.",
    });
    // requestEdit now emits two status events (customer-visible
    // crumb + internal AI draft notice). The customer-visible one
    // is what carries the "an asset" fallback wording.
    const events = api.status.listFor({ customerId: customer.id });
    const customerEvent = events.find((e) => e.source === "customer")!;
    expect(customerEvent.assetId).toBeUndefined();
    expect(customerEvent.policyId).toBeUndefined();
    expect(customerEvent.message).toMatch(/an asset/);
  });
});

describe("renewals.sendReminder", () => {
  it("inserts a Communication AND a renewal-specific status event with the policy + date", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const policy = api.policies.listByTenant(agency.id)[0];
    if (!policy) {
      // Skip cleanly if the seed has no policy in this tenant.
      return;
    }
    const renewal = api.renewals.listByPolicy(policy.id)[0];
    if (!renewal) return;
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const beforeComms = api.communications.listByCustomer(policy.customerId).length;
    const beforeEvents = api.status.listFor({ customerId: policy.customerId }).length;
    const out = api.renewals.sendReminder({ renewalId: renewal.id, channel: "email", sentById: staff.id });
    expect(out.reminderSent).toBe(true);
    expect(api.communications.listByCustomer(policy.customerId).length).toBe(beforeComms + 1);
    // One renewal-specific event added. The renewals path is the
    // single source of truth — it does NOT also fire the generic
    // comms timeline row, by design.
    const after = api.status.listFor({ customerId: policy.customerId });
    expect(after.length).toBe(beforeEvents + 1);
    expect(after[0].renewalId).toBe(renewal.id);
    expect(after[0].message).toMatch(/Renewal reminder email sent/);
  });

  it("returns reminderSent=false when the renewal can't be found", async () => {
    const { api } = await import("../api");
    const out = api.renewals.sendReminder({
      renewalId: "renewal_nonexistent",
      channel: "email",
      sentById: "user_anything",
    });
    expect(out.reminderSent).toBe(false);
    expect(out.reason).toBe("renewal_not_found");
  });
});
