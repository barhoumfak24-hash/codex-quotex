// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("accountingSettings timesheet configuration", () => {
  it("defaults timesheet reminder recipients to active agents", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agentIds = api.users
      .list(agency.id)
      .filter((user) => user.active && user.role === "agent")
      .map((user) => user.id);

    const settings = api.accountingSettings.get(agency.id);

    expect(settings.timesheetRecipientIds.sort()).toEqual(agentIds.sort());
  });

  it("saves selected recipients and creates dashboard notifications without activity tasks", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const [agent] = api.users
      .list(agency.id)
      .filter((user) => user.active && user.role === "agent");
    const beforeTasks = api.tasks.listByTenant(agency.id).length;

    const settings = api.accountingSettings.update(
      agency.id,
      {
        timesheetFrequency: "weekly",
        dueWeekday: 5,
        dueDayOfMonth: 28,
        reminderTime: "10:30",
        timesheetRecipientIds: [agent.id],
      },
      manager.id
    );

    expect(settings.timesheetRecipientIds).toEqual([agent.id]);
    const notifications = api.aiNotifications
      .listUnacked(agency.id)
      .filter((notification) => notification.kind === "timesheet_due");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].assignedToId).toBe(agent.id);
    expect(notifications[0].summary).toContain("10:30");
    expect(notifications.map((notification) => notification.assignedToId)).toEqual([agent.id]);

    expect(api.aiNotifications.acknowledge(notifications[0].id, agent.id)).toBeNull();
    expect(api.tasks.listByTenant(agency.id)).toHaveLength(beforeTasks);
  });

  it("does not duplicate an unacknowledged timesheet notification for the same period", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
    const agent = api.users.list(agency.id).find((user) => user.active && user.role === "agent")!;

    api.accountingSettings.update(
      agency.id,
      { reminderTime: "09:15", timesheetRecipientIds: [agent.id] },
      manager.id
    );
    api.accountingSettings.update(
      agency.id,
      { reminderTime: "09:15", timesheetRecipientIds: [agent.id] },
      manager.id
    );

    expect(
      api.aiNotifications
        .listUnacked(agency.id)
        .filter((notification) => notification.kind === "timesheet_due")
    ).toHaveLength(1);
  });
});
