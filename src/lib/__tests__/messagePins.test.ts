// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Per-user pinned message threads. Cap of 5 pins per user across
// all kinds (internal + client + prospect). Pins are scoped to the
// signed-in user so pinning a thread for yourself doesn't pin it
// for anyone else.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("messagePins namespace", () => {
  it("pin + isPinned + unpin round-trip works for an internal thread", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.messagePins.pin({
      tenantId: agency.id,
      userId: agent.id,
      kind: "internal",
      refId: "thread_x",
    });
    expect(
      api.messagePins.isPinned(agency.id, agent.id, "internal", "thread_x")
    ).toBeTruthy();
    api.messagePins.unpin(agency.id, agent.id, "internal", "thread_x");
    expect(
      api.messagePins.isPinned(agency.id, agent.id, "internal", "thread_x")
    ).toBeFalsy();
  });

  it("caps at 5 pins per user across all kinds", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    for (let i = 0; i < 5; i++) {
      api.messagePins.pin({
        tenantId: agency.id,
        userId: agent.id,
        kind: "internal",
        refId: `thread_${i}`,
      });
    }
    expect(api.messagePins.countForUser(agency.id, agent.id)).toBe(5);
    expect(() =>
      api.messagePins.pin({
        tenantId: agency.id,
        userId: agent.id,
        kind: "client",
        refId: "cust_y",
      })
    ).toThrow(/5 pinned/i);
  });

  it("pins are scoped to the user — other staff are unaffected", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.messagePins.pin({
      tenantId: agency.id,
      userId: agent.id,
      kind: "client",
      refId: "cust_a",
    });
    expect(
      api.messagePins.isPinned(agency.id, agent.id, "client", "cust_a")
    ).toBeTruthy();
    expect(
      api.messagePins.isPinned(agency.id, manager.id, "client", "cust_a")
    ).toBeFalsy();
    expect(api.messagePins.countForUser(agency.id, manager.id)).toBe(0);
  });

  it("repeated pin calls are idempotent — no duplicate rows + no error", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.messagePins.pin({
      tenantId: agency.id,
      userId: agent.id,
      kind: "internal",
      refId: "thread_x",
    });
    api.messagePins.pin({
      tenantId: agency.id,
      userId: agent.id,
      kind: "internal",
      refId: "thread_x",
    });
    expect(api.messagePins.countForUser(agency.id, agent.id)).toBe(1);
  });
});