// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Carrier claim link → agent notification + AI-drafted email.
//
// When the customer clicks a CarrierClaimLink, two side effects must
// fire so the agent / manager have full context the next time they
// open the file: an internal status event, and a draft email
// addressed to the customer with policy + asset + agent context.
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

describe("claims.draftClaimFollowUp", () => {
  it("emits an internal status event tagged with customer + policy + asset", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const policy = asset ? api.policies.listByAsset(asset.id)[0] : undefined;
    if (!asset || !policy) return;

    const before = api.status.listFor({ customerId: customer.id }).length;
    api.claims.draftClaimFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      carrierId: "carrier_chubb",
      carrierName: "Chubb Masterpiece",
      claimsUrl: "https://www.chubb.com/us-en/claims.html",
      policyId: policy.id,
      assetId: asset.id,
    });
    const after = api.status.listFor({ customerId: customer.id });
    expect(after.length).toBe(before + 1);
    const event = after[0];
    expect(event.source).toBe("ai");
    expect(event.visibility).toBe("internal");
    expect(event.policyId).toBe(policy.id);
    expect(event.assetId).toBe(asset.id);
    expect(event.message).toContain("Chubb Masterpiece");
    expect(event.message).toContain(asset.label);
    expect(event.message).toMatch(/AI staged a follow-up email/);
  });

  it("drafts an email addressed to the customer with policy + asset + agent in the body", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const policy = asset ? api.policies.listByAsset(asset.id)[0] : undefined;
    if (!asset || !policy) return;

    const beforeDrafts = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "draft").length;

    api.claims.draftClaimFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      carrierName: "Chubb Masterpiece",
      claimsUrl: "https://www.chubb.com/us-en/claims.html",
      policyId: policy.id,
      assetId: asset.id,
    });

    const drafts = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "draft" && m.customerId === customer.id);
    expect(drafts.length).toBe(beforeDrafts + 1);
    const draft = drafts[drafts.length - 1];
    expect(draft.channel).toBe("email");
    expect(draft.subject).toContain("Chubb Masterpiece");
    // Body must include the asset label, policy reference, and
    // some form of "reply to your agent" wording.
    expect(draft.content).toContain(asset.label);
    expect(draft.content).toContain(
      policy.policyNumber ? `Policy #${policy.policyNumber}` : "Policy #"
    );
    expect(draft.content).toMatch(/Reply to this email|call your agent|call .* anytime/i);
  });

  it("returns null when the customer can't be resolved (defensive)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = api.claims.draftClaimFollowUp({
      tenantId: agency.id,
      customerId: "customer_nonexistent",
      carrierName: "X",
      claimsUrl: "https://example.com",
    });
    expect(out).toBeNull();
  });

  it("falls back to a generic agent line when the customer has no assignedAgentId", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    // Clear the assigned agent first to force the fallback branch.
    api.customers.update(customer.id, { assignedAgentId: undefined });
    const out = api.claims.draftClaimFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      carrierName: "Chubb",
      claimsUrl: "https://chubb.com/claims",
    });
    expect(out).not.toBeNull();
    const drafts = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "draft" && m.customerId === customer.id);
    const newest = drafts[drafts.length - 1];
    expect(newest.content).toMatch(/your agent at/i);
  });

  it("draft is filed under the existing AI drafts queue so it counts toward the marketing badge", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const before = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "draft").length;
    api.claims.draftClaimFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      carrierName: "PURE",
      claimsUrl: "https://pure.com/claims",
    });
    const after = api.marketing
      .listMessages(agency.id)
      .filter((m) => m.deliveryStatus === "draft").length;
    expect(after).toBe(before + 1);
  });
});