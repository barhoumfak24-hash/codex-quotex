// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Archive / unarchive contract for prospects + customers.
// Lockstep with the sidebar badge logic — archive hides a row from
// the default list AND drops it from any alert count it was producing.
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

describe("prospects archive", () => {
  it("archive() hides the prospect from the default list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const before = api.prospects.listByTenant(agency.id).length;
    const target = api.prospects.listByTenant(agency.id)[0];
    if (!target) return;
    api.prospects.archive(target.id);
    expect(api.prospects.listByTenant(agency.id).length).toBe(before - 1);
    // But it still exists when explicitly requesting archived rows.
    expect(api.prospects.listArchived(agency.id).some((p) => p.id === target.id)).toBe(true);
  });

  it("unarchive() restores the row to the default list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const target = api.prospects.listByTenant(agency.id)[0];
    if (!target) return;
    api.prospects.archive(target.id);
    api.prospects.unarchive(target.id);
    expect(api.prospects.listByTenant(agency.id).some((p) => p.id === target.id)).toBe(true);
    expect(api.prospects.listArchived(agency.id).some((p) => p.id === target.id)).toBe(false);
  });

  it("archiving a 'new' prospect drops it from the alert count", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const newProspect = api.prospects
      .listByTenant(agency.id)
      .find((p) => p.status === "new" || p.status === "abandoned");
    if (!newProspect) return;
    const alertBefore = api.prospects
      .listByTenant(agency.id)
      .filter((p) => p.status === "new" || p.status === "abandoned").length;
    api.prospects.archive(newProspect.id);
    const alertAfter = api.prospects
      .listByTenant(agency.id)
      .filter((p) => p.status === "new" || p.status === "abandoned").length;
    expect(alertAfter).toBe(alertBefore - 1);
  });

  it("listByTenant({ includeArchived: true }) returns archived too", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const target = api.prospects.listByTenant(agency.id)[0];
    if (!target) return;
    api.prospects.archive(target.id);
    const all = api.prospects.listByTenant(agency.id, { includeArchived: true });
    expect(all.some((p) => p.id === target.id)).toBe(true);
  });
});

describe("customers archive", () => {
  it("archive() hides the customer from the default list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const before = api.customers.list(agency.id).length;
    const target = api.customers.list(agency.id)[0];
    if (!target) return;
    api.customers.archive(target.id);
    expect(api.customers.list(agency.id).length).toBe(before - 1);
    expect(api.customers.listArchived(agency.id).some((c) => c.id === target.id)).toBe(true);
  });

  it("unarchive() restores the row", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const target = api.customers.list(agency.id)[0];
    if (!target) return;
    api.customers.archive(target.id);
    api.customers.unarchive(target.id);
    expect(api.customers.list(agency.id).some((c) => c.id === target.id)).toBe(true);
    expect(api.customers.listArchived(agency.id).some((c) => c.id === target.id)).toBe(false);
  });

  it("includeArchived: true returns archived rows", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const target = api.customers.list(agency.id)[0];
    if (!target) return;
    api.customers.archive(target.id);
    const all = api.customers.list(agency.id, { includeArchived: true });
    expect(all.some((c) => c.id === target.id)).toBe(true);
  });
});