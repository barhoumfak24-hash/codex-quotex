import type { AiNotification, Reminder, Task } from "@/types";
import { db } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_RETENTION_POLICY = {
  acknowledgedNotificationDays: 30,
  dismissedReminderDays: 30,
  orphanedReminderDays: 7,
} as const;

type RetentionInput = {
  tenantId: string;
  userId: string;
  notifications: AiNotification[];
  reminders: Reminder[];
  tasks: Task[];
  now?: Date;
};

export type DashboardRetentionPlan = {
  notificationIdsToRemove: string[];
  reminderIdsToDismiss: string[];
  reminderIdsToRemove: string[];
};

function ageInDays(value: string | undefined, nowMs: number): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (nowMs - timestamp) / DAY_MS);
}

function taskIsResolved(task: Task | undefined): boolean {
  return !!task && (task.status === "resolved" || !!task.completedAt);
}

export function planDashboardRetention({
  tenantId,
  userId,
  notifications,
  reminders,
  tasks,
  now = new Date(),
}: RetentionInput): DashboardRetentionPlan {
  const nowMs = now.getTime();
  const tasksById = new Map(
    tasks.filter((task) => task.tenantId === tenantId).map((task) => [task.id, task])
  );

  const notificationIdsToRemove = notifications
    .filter(
      (notification) =>
        notification.tenantId === tenantId &&
        notification.assignedToId === userId &&
        !!notification.acknowledgedAt &&
        ageInDays(notification.acknowledgedAt, nowMs) >=
          DASHBOARD_RETENTION_POLICY.acknowledgedNotificationDays
    )
    .map((notification) => notification.id);

  const reminderIdsToDismiss: string[] = [];
  const reminderIdsToRemove: string[] = [];

  reminders
    .filter((reminder) => reminder.tenantId === tenantId && reminder.userId === userId)
    .forEach((reminder) => {
      if (
        reminder.dismissedAt &&
        ageInDays(reminder.dismissedAt, nowMs) >=
          DASHBOARD_RETENTION_POLICY.dismissedReminderDays
      ) {
        reminderIdsToRemove.push(reminder.id);
        return;
      }

      if (!reminder.taskId) return;
      const task = tasksById.get(reminder.taskId);
      if (taskIsResolved(task) && !reminder.dismissedAt) {
        reminderIdsToDismiss.push(reminder.id);
        return;
      }

      if (
        !task &&
        ageInDays(reminder.createdAt, nowMs) >=
          DASHBOARD_RETENTION_POLICY.orphanedReminderDays
      ) {
        reminderIdsToRemove.push(reminder.id);
      }
    });

  return {
    notificationIdsToRemove,
    reminderIdsToDismiss,
    reminderIdsToRemove,
  };
}

export function runDashboardRetention(
  tenantId: string,
  userId: string,
  now = new Date()
): DashboardRetentionPlan {
  const plan = planDashboardRetention({
    tenantId,
    userId,
    notifications: db.list("aiNotifications"),
    reminders: db.list("reminders"),
    tasks: db.list("tasks"),
    now,
  });

  plan.notificationIdsToRemove.forEach((id) =>
    db.remove("aiNotifications", id, {
      actorId: "system",
      reason: "dashboard_retention_policy",
    })
  );
  plan.reminderIdsToDismiss.forEach((id) =>
    db.update("reminders", id, { dismissedAt: now.toISOString() })
  );
  plan.reminderIdsToRemove.forEach((id) =>
    db.remove("reminders", id, {
      actorId: "system",
      reason: "dashboard_retention_policy",
    })
  );

  return plan;
}
