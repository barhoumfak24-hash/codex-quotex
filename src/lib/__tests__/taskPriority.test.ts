// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Manual priority + importance overrides on activities. Lets an
// agent / manager pin a card to the top of the queue, send it to
// the bottom, or escalate / downgrade severity (yellow → amber →
// red) regardless of what the AI tagged at creation time.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks priority + severity", () => {
  it("moveToFront pins the task and sorts it ahead of higher-severity peers", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const a = api.tasks.create({ tenantId: agency.id, title: "First (low)" });
    const b = api.tasks.create({ tenantId: agency.id, title: "Second (low)" });
    api.tasks.setSeverity(b.id, "urgent");
    // Without pinning, urgent task b would come ahead of a.
    let order = api.tasks
      .listByTenant(agency.id)
      .map((t) => t.id)
      .filter((id) => id === a.id || id === b.id);
    // listByTenant sorts by priorityRank then createdAt — severity
    // is only a secondary key in listOpen / TasksPage. So far priorityRank
    // for both is 0, meaning newest (b) comes first.
    expect(order[0]).toBe(b.id);
    api.tasks.moveToFront(a.id);
    order = api.tasks
      .listByTenant(agency.id)
      .map((t) => t.id)
      .filter((id) => id === a.id || id === b.id);
    expect(order[0]).toBe(a.id);
  });

  it("moveToBack drops the task behind un-prioritized peers", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const a = api.tasks.create({ tenantId: agency.id, title: "A" });
    const b = api.tasks.create({ tenantId: agency.id, title: "B" });
    api.tasks.moveToBack(a.id);
    const order = api.tasks
      .listByTenant(agency.id)
      .map((t) => t.id)
      .filter((id) => id === a.id || id === b.id);
    expect(order[0]).toBe(b.id);
    expect(order[1]).toBe(a.id);
  });

  it("reorderQueue persists an exact manual board order", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const a = api.tasks.create({ tenantId: agency.id, title: "A" });
    const b = api.tasks.create({ tenantId: agency.id, title: "B" });
    const c = api.tasks.create({ tenantId: agency.id, title: "C" });
    api.tasks.setSeverity(c.id, "urgent");

    api.tasks.reorderQueue([b.id, a.id, c.id], b.id);

    const order = api.tasks
      .listByTenant(agency.id)
      .map((t) => t.id)
      .filter((id) => id === a.id || id === b.id || id === c.id);
    expect(order).toEqual([b.id, a.id, c.id]);
    expect(api.tasks.history(b.id).map((h) => h.action)).toContain("task.reordered_queue");
  });

  it("clearPriority returns the task to its default position", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const a = api.tasks.create({ tenantId: agency.id, title: "A" });
    api.tasks.moveToBack(a.id);
    const t1 = api.tasks.listByTenant(agency.id).find((t) => t.id === a.id)!;
    expect(t1.priorityRank).toBe(-1);
    api.tasks.clearPriority(a.id);
    const t2 = api.tasks.listByTenant(agency.id).find((t) => t.id === a.id)!;
    expect(t2.priorityRank).toBe(0);
  });

  it("setSeverity escalates the task and stamps the change metadata", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const user = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const t = api.tasks.create({ tenantId: agency.id, title: "Quiet one" });
    expect(t.severity).toBe("info");
    api.tasks.setSeverity(t.id, "urgent", user.id);
    const after = api.tasks.listByTenant(agency.id).find((x) => x.id === t.id)!;
    expect(after.severity).toBe("urgent");
    expect(after.severityChangedAt).toBeTruthy();
    expect(after.severityChangedById).toBe(user.id);
  });

  it("priority changes show up in task history", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const t = api.tasks.create({ tenantId: agency.id, title: "Promote me" });
    api.tasks.moveToFront(t.id);
    api.tasks.setSeverity(t.id, "warning");
    const actions = api.tasks.history(t.id).map((h) => h.action);
    expect(actions).toContain("task.moved_to_front");
    expect(actions).toContain("task.severity_changed");
  });

  it("deletes only the activity and preserves its remarks with a final deletion remark", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const user = api.users.list(agency.id).find((candidate) => candidate.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const task = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      title: "Call client about renewal",
      createdById: user.id,
    });
    const existingRemark = api.status.create({
      tenantId: agency.id,
      source: "agent",
      message: "Client asked for a callback",
      visibility: "internal",
      customerId: customer.id,
      taskId: task.id,
      createdById: user.id,
    });

    expect(api.tasks.deleteActivity(task.id, user.id)).toBe(true);
    expect(api.tasks.get(task.id)).toBeUndefined();

    const remarks = api.status.listFor({ customerId: customer.id });
    expect(remarks.some((remark) => remark.id === existingRemark.id)).toBe(true);
    expect(
      remarks.filter(
        (remark) =>
          remark.message === "Activity deleted" &&
          remark.visibility === "internal" &&
          remark.createdById === user.id
      )
    ).toHaveLength(1);
    expect(api.tasks.history(task.id).map((entry) => entry.action)).toContain("task.deleted");

    expect(api.tasks.deleteActivity(task.id, user.id)).toBe(false);
    expect(
      api.status
        .listFor({ customerId: customer.id })
        .filter((remark) => remark.message === "Activity deleted")
    ).toHaveLength(1);
  });
});
