// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Recurrence on company reminders: dismissing a recurring reminder
// auto-schedules the next occurrence on the same user. The chain is
// bounded by `endsAt` (if set) and `recurrenceSourceId` points back
// at the originator so the audit trail stays intact.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("reminders.dismiss with recurrence", () => {
  it("spawns the next weekly occurrence when a recurring reminder is dismissed", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const u = api.users.list(agency.id).find((x) => x.role === "agent")!;
    const first = api.reminders.create({
      tenantId: agency.id,
      userId: u.id,
      title: "Weekly carrier review",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: { pattern: "weekly" },
    });
    api.reminders.dismiss(first.id);
    const active = api.reminders.listForUser(agency.id, u.id);
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe("Weekly carrier review");
    expect(active[0].recurrenceSourceId).toBe(first.id);
    // ~7 days ahead of the original.
    const delta =
      new Date(active[0].remindAt).getTime() - new Date(first.remindAt).getTime();
    expect(delta).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("custom interval honors intervalDays", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const u = api.users.list(agency.id).find((x) => x.role === "agent")!;
    const first = api.reminders.create({
      tenantId: agency.id,
      userId: u.id,
      title: "Every 3 days",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: { pattern: "custom", intervalDays: 3 },
    });
    api.reminders.dismiss(first.id);
    const next = api.reminders.listForUser(agency.id, u.id)[0];
    const delta = new Date(next.remindAt).getTime() - new Date(first.remindAt).getTime();
    expect(delta).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("stops the chain once endsAt is passed", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const u = api.users.list(agency.id).find((x) => x.role === "agent")!;
    // Schedule the first occurrence at "now"; endsAt 1 day later so
    // a 7-day-out next occurrence falls past the cutoff.
    const remindAt = new Date(Date.now()).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const first = api.reminders.create({
      tenantId: agency.id,
      userId: u.id,
      title: "Capped",
      remindAt,
      recurrence: { pattern: "weekly", endsAt },
    });
    api.reminders.dismiss(first.id);
    expect(api.reminders.listForUser(agency.id, u.id)).toHaveLength(0);
  });

  it("task-anchored personal reminders also support recurrence", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const u = api.users.list(agency.id).find((x) => x.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Daily check",
    });
    const r = api.reminders.create({
      tenantId: agency.id,
      userId: u.id,
      taskId: task.id,
      title: "Check status",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: { pattern: "daily" },
    });
    api.reminders.dismiss(r.id);
    const next = api.reminders.listForTask(task.id, u.id);
    expect(next).toHaveLength(1);
    expect(next[0].recurrence?.pattern).toBe("daily");
    expect(next[0].taskId).toBe(task.id);
  });

  it("createBatch propagates recurrence to every recipient", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const staff = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager")
      .slice(0, 2);
    api.reminders.createBatch({
      tenantId: agency.id,
      userIds: staff.map((u) => u.id),
      title: "Recurring company reminder",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: { pattern: "monthly" },
    });
    for (const u of staff) {
      const mine = api.reminders.listForUser(agency.id, u.id);
      const r = mine.find((x) => x.title === "Recurring company reminder")!;
      expect(r.recurrence?.pattern).toBe("monthly");
    }
  });
});