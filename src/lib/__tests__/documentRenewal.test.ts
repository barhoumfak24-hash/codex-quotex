// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Policy document renewal — regenerate a policy's core docs from
// current information.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("documents.renewForPolicy", () => {
  it("regenerates a dated declarations / ID card / proof set tied to the policy", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const carrier = api.carriers.listForTenant(agency.id)[0]!;
    const policy = api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      carrierId: carrier.id,
      status: "bound",
      renewalStatus: "not_due",
    });
    const u = api.users.list(agency.id)[0];

    const out = api.documents.renewForPolicy(policy.id, u.id);
    expect(out.length).toBe(3);
    const onPolicy = api.documents.listByEntity({ policyId: policy.id });
    const types = onPolicy.map((d) => d.type);
    expect(types).toContain("declarations_page");
    expect(types).toContain("insurance_id_card");
    expect(types).toContain("proof_of_insurance");
    out.forEach((d) => {
      expect(d.customerId).toBe(customer.id);
      expect(d.status).toBe("approved");
      expect(d.visibility).toBe("customer_visible");
    });
    // A customer-visible timeline event documents the renewal.
    const events = api.status.listFor({ policyId: policy.id });
    expect(events.some((e) => /renewed/i.test(e.message))).toBe(true);
  });
});