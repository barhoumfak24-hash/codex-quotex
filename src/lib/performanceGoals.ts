import { api } from "@/lib/api";
import type {
  ArchivedPerformanceGoal,
  CustomPerformanceGoalFormula,
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
    key: "newProspects",
    label: "New prospects",
    helper: "Prospect profiles created.",
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

export interface GoalMetricMeta {
  label: string;
  helper: string;
  format: "money" | "count";
}

export interface CustomGoalMetricDraft extends GoalMetricMeta {
  prompt: string;
  formula: CustomPerformanceGoalFormula;
}

export const PERIOD_DAYS: Record<PerformanceGoalPeriod, number> = {
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

export function periodLabel(p: PerformanceGoalPeriod): string {
  return p === "monthly" ? "month" : p === "quarterly" ? "quarter" : "year";
}

export function goalProgressPercent(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((actual / target) * 100)));
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
    case "newProspects":
      return api.prospects
        .listByTenant(agencyId)
        .filter(
          (p) =>
            new Date(p.createdAt).getTime() >= since &&
            (!scoped ||
              (p.assignedAgentId != null && owners.has(p.assignedAgentId)) ||
              (p.additionalAgentIds ?? []).some((a) => owners.has(a)))
        ).length;
    case "activitiesResolved":
      return api.tasks
        .listByTenant(agencyId)
        .filter(
          (t) =>
            t.completedAt &&
            new Date(t.completedAt).getTime() >= since &&
            (!scoped ||
              (t.assignedToId != null && owners.has(t.assignedToId)) ||
              (t.additionalAssignedToIds ?? []).some((id) => owners.has(id)))
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
    case "custom":
      return 0;
  }
}

function customActualForFormula(
  agencyId: string,
  formula: CustomPerformanceGoalFormula | undefined,
  period: PerformanceGoalPeriod,
  userIds?: string[]
): number {
  if (!formula) return 0;
  if (
    formula === "newProspects" ||
    formula === "newCustomers" ||
    formula === "policiesBound" ||
    formula === "activitiesResolved"
  ) {
    return actualForMetric(agencyId, formula, period, userIds);
  }

  const since = Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  const scoped = userIds != null && userIds.length > 0;
  const owners = new Set(userIds ?? []);
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
  const policyCustomer = (policyId: string) => api.policies.get(policyId)?.customerId;

  switch (formula) {
    case "policiesRenewed":
      return api.renewals
        .listByTenant(agencyId)
        .filter((r) => {
          const customerId = policyCustomer(r.policyId);
          return (
            r.status === "renewed" &&
            new Date(r.renewalDate).getTime() >= since &&
            (!customerIds || (customerId != null && customerIds.has(customerId)))
          );
        }).length;
    case "claimsOpened":
      return api.claims
        .listByTenant(agencyId)
        .filter(
          (c) =>
            new Date(c.openedAt).getTime() >= since &&
            (!customerIds || customerIds.has(c.customerId))
        ).length;
    case "claimsClosed":
      return api.claims
        .listByTenant(agencyId)
        .filter(
          (c) =>
            c.closedAt != null &&
            new Date(c.closedAt).getTime() >= since &&
            (!customerIds || customerIds.has(c.customerId))
        ).length;
    case "documentsApproved":
      return api.documents
        .listByTenant(agencyId)
        .filter(
          (d) =>
            d.status === "approved" &&
            new Date(d.uploadedAt).getTime() >= since &&
            (!customerIds || (d.customerId != null && customerIds.has(d.customerId)))
        ).length;
  }
  return 0;
}

export function inferCustomGoalMetric(text: string): CustomGoalMetricDraft {
  const prompt = text.trim();
  const normalized = prompt.toLowerCase();
  if (/\b(renew|renewal|renewed|retention)\b/.test(normalized)) {
    return {
      prompt,
      formula: "policiesRenewed",
      label: "Policies renewed",
      helper: "AI-tracked count of policies marked renewed in the selected period.",
      format: "count",
    };
  }
  if (/\b(closed|close|resolved)\b/.test(normalized) && /\bclaim/.test(normalized)) {
    return {
      prompt,
      formula: "claimsClosed",
      label: "Claims closed",
      helper: "AI-tracked count of claims closed in the selected period.",
      format: "count",
    };
  }
  if (/\bclaim/.test(normalized)) {
    return {
      prompt,
      formula: "claimsOpened",
      label: "Claims opened",
      helper: "AI-tracked count of claims opened in the selected period.",
      format: "count",
    };
  }
  if (/\b(document|documents|doc|docs|reviewed|approved)\b/.test(normalized)) {
    return {
      prompt,
      formula: "documentsApproved",
      label: "Documents approved",
      helper: "AI-tracked count of documents approved in the selected period.",
      format: "count",
    };
  }
  if (/\b(prospect|lead|quote start|quote starts)\b/.test(normalized)) {
    return {
      prompt,
      formula: "newProspects",
      label: "New prospects",
      helper: "AI-tracked count of prospect profiles created in the selected period.",
      format: "count",
    };
  }
  if (/\b(client|customer)\b/.test(normalized)) {
    return {
      prompt,
      formula: "newCustomers",
      label: "New clients",
      helper: "AI-tracked count of customer profiles created in the selected period.",
      format: "count",
    };
  }
  if (/\b(policy|policies|bound|bind)\b/.test(normalized)) {
    return {
      prompt,
      formula: "policiesBound",
      label: "Policies bound",
      helper: "AI-tracked count of newly bound policies in the selected period.",
      format: "count",
    };
  }
  return {
    prompt,
    formula: "activitiesResolved",
    label: prompt ? titleCaseMetric(prompt) : "Custom activity metric",
    helper: "AI-tracked activity goal using the closest available operational signal: resolved activities.",
    format: "count",
  };
}

function titleCaseMetric(text: string): string {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function goalMetricMeta(
  goal: Pick<
    PerformanceGoal | ArchivedPerformanceGoal,
    "metric" | "customMetricLabel" | "customMetricHelper"
  >
): GoalMetricMeta {
  if (goal.metric === "custom") {
    return {
      label: goal.customMetricLabel ?? "Custom metric",
      helper: goal.customMetricHelper ?? "AI-tracked custom operational metric.",
      format: "count",
    };
  }
  return (
    GOAL_METRICS.find((m) => m.key === goal.metric) ?? {
      label: goal.metric,
      helper: "Performance metric.",
      format: "count",
    }
  );
}

// Convenience: a goal's current value, scoped automatically by its
// company/personal setting.
export function goalActual(
  agencyId: string,
  goal: Pick<
    PerformanceGoal | ArchivedPerformanceGoal,
    "metric" | "period" | "scope" | "assigneeIds" | "customMetricFormula"
  >
): number {
  if (goal.metric === "custom") {
    return customActualForFormula(
      agencyId,
      goal.customMetricFormula,
      goal.period,
      goal.scope === "personal" ? goal.assigneeIds : undefined
    );
  }
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
    const metric = goalMetricMeta(g).label;
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
