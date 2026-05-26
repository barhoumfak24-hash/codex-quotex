// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Add-policy flow tests (api-level — mirrors what AddPolicyModal does
// when the agent clicks Add policy).
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

describe("api.policies.create + renewals.create end-to-end", () => {
  it("creating a policy with a renewal date also stamps a renewal row", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const carrier = api.carriers.listForTenant(agency.id)[0]!;
    const renewalIso = new Date("2027-03-01").toISOString();

    const policy = api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      carrierId: carrier.id,
      policyNumber: "TEST-001",
      status: "bound",
      renewalStatus: "upcoming",
      renewalDate: renewalIso,
      effectiveDate: new Date("2026-03-01").toISOString(),
    });
    api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: renewalIso,
      status: "upcoming",
    });

    expect(api.policies.get(policy.id)?.policyNumber).toBe("TEST-001");
    const renewals = api.renewals.listByPolicy(policy.id);
    expect(renewals).toHaveLength(1);
    expect(renewals[0].status).toBe("upcoming");
    expect(renewals[0].renewalDate).toBe(renewalIso);
  });

  it("adding a policy with status 'submitted_to_agent' increments the Policies sidebar count by 1", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const carrier = api.carriers.listForTenant(agency.id)[0]!;

    function pendingCount() {
      return api.policies.listByTenant(agency.id).filter((p) =>
        [
          "submitted_to_agent",
          "under_agent_review",
          "submitted_to_carrier",
          "carrier_reviewing",
          "documents_needed",
        ].includes(p.status)
      ).length;
    }
    const before = pendingCount();
    api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      carrierId: carrier.id,
      status: "submitted_to_agent",
      renewalStatus: "not_due",
    });
    expect(pendingCount()).toBe(before + 1);
  });

  it("a bound policy with a future renewal date adds to the Renewals upcoming pipeline", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const carrier = api.carriers.listForTenant(agency.id)[0]!;
    const before = api.renewals
      .listByTenant(agency.id)
      .filter((r) => r.status === "upcoming").length;
    const policy = api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      carrierId: carrier.id,
      status: "bound",
      renewalStatus: "upcoming",
      renewalDate: new Date("2027-09-15").toISOString(),
    });
    api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: policy.renewalDate!,
      status: "upcoming",
    });
    const after = api.renewals
      .listByTenant(agency.id)
      .filter((r) => r.status === "upcoming").length;
    expect(after).toBe(before + 1);
  });
});