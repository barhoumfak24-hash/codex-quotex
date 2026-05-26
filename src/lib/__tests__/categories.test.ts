// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Per-tenant category filtering + link/unlink API.
//
// The master portal lets us toggle which categories each agency
// offers. These tests lock the customer-facing contract:
//   - tenants with explicit links see ONLY their linked active rows
//   - unlinking an existing link removes it from listActiveForTenant
//   - re-linking flips the link active again instead of creating a dupe
//   - tenants with no link rows fall back to ALL active categories
//     (legacy behaviour, so brand-new agencies aren't blank)
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

describe("api.categories — per-tenant link/unlink", () => {
  it("seeds 30 categories", async () => {
    const { api } = await import("../api");
    expect(api.categories.list().length).toBe(30);
  });

  it("seed links both demo agencies to all 30 categories", async () => {
    const { api } = await import("../api");
    expect(api.categories.listActiveForTenant("agency_palmcoast").length).toBe(30);
    expect(api.categories.listActiveForTenant("agency_lakeshore").length).toBe(30);
  });

  it("falls back to ALL active categories for a tenant with zero links", async () => {
    const { api } = await import("../api");
    const out = api.categories.listActiveForTenant("agency_brand_new_no_links");
    expect(out.length).toBe(30);
  });

  it("unlinkFromAgency drops the category from listActiveForTenant", async () => {
    const { api } = await import("../api");
    api.categories.unlinkFromAgency("cat_yacht", "agency_palmcoast");
    const out = api.categories.listActiveForTenant("agency_palmcoast");
    expect(out.some((c) => c.id === "cat_yacht")).toBe(false);
    // Other tenants are unaffected.
    const lake = api.categories.listActiveForTenant("agency_lakeshore");
    expect(lake.some((c) => c.id === "cat_yacht")).toBe(true);
  });

  it("linkToAgency reactivates an unlinked category instead of creating a duplicate row", async () => {
    const { api } = await import("../api");
    api.categories.unlinkFromAgency("cat_yacht", "agency_palmcoast");
    const before = api.categories.links().filter((l) => l.categoryId === "cat_yacht" && l.tenantId === "agency_palmcoast");
    api.categories.linkToAgency("cat_yacht", "agency_palmcoast");
    const after = api.categories.links().filter((l) => l.categoryId === "cat_yacht" && l.tenantId === "agency_palmcoast");
    expect(before.length).toBe(1);
    expect(after.length).toBe(1);
    expect(after[0].active).toBe(true);
  });

  it("removing a category also drops every link row pointing at it", async () => {
    const { api } = await import("../api");
    api.categories.remove("cat_drone");
    const danglers = api.categories.links().filter((l) => l.categoryId === "cat_drone");
    expect(danglers).toEqual([]);
  });

  it("inactive categories never appear in listActiveForTenant even when linked", async () => {
    const { api } = await import("../api");
    api.categories.update("cat_jewelry", { active: false });
    const out = api.categories.listActiveForTenant("agency_palmcoast");
    expect(out.some((c) => c.id === "cat_jewelry")).toBe(false);
  });
});

describe("category schema questions — seed sanity", () => {
  it("every seeded category has a coherent questions schema (keys + labels + inputType)", async () => {
    const { SEED_CATEGORIES } = await import("../seed");
    for (const cat of SEED_CATEGORIES) {
      for (const q of cat.questions ?? []) {
        expect(q.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
        expect(q.label.length).toBeGreaterThan(0);
        expect([
          "text", "number", "currency", "boolean", "select", "date", "address", "textarea",
        ]).toContain(q.inputType);
        if (q.inputType === "select") {
          expect(q.options).toBeDefined();
          expect(q.options!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});