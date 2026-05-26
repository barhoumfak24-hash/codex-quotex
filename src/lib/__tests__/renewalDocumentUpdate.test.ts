// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI renewal-document inspection + Update-for-Renewal flow.
//
// On renewal create the AI flags the policy's term-bound documents
// (declarations page, ID card, proof of insurance, …); the agent
// drafts updated versions, edits, and publishes — the original stays
// on file. The renewal activity's resolve gate locks until all
// flagged docs have a published successor.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function seedPolicyWithTermBoundDoc() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const customer = api.customers.list(agency.id)[0];
  const asset = api.assets.listByCustomer(customer.id)[0]!;
  const carrier = api.carriers.listForTenant(agency.id)[0]!;
  const u = api.users.list(agency.id)[0];
  const policy = api.policies.create({
    tenantId: agency.id,
    customerId: customer.id,
    assetId: asset.id,
    carrierId: carrier.id,
    status: "bound",
    renewalStatus: "not_due",
  });
  const doc = api.documents.create({
    tenantId: agency.id,
    uploadedById: u.id,
    fileName: "CHB-HM-558920-Declarations-2025.pdf",
    fileType: "application/pdf",
    type: "declarations_page",
    visibility: "customer_visible",
    status: "approved",
    customerId: customer.id,
    assetId: asset.id,
    policyId: policy.id,
  });
  return { api, agency, customer, policy, doc, u };
}

describe("documents.flagForRenewal", () => {
  it("flags term-bound docs on the policy when a renewal is created", async () => {
    const { api, agency, policy, doc } = await seedPolicyWithTermBoundDoc();
    api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: new Date("2026-03-20").toISOString(),
      status: "upcoming",
    });
    const fresh = api.documents.get(doc.id)!;
    expect(fresh.needsRenewalUpdate).toBe(true);
    expect(fresh.renewalForRenewalId).toBeTruthy();
  });
});

describe("draft + publish renewal update", () => {
  it("drafts a pending version, then publish marks it approved + clears the original flag", async () => {
    const { api, agency, policy, doc, u } = await seedPolicyWithTermBoundDoc();
    const renewal = api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: new Date("2027-03-20").toISOString(),
      status: "upcoming",
    });
    const draft = api.documents.draftRenewalUpdate(doc.id, renewal.id, u.id)!;
    expect(draft).toBeTruthy();
    expect(draft.status).toBe("pending");
    expect(draft.supersedesId).toBe(doc.id);
    expect(draft.policyTermYear).toBe(2027);
    expect(draft.fileName).toMatch(/2027/);

    // Drafting again is idempotent.
    const draft2 = api.documents.draftRenewalUpdate(doc.id, renewal.id, u.id)!;
    expect(draft2.id).toBe(draft.id);

    // Publish.
    const published = api.documents.publishRenewalUpdate(draft.id, u.id, {
      fileName: "CHB-HM-558920-Declarations-2027.pdf",
    })!;
    expect(published.status).toBe("approved");
    expect(published.publishedAt).toBeTruthy();
    // Original is no longer flagged.
    expect(api.documents.get(doc.id)!.needsRenewalUpdate).toBeFalsy();
    // The original is NOT deleted — historical term stays on file.
    expect(api.documents.get(doc.id)).toBeTruthy();
  });

  it("the renewal activity's resolve gate locks until the doc is republished", async () => {
    const { api, agency, customer, policy, doc, u } = await seedPolicyWithTermBoundDoc();
    const renewal = api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: new Date("2027-03-20").toISOString(),
      status: "upcoming",
    });
    const task = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.renewalId === renewal.id)!;
    const checklist = api.tasks.checklistFor(task);
    expect(
      checklist.some((s) => /Renewal documents updated/.test(s.label) && !s.done)
    ).toBe(true);

    // Publishing the draft clears the step.
    const draft = api.documents.draftRenewalUpdate(doc.id, renewal.id, u.id)!;
    api.documents.publishRenewalUpdate(draft.id, u.id);
    const after = api.tasks.checklistFor(task);
    expect(
      after.some((s) => /Renewal documents updated/.test(s.label) && !s.done)
    ).toBeFalsy();

    // sanity: customer + policy still in scope
    expect(customer.id).toBe(policy.customerId);
  });
});