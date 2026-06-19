// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("carrierDownloads", () => {
  it("approves a matched carrier download into the policy, eDoc library, and audit timeline", async () => {
    const { api } = await import("../api");
    const download = api.carrierDownloads.get("download_chubb_renewal_premium")!;
    const reviewer = api.users.list(download.tenantId)[0]!;

    const result = api.carrierDownloads.approve(download.id, reviewer.id)!;

    expect(result.status).toBe("approved");
    expect(result.appliedById).toBe(reviewer.id);
    expect(result.appliedAt).toBeTruthy();

    const policy = api.policies.get("policy_home")!;
    expect(policy.finalPremium).toBe(18_840);
    expect(policy.billingReference).toBe("Renewal direct bill schedule 2027");

    const documents = api.documents.listByEntity({ policyId: "policy_home" });
    expect(documents.some((doc) => doc.fileName === "CHB-HM-558920-renewal-dec-2027.pdf")).toBe(true);

    const events = api.status.listFor({ policyId: "policy_home" });
    expect(events.some((event) => event.message.includes("renewal update filed"))).toBe(true);
    expect(events.some((event) => /runner/i.test(event.message))).toBe(false);

    const notes = api.notes.listByCustomer("customer_demo");
    expect(notes.some((note) => note.body.includes("renewal update filed"))).toBe(true);
    expect(notes.some((note) => /runner/i.test(note.body))).toBe(false);
  });

  it("rejects an unmatched carrier download without importing the eDoc", async () => {
    const { api } = await import("../api");
    const download = api.carrierDownloads.get("download_chubb_edoc_unmatched")!;
    const reviewer = api.users.list(download.tenantId)[0]!;

    const result = api.carrierDownloads.reject(download.id, reviewer.id, "Policy match not confirmed")!;

    expect(result.status).toBe("rejected");
    expect(result.rejectionReason).toBe("Policy match not confirmed");
    expect(
      api
        .documents
        .listByTenant(download.tenantId)
        .some((doc) => doc.fileName === "Chubb-Endorsement-Unknown-Insured.pdf")
    ).toBe(false);
  });
});
