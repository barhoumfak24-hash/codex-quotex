import { describe, expect, it } from "vitest";
import type { AiNotification, Reminder, Task } from "@/types";
import {
  DASHBOARD_RETENTION_POLICY,
  planDashboardRetention,
} from "../dashboardRetention";

const NOW = new Date("2026-07-24T12:00:00.000Z");
const TENANT_ID = "agency-1";
const USER_ID = "user-1";

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function notification(
  id: string,
  patch: Partial<AiNotification> = {}
): AiNotification {
  return {
    id,
    tenantId: TENANT_ID,
    assignedToId: USER_ID,
    kind: "inbound_notice",
    title: "Notice",
    summary: "Summary",
    createdAt: daysAgo(45),
    ...patch,
  };
}

function reminder(id: string, patch: Partial<Reminder> = {}): Reminder {
  return {
    id,
    tenantId: TENANT_ID,
    userId: USER_ID,
    title: "Reminder",
    remindAt: daysAgo(1),
    createdAt: daysAgo(45),
    ...patch,
  };
}

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    tenantId: TENANT_ID,
    title: "Activity",
    source: "manual",
    createdAt: daysAgo(45),
    ...patch,
  };
}

describe("dashboard retention policy", () => {
  it("removes only old acknowledged notifications owned by the current user", () => {
    const plan = planDashboardRetention({
      tenantId: TENANT_ID,
      userId: USER_ID,
      notifications: [
        notification("old", {
          acknowledgedAt: daysAgo(
            DASHBOARD_RETENTION_POLICY.acknowledgedNotificationDays
          ),
        }),
        notification("recent", { acknowledgedAt: daysAgo(2) }),
        notification("unread"),
        notification("other-user", {
          assignedToId: "user-2",
          acknowledgedAt: daysAgo(45),
        }),
      ],
      reminders: [],
      tasks: [],
      now: NOW,
    });

    expect(plan.notificationIdsToRemove).toEqual(["old"]);
  });

  it("dismisses reminders whose linked activity is resolved without deleting the activity", () => {
    const plan = planDashboardRetention({
      tenantId: TENANT_ID,
      userId: USER_ID,
      notifications: [],
      reminders: [
        reminder("resolved-reminder", { taskId: "resolved-task" }),
        reminder("open-reminder", { taskId: "open-task" }),
      ],
      tasks: [
        task("resolved-task", {
          status: "resolved",
          completedAt: daysAgo(1),
        }),
        task("open-task", { status: "open" }),
      ],
      now: NOW,
    });

    expect(plan.reminderIdsToDismiss).toEqual(["resolved-reminder"]);
    expect(plan.reminderIdsToRemove).toEqual([]);
  });

  it("removes old dismissed and orphaned reminders but preserves recent or active work", () => {
    const plan = planDashboardRetention({
      tenantId: TENANT_ID,
      userId: USER_ID,
      notifications: [],
      reminders: [
        reminder("old-dismissed", {
          dismissedAt: daysAgo(DASHBOARD_RETENTION_POLICY.dismissedReminderDays),
        }),
        reminder("recent-dismissed", { dismissedAt: daysAgo(2) }),
        reminder("old-orphan", {
          taskId: "missing-task",
          createdAt: daysAgo(DASHBOARD_RETENTION_POLICY.orphanedReminderDays),
        }),
        reminder("recent-orphan", {
          taskId: "missing-task-2",
          createdAt: daysAgo(1),
        }),
        reminder("active", { taskId: "open-task" }),
      ],
      tasks: [task("open-task", { status: "in_progress" })],
      now: NOW,
    });

    expect(plan.reminderIdsToRemove).toEqual(["old-dismissed", "old-orphan"]);
    expect(plan.reminderIdsToDismiss).toEqual([]);
  });
});
