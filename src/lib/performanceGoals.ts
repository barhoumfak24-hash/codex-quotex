import { api } from "@/lib/api";
import type {
  ArchivedPerformanceGoal,
  PerformanceGoal,
  PerformanceGoalMetric,
  PerformanceGoalPeriod,
} from "@/types";

// =====================================================================
// Shared performance-goal definitions + actuals. Used by the Analytics
// page's full goals card and the dashboard's compact goals widget so
// the metric list, period windows, and "current value" math stay in
// one place.
// =====================================================================

export const GOAL_METRICS: {
  key: PerformanceGoalMetric;
  label: string;
  helper: string;
  format: "money" | "count";
}[] = [
  {
    key: "premiumWritten",
    label: "Premium written",
    helper: "Sum of bound-policy premiums.",
    format: "money",
  },
  {
    key: "newCustomers",
    label: "New clients",
    helper: "Customer profiles created.",
    format: "count",
  },
  {
    key: "activitiesResolved",
    label: "Activities resolved",
    helper: "Activity Center tasks closed.",
    format: "count",
  },
  {
    key: "policiesBound",
    label: "Policies bound",
    helper: "New bound policies in period.",
    format: "count",
  },
];

export const PERIOD_DAYS: Record<PerformanceGoalPeriod, number> = {
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

export function periodLabel(p: PerformanceGoalPeriod): string {
  return p === "monthly" ? "month" : p === "quarterly" ? "quarter" : "year";
}

// Current value for a metric over the period. When `userIds` is
// provided the actual is scoped to those staff members' books
// (personal goals); omitted = agency-wide (company goals).
export function actualForMetric(
  agencyId: string,
  metric: PerformanceGoalMetric,
  period: PerformanceGoalPeriod,
  userIds?: string[]
): number {
  const since = Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  const scoped = userIds != null && userIds.length > 0;
  const owners = new Set(userIds ?? []);
  // Customers in the scoped agents' books (primary or co-owner).
  const customerIds = scoped
    ? new Set(
        api.customers
          .list(agencyId)
          .filter(
            (c) =>
              (c.assignedAgentId && owners.has(c.assignedAgentId)) ||
              (c.additionalAgentIds ?? []).some((a) => owners.has(a))
          )
          .map((c) => c.id)
      )
    : null;

  switch (metric) {
    case "premiumWritten":
      return api.policies
        .listByTenant(agencyId)
        .filter(
          (p) =>
            p.status === "bound" &&
            new Date(p.createdAt).getTime() >= since &&
            (!customerIds || customerIds.has(p.customerId))
        )
        .reduce((s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0), 0);
    case "newCustomers":
      return api.customers
        .list(agencyId)
        .filter(
          (c) =>
            new Date(c.createdAt).getTime() >= since &&
            (!customerIds || customerIds.has(c.id))
        ).length;
    case "activitiesResolved":
      return api.tasks
        .listByTenant(agencyId)
        .filter(
          (t) =>
            t.completedAt &&
            new Date(t.completedAt).getTime() >= since &&
            (!scoped || (t.assignedToId != null && owners.has(t.assignedToId)))
        ).length;
    case "policiesBound":
      return api.policies
        .listByTenant(agencyId)
        .filter(
          (p) =>
            p.status === "bound" &&
            new Date(p.createdAt).getTime() >= since &&
            (!customerIds || customerIds.has(p.customerId))
        ).length;
  }
}

// Convenience: a goal's current value, scoped automatically by its
// company/personal setting.
export function goalActual(
  agencyId: string,
  goal: Pick<PerformanceGoal | ArchivedPerformanceGoal, "metric" | "period" | "scope" | "assigneeIds">
): number {
  return actualForMetric(
    agencyId,
    goal.metric,
    goal.period,
    goal.scope === "personal" ? goal.assigneeIds : undefined
  );
}

// Short label for a goal's assignees ("Company", "Jane Smith",
// "Jane Smith + 2"). Resolves names via api.users.
export function goalScopeLabel(
  agencyId: string,
  goal: Pick<PerformanceGoal | ArchivedPerformanceGoal, "scope" | "assigneeIds">
): string {
  if (goal.scope === "company") return "Company-wide";
  const ids = goal.assigneeIds ?? [];
  if (ids.length === 0) return "Personal";
  const names = ids
    .map((id) => api.users.get(id)?.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return "Personal";
  if (names.length === 1) return names[0];
  return `${names[0]} + ${names.length - 1}`;
}

// Backwards-compat: older builds stored agency.performanceGoals as a
// metric-keyed object ({ premiumWritten: {...} }). The model is now a
// flat array of goals. Coerce whatever is persisted into an array so
// the UI never calls .filter on a stale object shape.
export function coerceGoals(raw: unknown): PerformanceGoal[] {
  if (Array.isArray(raw)) return raw as PerformanceGoal[];
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, any>).map(([metric, g], i) => ({
      id: `goal_legacy_${metric}_${i}`,
      metric: metric as PerformanceGoalMetric,
      target: Number(g?.target ?? 0),
      period: (g?.period ?? "monthly") as PerformanceGoalPeriod,
      dueDate: g?.dueDate,
      scope: "company" as const,
      updatedAt: g?.updatedAt ?? new Date().toISOString(),
    }));
  }
  return [];
}

// Detect newly-achieved goals (actual >= target) that haven't fired a
// celebration yet. For each, drop a goal_achieved notification + mark
// it notified so we don't re-fire. Returns the goals it celebrated.
export function sweepGoalAchievements(agencyId: string): PerformanceGoal[] {
  const agency = api.agencies.get(agencyId);
  if (!agency) return [];
  const goals = coerceGoals(agency.performanceGoals);
  const newlyAchieved: PerformanceGoal[] = [];
  for (const g of goals) {
    if (g.achievedNotifiedAt) continue;
    if (g.target <= 0) continue;
    if (goalActual(agencyId, g) < g.target) continue;
    const def = GOAL_METRICS.find((m) => m.key === g.metric);
    const metric = def?.label ?? g.metric;
    const title =
      g.scope === "company"
        ? `Company achieved its ${metric} target! 🎉`
        : `${goalScopeLabel(agencyId, g)} completed the ${metric} target! 🎉`;
    api.aiNotifications.create({
      tenantId: agencyId,
      kind: "goal_achieved",
      title,
      summary: `${metric} hit its target of ${g.target.toLocaleString()} (${periodLabel(
        g.period
      )}).`,
      goalId: g.id,
      severity: "info",
      topic: "other",
    });
    api.agencies.markGoalAchievementNotified(agencyId, g.id);
    newlyAchieved.push(g);
  }
  return newlyAchieved;
}