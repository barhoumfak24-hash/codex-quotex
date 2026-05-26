// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Converted prospects graduate: they disappear from the default
// prospects listing (only the "Converted" filter opts back in) and
// the timeline that was written against the prospect is back-filled
// onto the customer record so the client profile shows one
// continuous history from first-touch onward.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("converted prospects graduate to the client category", () => {
  it("excludes converted prospects from listByTenant by default + includes them when opted in", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Graduating P",
      email: "grad@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    expect(
      api.prospects.listByTenant(agency.id).some((p) => p.id === prospect.id)
    ).toBe(true);
    api.prospects.convert(prospect.id);
    // Default listing drops them.
    expect(
      api.prospects.listByTenant(agency.id).some((p) => p.id === prospect.id)
    ).toBe(false);
    // Opt-in listing surfaces them again.
    expect(
      api.prospects
        .listByTenant(agency.id, { includeConverted: true })
        .some((p) => p.id === prospect.id)
    ).toBe(true);
  });

  it("transfers the prospect's prior timeline onto the customer + stamps the conversion", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Continuity P",
      email: "cont@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    api.prospects.assignAgent(prospect.id, agent.id);
    api.status.create({
      tenantId: agency.id,
      source: "agent",
      message: "Called prospect about VIN.",
      visibility: "internal",
      prospectId: prospect.id,
    });
    api.status.create({
      tenantId: agency.id,
      source: "ai",
      message: "Drafted intro email.",
      visibility: "internal",
      prospectId: prospect.id,
    });
    const { customer } = api.prospects.convert(prospect.id, { actorId: agent.id });
    const customerTimeline = api.status.listFor({ customerId: customer.id });
    // Both historical prospect events are now visible under the customer.
    expect(
      customerTimeline.some((e) => e.message === "Called prospect about VIN.")
    ).toBe(true);
    expect(
      customerTimeline.some((e) => e.message === "Drafted intro email.")
    ).toBe(true);
    // And the conversion itself was stamped.
    expect(
      customerTimeline.some((e) => /converted from prospect to client/i.test(e.message))
    ).toBe(true);
  });
});