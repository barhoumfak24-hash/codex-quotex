// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { db } from "../db";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  db.reset();
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("api.carriers - agency link state", () => {
  it("keeps carrier links active after link, unlink, and re-link", () => {
    const tenantId = "agency_palmcoast";
    const activeBefore = new Set(api.carriers.listForTenant(tenantId).map((carrier) => carrier.id));
    const carrier = api.carriers.list().find((item) => !activeBefore.has(item.id));

    expect(carrier).toBeDefined();
    if (!carrier) return;

    expect(activeBefore.has(carrier.id)).toBe(false);

    api.carriers.linkToAgency(carrier.id, tenantId);
    expect(api.carriers.listForTenant(tenantId).some((item) => item.id === carrier.id)).toBe(true);

    const linkedRows = api.carriers
      .links()
      .filter((link) => link.tenantId === tenantId && link.carrierId === carrier.id);
    expect(linkedRows).toHaveLength(1);
    expect(linkedRows[0].active).toBe(true);

    api.carriers.unlinkFromAgency(carrier.id, tenantId);
    expect(api.carriers.listForTenant(tenantId).some((item) => item.id === carrier.id)).toBe(false);

    api.carriers.linkToAgency(carrier.id, tenantId);
    const relinkedRows = api.carriers
      .links()
      .filter((link) => link.tenantId === tenantId && link.carrierId === carrier.id);
    expect(relinkedRows).toHaveLength(1);
    expect(relinkedRows[0].active).toBe(true);
  });
});
