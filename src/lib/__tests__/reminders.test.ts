// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Per-user reminders. Unlike snooze, reminders do not change task
// state — they're a private follow-up for the user who set them.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("reminders namespace", () => {
  it("create + listForUser returns the reminder sorted by remindAt", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Test task",
    });
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const sooner = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      taskId: task.id,
      remindAt: later,
      note: "Check back in two days",
    });
    api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      taskId: task.id,
      remindAt: sooner,
    });
    const list = api.reminders.listForUser(agency.id, agent.id);
    expect(list.length).toBe(2);
    expect(list[0].remindAt).toBe(sooner);
    expect(list[1].remindAt).toBe(later);
  });

  it("reminders are scoped to the user — other staff don't see them", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Shared task",
    });
    api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      taskId: task.id,
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(api.reminders.listForUser(agency.id, agent.id).length).toBe(1);
    expect(api.reminders.listForUser(agency.id, manager.id).length).toBe(0);
  });

  it("dismiss drops the reminder from listForUser without deleting the row", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Dismissed",
    });
    const r = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      taskId: task.id,
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    api.reminders.dismiss(r.id);
    expect(api.reminders.listForUser(agency.id, agent.id).length).toBe(0);
    expect(db.list("reminders").length).toBe(1);
  });

  it("supports general reminders not anchored to a task", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const r = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "Call carrier rep about endorsement",
      note: "Mention the wind-mit re-inspection deadline.",
      remindAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(r.taskId).toBeUndefined();
    expect(r.title).toBe("Call carrier rep about endorsement");
    const list = api.reminders.listForUser(agency.id, agent.id);
    expect(list.some((x) => x.id === r.id)).toBe(true);
  });

  it("listDismissedForUser returns dismissed reminders newest-first", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const a = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "A",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const b = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "B",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    api.reminders.dismiss(a.id);
    api.reminders.dismiss(b.id);
    const past = api.reminders.listDismissedForUser(agency.id, agent.id);
    expect(past.length).toBe(2);
    // b was dismissed second → newest first.
    expect(past[0].id).toBe(b.id);
    expect(past[1].id).toBe(a.id);
    expect(api.reminders.listForUser(agency.id, agent.id).length).toBe(0);
  });

  it("importance defaults to info and can be set per reminder", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const def = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "Default",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(def.importance).toBe("info");
    const high = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "Urgent",
      importance: "urgent",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(high.importance).toBe("urgent");
    api.reminders.setImportance(def.id, "warning");
    const reloaded = api.reminders
      .listForUser(agency.id, agent.id)
      .find((x) => x.id === def.id)!;
    expect(reloaded.importance).toBe("warning");
  });

  it("restore brings a dismissed reminder back to the active list", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const r = api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      title: "Mistaken dismiss",
      remindAt: new Date(Date.now() + 60_000).toISOString(),
    });
    api.reminders.dismiss(r.id);
    expect(api.reminders.listForUser(agency.id, agent.id).length).toBe(0);
    api.reminders.restore(r.id);
    expect(api.reminders.listForUser(agency.id, agent.id).length).toBe(1);
    expect(api.reminders.listDismissedForUser(agency.id, agent.id).length).toBe(0);
  });

  it("does not mutate the task it points at — task stays open + visible", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Untouched",
    });
    const beforeOpen = api.tasks.listOpen(agency.id).some((t) => t.id === task.id);
    api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      taskId: task.id,
      remindAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const afterOpen = api.tasks.listOpen(agency.id).some((t) => t.id === task.id);
    expect(beforeOpen).toBe(true);
    expect(afterOpen).toBe(true);
    const reloaded = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(reloaded.status).not.toBe("snoozed");
    expect(reloaded.snoozedUntil).toBeUndefined();
  });
});