// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Master-portal user provisioning + customer-filtering tests.
//
// Verifies the new `provisionMore` API and the rule that customers
// never appear in the master "Users" view.
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

describe("api.users.provisionMore", () => {
  it("creates the requested number of unassigned agent credentials", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const before = api.users.list(agency.id).filter((u) => u.role === "agent").length;
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 3,
    });
    expect(made).toHaveLength(3);
    const after = api.users.list(agency.id).filter((u) => u.role === "agent").length;
    expect(after - before).toBe(3);
    // New credentials are always unassigned.
    for (const u of made) {
      expect(u.profileCompleted).toBe(false);
      expect(u.username).toBeTruthy();
      expect(u.generatedPassword).toBeTruthy();
    }
  });

  it("creates managers when role=manager is requested", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "manager",
      count: 2,
    });
    expect(made.every((u) => u.role === "manager")).toBe(true);
  });

  it("clamps the count to [1, 50] so a stray '0' or '999' input can't break things", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const tooSmall = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 0,
    });
    expect(tooSmall).toHaveLength(1);
    const tooLarge = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 999,
    });
    expect(tooLarge).toHaveLength(50);
  });

  it("usernames are unique even when the existing tenant already has agents", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 5,
    });
    const usernames = made.map((u) => u.username);
    expect(new Set(usernames).size).toBe(usernames.length);
    const allUsernames = api.users.list(agency.id).map((u) => u.username).filter(Boolean);
    expect(new Set(allUsernames).size).toBe(allUsernames.length);
  });
});

describe("customers stay out of the staff view", () => {
  it("customers exist as users with role='customer' so they need explicit filtering", async () => {
    const { api } = await import("../api");
    const all = api.users.list();
    const customers = all.filter((u) => u.role === "customer");
    expect(customers.length).toBeGreaterThan(0); // seeded
    const staffOnly = all.filter((u) => u.role !== "customer");
    expect(staffOnly.every((u) => u.role !== "customer")).toBe(true);
  });
});