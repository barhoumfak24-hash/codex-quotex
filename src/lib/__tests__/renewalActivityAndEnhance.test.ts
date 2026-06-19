// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
//  - Renewals auto-spawn an Activity Center card for the owning agent.
//  - "Send to manager" activities flag awaitingManagerAssignment; a
//    manager assign() clears it.
//  - aiEnhanceMessage polishes a draft (email vs SMS).
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function seedPolicyForFirstClient() {
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
  return { api, agency, customer, policy };
}

describe("renewals auto-spawn an activity", () => {
  it("creates one activity for the owning agent when a renewal is created", async () => {
    const { api, agency, customer, policy } = await seedPolicyForFirstClient();
    const renewal = api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "upcoming",
    });
    const task = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.renewalId === renewal.id);
    expect(task).toBeTruthy();
    expect(task!.topic).toBe("renewal_approaching");
    expect(task!.assignedToId).toBe(customer.assignedAgentId);
    expect(task!.policyId).toBe(policy.id);
  });

  it("ensureActivities is idempotent — no duplicate cards per renewal", async () => {
    const { api, agency, policy } = await seedPolicyForFirstClient();
    api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "upcoming",
    });
    // First sweep settles any seeded renewals too; a second sweep must
    // be a no-op (no duplicates).
    api.renewals.ensureActivities(agency.id);
    const settled = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.topic === "renewal_approaching").length;
    api.renewals.ensureActivities(agency.id);
    const afterSecond = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.topic === "renewal_approaching").length;
    expect(afterSecond).toBe(settled);
  });
});

describe("send-to-manager activities", () => {
  it("flags awaitingManagerAssignment; assign() clears it", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Need a manager to route this",
      assignedToId: manager.id,
      awaitingManagerAssignment: true,
      createdById: agent.id,
    });
    expect(task.awaitingManagerAssignment).toBe(true);
    api.tasks.assign(task.id, agent.id, manager.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(fresh.awaitingManagerAssignment).toBe(false);
    expect(fresh.assignedToId).toBe(agent.id);
  });
});

describe("aiEnhanceMessage", () => {
  it("adds a greeting + sign-off for email", async () => {
    const { aiEnhanceMessage } = await import("../ai");
    const out = await aiEnhanceMessage({
      body: "hey wanted to follow up on your renewal. let me know",
      channel: "email",
      contactName: "Jordan Reeves",
    });
    expect(out).toMatch(/^Hi Jordan,/);
    expect(out).toMatch(/Warm regards,/);
    // Sentence casing applied to the body.
    expect(out).toMatch(/Hey wanted to follow up on your renewal\./);
  });

  it("polishes a short email with a greeting and sign-off", async () => {
    const { aiEnhanceMessage } = await import("../ai");
    const out = await aiEnhanceMessage({
      body: "your docs are ready to sign",
      channel: "email",
      contactName: "Sam",
    });
    expect(out).toMatch(/^Hi Sam,/);
    expect(out).toMatch(/Warm regards,/);
  });

  it("returns empty for an empty draft", async () => {
    const { aiEnhanceMessage } = await import("../ai");
    expect(await aiEnhanceMessage({ body: "   ", channel: "email" })).toBe("");
  });
});
