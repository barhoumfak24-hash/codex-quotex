// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Goal-achievement sweep: when a target's actual reaches its goal, a
// one-time goal_achieved notification fires (company vs personal copy)
// and the goal is flagged so it doesn't re-notify.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("sweepGoalAchievements", () => {
  it("fires a company achievement notification once when the target is met", async () => {
    const { api } = await import("../api");
    const { sweepGoalAchievements } = await import("../performanceGoals");
    const agency = api.agencies.list()[0];
    // Activities resolved, company-wide, with a target of 0+1 we can beat.
    // Resolve a task so actual >= 1, then set target to 1.
    const task = api.tasks.create({ tenantId: agency.id, title: "x" });
    api.tasks.markComplete(task.id);
    api.agencies.addPerformanceGoal(agency.id, {
      metric: "activitiesResolved",
      target: 1,
      period: "monthly",
      scope: "company",
    });

    const before = api.aiNotifications.listUnacked(agency.id).length;
    const celebrated = sweepGoalAchievements(agency.id);
    expect(celebrated.length).toBe(1);
    const notifs = api.aiNotifications.listUnacked(agency.id);
    expect(notifs.length).toBe(before + 1);
    const n = notifs.find((x) => x.kind === "goal_achieved")!;
    expect(n.title).toMatch(/Company achieved/i);
    expect(n.goalId).toBeTruthy();
    // The goal is flagged so a second sweep is a no-op.
    expect(sweepGoalAchievements(agency.id).length).toBe(0);
  });

  it("does not fire when the target is not yet met", async () => {
    const { api } = await import("../api");
    const { sweepGoalAchievements } = await import("../performanceGoals");
    const agency = api.agencies.list()[0];
    api.agencies.addPerformanceGoal(agency.id, {
      metric: "premiumWritten",
      target: 999_999_999,
      period: "monthly",
      scope: "company",
    });
    expect(sweepGoalAchievements(agency.id).length).toBe(0);
    expect(
      api.aiNotifications.listUnacked(agency.id).some((n) => n.kind === "goal_achieved")
    ).toBe(false);
  });
});