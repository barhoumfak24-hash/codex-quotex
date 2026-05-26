// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI severity classifier — runs when a customer prompts an activity
// (policy edit request, cancellation, claim, etc.) and assigns a
// TaskSeverity automatically so the Activity Center importance icon
// recolors yellow → amber → red without an agent grading by hand.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function seedCustomerWithPolicy() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const customer = api.customers.list(agency.id)[0];
  const asset = api.assets.listByCustomer(customer.id)[0];
  const policy = api.policies.listByCustomer(customer.id)[0];
  return { api, agency, customer, asset, policy };
}

describe("AI severity classifier on customer-prompted activities", () => {
  it("grades a cancellation request urgent + writes an AI rationale", async () => {
    const { api, agency, customer, asset, policy } = await seedCustomerWithPolicy();
    const { notificationId } = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
      body: "I'd like to cancel my policy effective Friday.",
    });
    expect(notificationId).toBeTruthy();
    const notif = api.aiNotifications
      .listUnacked(agency.id)
      .find((n) => n.id === notificationId);
    expect(notif?.severity).toBe("urgent");
    expect(notif?.severityReason).toBeTruthy();
  });

  it("promotes a routine edit request to urgent when the body contains time-sensitive language", async () => {
    const { api, agency, customer, asset, policy } = await seedCustomerWithPolicy();
    const { notificationId } = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
      body: "I was in an accident this morning and need to update the policy ASAP.",
    });
    const notif = api.aiNotifications
      .listUnacked(agency.id)
      .find((n) => n.id === notificationId);
    expect(notif?.severity).toBe("urgent");
    expect(notif?.severityReason?.toLowerCase()).toContain("time-sensitive");
  });

  it("leaves an ordinary deductible change at warning (carrier-side, no urgency cue)", async () => {
    const { api, agency, customer, asset, policy } = await seedCustomerWithPolicy();
    const { notificationId } = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
      body: "When you get a chance, I'd like to lower my deductible.",
    });
    const notif = api.aiNotifications
      .listUnacked(agency.id)
      .find((n) => n.id === notificationId);
    expect(notif?.severity).toBe("warning");
  });

  it("severityReason carries over to the spawned Task on acknowledge", async () => {
    const { api, agency, customer, asset, policy } = await seedCustomerWithPolicy();
    const { notificationId } = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
      body: "Need to cancel ASAP.",
    });
    const out = api.aiNotifications.acknowledge(notificationId!);
    expect(out?.task.severity).toBe("urgent");
    expect(out?.task.severityReason).toBeTruthy();
  });
});