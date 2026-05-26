// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI "what documents is this client still missing?" suggester.
// Diffs the expected doc set per asset against what's actually
// uploaded; returns one row per asset that still has gaps.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("documents.suggestMissingForCustomer", () => {
  it("returns nothing when the customer has no assets", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "empty@example.com",
      name: "Empty Customer",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "Empty Customer",
      email: "empty@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    expect(api.documents.suggestMissingForCustomer(c.id)).toEqual([]);
  });

  it("flags wind_mitigation as missing for a coastal home that only has a dec page", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const homeAsset = api.assets
      .listByCustomer(customer.id)
      .find((a) => a.type === "coastal_home");
    if (!homeAsset) return;
    // Seed already has a dec page + appraisal + 4-point + POI for
    // the home — for this test we want a coastal home with ONLY a
    // dec page so wind_mitigation surfaces as missing. Drop the
    // other home-related docs first.
    api.documents
      .listByEntity({ assetId: homeAsset.id })
      .forEach((d) => {
        if (d.type !== "declarations_page") {
          // No public delete API — just flip status; the suggester
          // doesn't filter by status, only presence.
          // (db.remove would also work but isn't exposed via api.)
        }
      });
    // Add a fresh test customer + asset for a clean slate so we
    // don't fight the rich seed.
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "test@example.com",
      name: "Test Customer",
    });
    const tc = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "Test Customer",
      email: "test@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    const a = api.assets.create({
      tenantId: agency.id,
      customerId: tc.id,
      type: "coastal_home",
      label: "Test Home",
      estimatedValue: 1_000_000,
      details: {},
      status: "insured",
    });
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_agent_pc",
      fileName: "Dec.pdf",
      fileType: "application/pdf",
      type: "declarations_page",
      visibility: "customer_visible",
      customerId: tc.id,
      assetId: a.id,
    });
    const suggestions = api.documents.suggestMissingForCustomer(tc.id);
    expect(suggestions.length).toBe(1);
    const homeSuggestion = suggestions[0];
    expect(homeSuggestion.assetLabel).toBe("Test Home");
    const types = homeSuggestion.missing.map((m) => m.type);
    // Declarations page is present, so it shouldn't appear.
    expect(types).not.toContain("declarations_page");
    // Wind mitigation + inspection + COI are still missing.
    expect(types).toContain("wind_mitigation");
    expect(types).toContain("inspection_report");
    expect(types).toContain("proof_of_insurance");
  });

  it("returns empty (asset has no gaps) when every expected doc is uploaded", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "full@example.com",
      name: "Full Customer",
    });
    const tc = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "Full Customer",
      email: "full@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    const a = api.assets.create({
      tenantId: agency.id,
      customerId: tc.id,
      type: "luxury_vehicle",
      label: "Test Vehicle",
      estimatedValue: 100_000,
      details: {},
      status: "insured",
    });
    ["declarations_page", "insurance_id_card", "proof_of_insurance"].forEach((t) =>
      api.documents.create({
        tenantId: agency.id,
        uploadedById: "user_agent_pc",
        fileName: `${t}.pdf`,
        fileType: "application/pdf",
        type: t,
        visibility: "customer_visible",
        customerId: tc.id,
        assetId: a.id,
      })
    );
    expect(api.documents.suggestMissingForCustomer(tc.id)).toEqual([]);
  });
});