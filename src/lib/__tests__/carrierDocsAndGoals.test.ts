// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// (1) Carrier-specific documents carry an optional lineOfBusiness so
//     the Carrier-recommendations doc library can split a carrier's
//     files into Personal vs. Commercial sections. They also surface
//     on the standard Document review queue.
//
// (2) Agency performance goals: managers set per-metric targets
//     (monthly/quarterly/annual) and the analytics card reads them
//     back. Passing `null` removes the goal for that metric.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("carrier-specific document lineOfBusiness", () => {
  it("persists lineOfBusiness on a carrier-tied document upload", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const carrier = api.carriers.listForTenant(agency.id)[0];
    const personal = api.documents.create({
      tenantId: agency.id,
      uploadedById: manager.id,
      fileName: "ho3-supplemental.pdf",
      fileType: "application/pdf",
      type: "carrier_supplemental",
      visibility: "employee_only",
      carrierId: carrier.id,
      lineOfBusiness: "personal",
    });
    const commercial = api.documents.create({
      tenantId: agency.id,
      uploadedById: manager.id,
      fileName: "bop-application.pdf",
      fileType: "application/pdf",
      type: "carrier_application",
      visibility: "employee_only",
      carrierId: carrier.id,
      lineOfBusiness: "commercial",
    });
    expect(personal.lineOfBusiness).toBe("personal");
    expect(commercial.lineOfBusiness).toBe("commercial");
    const all = api.documents.listByEntity({ carrierId: carrier.id });
    expect(all.filter((d) => d.lineOfBusiness === "personal").length).toBeGreaterThanOrEqual(1);
    expect(all.filter((d) => d.lineOfBusiness === "commercial").length).toBeGreaterThanOrEqual(1);
  });
});

describe("agencies performance goals (company + personal)", () => {
  it("adds, updates, and removes goals", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const g1 = api.agencies.addPerformanceGoal(agency.id, {
      metric: "premiumWritten",
      target: 500_000,
      period: "monthly",
      scope: "company",
    })!;
    let fresh = api.agencies.get(agency.id)!;
    expect(fresh.performanceGoals?.length).toBe(1);
    expect(fresh.performanceGoals?.[0].target).toBe(500_000);
    expect(fresh.performanceGoals?.[0].scope).toBe("company");
    // Update existing.
    api.agencies.updatePerformanceGoal(agency.id, g1.id, {
      target: 750_000,
      period: "annual",
    });
    fresh = api.agencies.get(agency.id)!;
    expect(fresh.performanceGoals?.[0].target).toBe(750_000);
    expect(fresh.performanceGoals?.[0].period).toBe("annual");
    // Remove.
    api.agencies.removePerformanceGoal(agency.id, g1.id);
    fresh = api.agencies.get(agency.id)!;
    expect(fresh.performanceGoals?.length).toBe(0);
  });

  it("supports multiple goals for the same metric (company + personal)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.agencies.addPerformanceGoal(agency.id, {
      metric: "premiumWritten",
      target: 1_000_000,
      period: "annual",
      scope: "company",
    });
    const personal = api.agencies.addPerformanceGoal(agency.id, {
      metric: "premiumWritten",
      target: 200_000,
      period: "annual",
      scope: "personal",
      assigneeIds: [agent.id],
    })!;
    const fresh = api.agencies.get(agency.id)!;
    expect(fresh.performanceGoals?.length).toBe(2);
    expect(personal.scope).toBe("personal");
    expect(personal.assigneeIds).toEqual([agent.id]);
  });

  it("stores a custom due date on a goal", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const g = api.agencies.addPerformanceGoal(agency.id, {
      metric: "policiesBound",
      target: 20,
      period: "monthly",
      scope: "company",
      dueDate: due,
    })!;
    expect(g.dueDate).toBe(due);
  });

  it("archives a goal into met / not-met history with a timestamp", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const a = api.agencies.addPerformanceGoal(agency.id, {
      metric: "newCustomers",
      target: 5,
      period: "monthly",
      scope: "company",
    })!;
    const b = api.agencies.addPerformanceGoal(agency.id, {
      metric: "policiesBound",
      target: 1000,
      period: "monthly",
      scope: "company",
    })!;
    api.agencies.archivePerformanceGoal(agency.id, a.id, 7); // met
    api.agencies.archivePerformanceGoal(agency.id, b.id, 3); // not met
    const fresh = api.agencies.get(agency.id)!;
    expect(fresh.performanceGoals?.length).toBe(0);
    const hist = fresh.performanceGoalHistory ?? [];
    expect(hist.length).toBe(2);
    const customers = hist.find((h) => h.metric === "newCustomers")!;
    expect(customers.met).toBe(true);
    expect(customers.actual).toBe(7);
    expect(customers.archivedAt).toBeTruthy();
    expect(hist.find((h) => h.metric === "policiesBound")!.met).toBe(false);
  });
});