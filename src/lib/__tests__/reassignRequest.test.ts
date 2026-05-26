// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Agent → manager reassignment request. An agent flags an activity to
// be moved to another agent; a manager actions it. Assigning clears
// the request.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.requestReassign", () => {
  it("flags the task + drops a manager notification", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const from = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const to = api.users.create({
      role: "agent",
      tenantId: agency.id,
      email: "to-agent@example.com",
      name: "To Agent",
    });
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Move me",
      assignedToId: from.id,
      createdById: from.id,
    });
    const before = api.aiNotifications.listUnacked(agency.id).length;
    const out = api.tasks.requestReassign(task.id, from.id, to.id, "Out of office");
    expect(out.notificationId).toBeTruthy();
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(fresh.reassignRequestedAt).toBeTruthy();
    expect(fresh.reassignRequestToId).toBe(to.id);
    expect(fresh.reassignReason).toBe("Out of office");
    const notifs = api.aiNotifications.listUnacked(agency.id);
    expect(notifs.length).toBe(before + 1);
    expect(notifs.some((n) => n.kind === "reassign_request" && n.taskId === task.id)).toBe(true);
  });

  it("assigning the task clears the pending reassignment request", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const from = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const to = api.users.create({
      role: "agent",
      tenantId: agency.id,
      email: "to-agent2@example.com",
      name: "To Agent 2",
    });
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Move me",
      assignedToId: from.id,
      createdById: from.id,
    });
    api.tasks.requestReassign(task.id, from.id, to.id);
    api.tasks.assign(task.id, to.id, manager.id);
    const fresh = api.tasks.listByTenant(agency.id).find((t) => t.id === task.id)!;
    expect(fresh.assignedToId).toBe(to.id);
    expect(fresh.reassignRequestedAt).toBeUndefined();
    expect(fresh.reassignRequestToId).toBeUndefined();
  });
});