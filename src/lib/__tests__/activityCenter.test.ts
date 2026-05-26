// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Activity Center lifecycle: AI auto-reply → notification →
// acknowledge → open task → in-progress → resolved, plus
// snooze + reassign. Every state change appears in api.tasks.history.
// =====================================================================

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("Activity Center task lifecycle", () => {
  it("acknowledging an AI notification spawns a task with the full activity-card context", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please cancel my policy effective next month.",
    });
    const notif = api.aiNotifications
      .listByTenant(agency.id)
      .find((n) => n.id === out.notificationId)!;
    // Title follows the "Customer received automated message regarding [topic]…" format.
    expect(notif.title).toMatch(/customer received automated message regarding|new customer request regarding/i);
    expect(notif.topic).toBe("cancellation_request");
    expect(notif.severity).toBe("urgent");
    expect(notif.aiSummary).toBeTruthy();
    expect(notif.aiReplyBody).toMatch(/cancellation form/i);
    expect(notif.originalMessageContent).toMatch(/cancel my policy/i);

    const ack = api.aiNotifications.acknowledge(notif.id);
    expect(ack).not.toBeNull();
    const task = ack!.task;
    expect(task.title).toBe(notif.title);
    expect(task.topic).toBe("cancellation_request");
    expect(task.severity).toBe("urgent");
    expect(task.aiSummary).toBe(notif.aiSummary);
    expect(task.aiReplyBody).toBe(notif.aiReplyBody);
    expect(task.originalMessageContent).toBe(notif.originalMessageContent);
    expect(api.tasks.statusOf(task)).toBe("open");
  });

  it("markInProgress → markComplete moves the task between buckets", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update my deductible.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    expect(ack.task.startedAt).toBeUndefined();
    expect(ack.task.completedAt).toBeUndefined();

    const inProgress = api.tasks.markInProgress(ack.task.id)!;
    expect(api.tasks.statusOf(inProgress)).toBe("in_progress");
    expect(inProgress.startedAt).toBeTruthy();
    expect(api.tasks.listOpen(agency.id).some((t) => t.id === ack.task.id)).toBe(true);

    const done = api.tasks.markComplete(ack.task.id)!;
    expect(api.tasks.statusOf(done)).toBe("resolved");
    expect(done.startedAt).toBe(inProgress.startedAt); // preserved
    expect(done.completedAt).toBeTruthy();
    expect(api.tasks.listOpen(agency.id).some((t) => t.id === ack.task.id)).toBe(false);
    expect(api.tasks.listCompleted(agency.id).some((t) => t.id === ack.task.id)).toBe(true);
  });

  it("startedAt only stamps on the FIRST in-progress flip (preserves across snooze)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "First contact.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    const first = api.tasks.markInProgress(ack.task.id)!;
    const firstStartedAt = first.startedAt!;
    api.tasks.snooze(ack.task.id, 1);
    // Bring it back via a second in-progress flip; startedAt unchanged.
    const second = api.tasks.markInProgress(ack.task.id)!;
    expect(second.startedAt).toBe(firstStartedAt);
  });

  it("snoozing hides the task from listOpen until the window passes", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Quick question.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.snooze(ack.task.id, 3);
    expect(api.tasks.listOpen(agency.id).some((t) => t.id === ack.task.id)).toBe(false);
    expect(api.tasks.listSnoozed(agency.id).some((t) => t.id === ack.task.id)).toBe(true);
  });

  it("assign() writes a reassignment audit row tagged with the agent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [agentA, agentB] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update needed.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.assign(ack.task.id, agentB.id, agentA.id);
    const history = api.tasks.history(ack.task.id);
    const reassigned = history.find((h) => h.action === "task.reassigned")!;
    expect(reassigned).toBeTruthy();
    expect(reassigned.actorId).toBe(agentA.id);
    expect((reassigned.metadata as { toAgentId?: string })?.toAgentId).toBe(agentB.id);
  });

  it("every lifecycle action shows up in api.tasks.history (ack, in-progress, snooze, resolved, reopen)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "x",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    api.tasks.markInProgress(ack.task.id);
    api.tasks.snooze(ack.task.id, 1);
    api.tasks.markComplete(ack.task.id);
    api.tasks.reopen(ack.task.id);
    const actions = api.tasks.history(ack.task.id).map((h) => h.action);
    expect(actions).toContain("task.created_from_notification");
    expect(actions).toContain("task.in_progress");
    expect(actions).toContain("task.snoozed");
    expect(actions).toContain("task.resolved");
    expect(actions).toContain("task.reopened");
  });
});