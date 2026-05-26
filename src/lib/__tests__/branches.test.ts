// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Agency branches CRUD. The agency address is HQ; branches are extra
// locations scoped strictly to one agency.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("api.branches", () => {
  it("creates, lists, updates, and removes branches scoped to an agency", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    expect(api.branches.listByAgency(agency.id)).toHaveLength(0);
    const b = api.branches.create({
      agencyId: agency.id,
      name: "Downtown Office",
      city: "Miami",
      state: "FL",
    });
    expect(b.agencyId).toBe(agency.id);
    expect(api.branches.listByAgency(agency.id)).toHaveLength(1);
    api.branches.update(b.id, { phone: "(555) 111-2222" });
    expect(api.branches.listByAgency(agency.id)[0].phone).toBe("(555) 111-2222");
    api.branches.remove(b.id);
    expect(api.branches.listByAgency(agency.id)).toHaveLength(0);
  });

  it("does not leak branches across agencies", async () => {
    const { api } = await import("../api");
    const agencies = api.agencies.list();
    if (agencies.length < 2) return;
    const [a, b] = agencies;
    api.branches.create({ agencyId: a.id, name: "A Branch" });
    expect(api.branches.listByAgency(a.id)).toHaveLength(1);
    expect(api.branches.listByAgency(b.id)).toHaveLength(0);
  });
});