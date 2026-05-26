// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Manager-only "company reminder" fans out one independent reminder
// row per selected recipient. Each recipient dismisses / snoozes
// their own copy without affecting anyone else's.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("reminders.createBatch", () => {
  it("creates one reminder per selected recipient", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const staff = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    expect(staff.length).toBeGreaterThan(1);
    const recipients = staff.slice(0, 2);
    const remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rows = api.reminders.createBatch({
      tenantId: agency.id,
      userIds: recipients.map((u) => u.id),
      title: "Quarterly carrier appetite review",
      remindAt,
      importance: "warning",
    });
    expect(rows).toHaveLength(recipients.length);
    for (const u of recipients) {
      const mine = api.reminders.listForUser(agency.id, u.id);
      expect(
        mine.some((r) => r.title === "Quarterly carrier appetite review")
      ).toBe(true);
    }
  });

  it("dismissing one recipient's copy does not affect the others", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const staff = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager")
      .slice(0, 2);
    const [a, b] = staff;
    api.reminders.createBatch({
      tenantId: agency.id,
      userIds: [a.id, b.id],
      title: "Standalone copy",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const aRows = api.reminders.listForUser(agency.id, a.id);
    api.reminders.dismiss(aRows[0].id);
    expect(api.reminders.listForUser(agency.id, a.id)).toHaveLength(0);
    expect(api.reminders.listForUser(agency.id, b.id).length).toBeGreaterThan(0);
  });

  it("an agent (not just a manager) can fan out a company reminder", async () => {
    // Company reminders are no longer manager-only. Anyone on staff
    // should be able to pick a subset of teammates and push the same
    // reminder to all of them.
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const peers = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager")
      .slice(0, 3);
    api.reminders.createBatch({
      tenantId: agency.id,
      userIds: peers.map((u) => u.id),
      title: "Agent-initiated reminder",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
      // The author (agent) isn't a special parameter — the recipient
      // list is the only thing that determines who gets the reminder.
    });
    for (const u of peers) {
      const mine = api.reminders.listForUser(agency.id, u.id);
      expect(
        mine.some((r) => r.title === "Agent-initiated reminder")
      ).toBe(true);
    }
    // Sanity: the agent themselves is on the list (creator can self-
    // subscribe) since `peers` includes every staff member.
    expect(peers.some((u) => u.id === agent.id)).toBe(true);
  });

  it("de-dupes the userIds array so the same recipient never gets two copies", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const u = api.users.list(agency.id).find((x) => x.role === "agent")!;
    const rows = api.reminders.createBatch({
      tenantId: agency.id,
      userIds: [u.id, u.id, u.id],
      title: "Dedup",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(rows).toHaveLength(1);
  });
});