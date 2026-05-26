// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI change-verification gate. An activity that asks for a concrete
// on-account change (e.g. "add a vehicle") can't be marked resolved
// until the AI recognizes the change actually landed — a new asset,
// policy, document, or claim showing up after the activity opened.
// Activities with no verifiable change resolve as before.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function clearContactGates(taskId: string, agentId: string) {
  const { api } = await import("../api");
  api.tasks.markInProgress(taskId);
  api.tasks.sendQuestionnaire(taskId, agentId);
  api.tasks.sendEsignDocuments(taskId, agentId);
}

describe("aiClassifyActivityResolution", () => {
  it("classifies an add-a-vehicle request as an asset add", async () => {
    const { aiClassifyActivityResolution } = await import("../ai");
    const out = aiClassifyActivityResolution({
      topic: "coverage_change",
      title: "Client wants to add a vehicle to their policy",
    });
    expect(out.kind).toBe("asset_added");
  });

  it("returns 'none' for a generic callback with no verifiable change", async () => {
    const { aiClassifyActivityResolution } = await import("../ai");
    const out = aiClassifyActivityResolution({
      topic: "other",
      title: "Call client back about billing question",
    });
    expect(out.kind).toBe("none");
  });
});

describe("tasks.canResolve waits on the AI-verified change", () => {
  it("stays locked until a vehicle is actually added", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Add a vehicle to the policy",
      topic: "coverage_change",
      customerId: customer.id,
      assignedToId: agent.id,
    });
    await clearContactGates(task.id, agent.id);

    let fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    // Contact gates are clear, but the AI hasn't seen the new vehicle.
    expect(api.tasks.resolutionCheck(fresh).required).toBe(true);
    expect(api.tasks.resolutionCheck(fresh).detected).toBe(false);
    expect(api.tasks.canResolve(fresh).allowed).toBe(false);

    // Add the vehicle → the AI recognizes it and resolve unlocks.
    api.assets.create({
      tenantId: agency.id,
      customerId: customer.id,
      type: "luxury_vehicle",
      label: "2024 Range Rover",
      estimatedValue: 120000,
      details: {},
      status: "insured",
    });
    fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.resolutionCheck(fresh).detected).toBe(true);
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("a generic activity is not gated by the AI change check", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Call client back about a billing question",
      topic: "other",
      customerId: customer.id,
      assignedToId: agent.id,
    });
    await clearContactGates(task.id, agent.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(api.tasks.resolutionCheck(fresh).required).toBe(false);
    expect(api.tasks.canResolve(fresh).allowed).toBe(true);
  });

  it("surfaces the AI verification step in the resolve checklist", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Add a boat to the account",
      topic: "endorsement_request",
      customerId: customer.id,
    });
    const checklist = api.tasks.checklistFor(task);
    expect(checklist.some((s) => /AI confirms the asset was added/i.test(s.label))).toBe(true);
  });
});