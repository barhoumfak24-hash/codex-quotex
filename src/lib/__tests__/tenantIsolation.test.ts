// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const AUTH_STORAGE_KEY = "quotex.auth.userId.v1";

beforeEach(async () => {
  window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("browser tenant isolation guard", () => {
  it("locks a signed-in agency user to their own agency rows", async () => {
    const { api } = await import("../api");
    const agencies = api.agencies.list();
    const palmCoast = agencies.find((agency) => agency.id === "agency_palmcoast")!;
    const lakeshore = agencies.find((agency) => agency.id === "agency_lakeshore")!;
    const agent = api.users.list(palmCoast.id).find((user) => user.role === "agent")!;

    window.localStorage.setItem(AUTH_STORAGE_KEY, agent.id);

    expect(api.agencies.list().map((agency) => agency.id)).toEqual([palmCoast.id]);
    expect(api.agencies.get(palmCoast.id)?.id).toBe(palmCoast.id);
    expect(api.agencies.get(lakeshore.id)).toBeUndefined();
    expect(api.customers.list(lakeshore.id)).toEqual([]);
    expect(api.customers.list(palmCoast.id).every((customer) => customer.tenantId === palmCoast.id)).toBe(true);
  });

  it("does not lock the master admin tenant browser", async () => {
    const { api } = await import("../api");
    const master = api.users.list().find((user) => user.role === "master_admin")!;

    window.localStorage.setItem(AUTH_STORAGE_KEY, master.id);

    expect(api.agencies.list().map((agency) => agency.id)).toEqual(
      expect.arrayContaining(["agency_palmcoast", "agency_lakeshore"])
    );
  });
});
