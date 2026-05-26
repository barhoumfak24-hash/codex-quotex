// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Per-tenant custom document types.
//
// Each agency can extend the Document type dropdown with its own
// templates without a code change. Built-in DocumentType slugs are
// reserved; duplicates within a tenant are rejected.
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

describe("api.customDocumentTypes", () => {
  it("create() returns a row with the slugified label", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = api.customDocumentTypes.create({
      tenantId: agency.id,
      label: "Surplus Disclosure",
    });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.slug).toBe("surplus_disclosure");
    expect(out.label).toBe("Surplus Disclosure");
    expect(out.active).toBe(true);
  });

  it("rejects duplicate slugs within the same tenant", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.customDocumentTypes.create({ tenantId: agency.id, label: "ESL Form" });
    const second = api.customDocumentTypes.create({ tenantId: agency.id, label: "ESL Form" });
    expect("error" in second && second.error).toBe("duplicate");
  });

  it("allows the same label across different tenants", async () => {
    const { api } = await import("../api");
    const [a, b] = api.agencies.list();
    api.customDocumentTypes.create({ tenantId: a.id, label: "Custom A" });
    const second = api.customDocumentTypes.create({ tenantId: b.id, label: "Custom A" });
    expect("error" in second).toBe(false);
  });

  it("rejects labels that collide with built-in DocumentType slugs", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = api.customDocumentTypes.create({
      tenantId: agency.id,
      label: "Wind mitigation",
    });
    expect("error" in out && out.error).toBe("reserved");
  });

  it("rejects empty / whitespace-only labels", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = api.customDocumentTypes.create({ tenantId: agency.id, label: "   " });
    expect("error" in out && out.error).toBe("invalid");
  });

  it("listActiveForTenant excludes rows with active=false", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const created = api.customDocumentTypes.create({
      tenantId: agency.id,
      label: "Internal memo",
    });
    if ("error" in created) return;
    api.customDocumentTypes.update(created.id, { active: false });
    expect(api.customDocumentTypes.listActiveForTenant(agency.id).some((c) => c.id === created.id)).toBe(false);
    expect(api.customDocumentTypes.listForTenant(agency.id).some((c) => c.id === created.id)).toBe(true);
  });

  it("remove() deletes the row entirely", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const created = api.customDocumentTypes.create({
      tenantId: agency.id,
      label: "Drone log",
    });
    if ("error" in created) return;
    api.customDocumentTypes.remove(created.id);
    expect(api.customDocumentTypes.listForTenant(agency.id).some((c) => c.id === created.id)).toBe(false);
  });

  it("documents.create accepts custom slugs in `type`", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const staff = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const created = api.customDocumentTypes.create({
      tenantId: agency.id,
      label: "Boat survey 2026",
    });
    if ("error" in created) return;
    const doc = api.documents.create({
      tenantId: agency.id,
      uploadedById: staff.id,
      customerId: customer.id,
      fileName: "survey.pdf",
      fileType: "application/pdf",
      type: created.slug,
      visibility: "customer_visible",
    });
    expect(doc.type).toBe("boat_survey_2026");
  });
});