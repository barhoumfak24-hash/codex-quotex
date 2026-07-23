// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { resetAiResourceGovernor } = await import("../aiResourceGovernor");
  resetAiResourceGovernor();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function startFlowWithActivities(lineOfBusiness: "personal" | "commercial") {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
  const customer = api.customers.list(agency.id)[0];
  const category =
    lineOfBusiness === "personal" ? api.categories.get("cat_primary_home") : undefined;

  const quoteActivity = api.tasks.create({
    tenantId: agency.id,
    customerId: customer.id,
    assignedToId: agent.id,
    title: `${customer.name} requested a ${lineOfBusiness} quote`,
    description: "Start the requested quote flow and continue the application.",
    createdById: agent.id,
  });
  const unrelatedActivity = api.tasks.create({
    tenantId: agency.id,
    customerId: customer.id,
    assignedToId: agent.id,
    title: "Review contact preferences",
    description: "Confirm the preferred phone number.",
    createdById: agent.id,
  });

  const session = await api.quoting.startSession({
    tenantId: agency.id,
    customerId: customer.id,
    createdById: agent.id,
    assetType: lineOfBusiness === "personal" ? "coastal_home" : "other",
    contactName: customer.name,
    address: lineOfBusiness === "personal" ? "901 Test Street, Northville, MI 48167" : undefined,
    categoryId: category?.id,
    categoryLabel: category?.label,
    categoryIds: category ? [category.id] : undefined,
    categoryLabels: category ? [category.label] : undefined,
    lineOfBusiness,
  });

  return {
    api,
    agent,
    session,
    quoteActivityId: quoteActivity.id,
    unrelatedActivityId: unrelatedActivity.id,
  };
}

describe("quote-flow activity synchronization", () => {
  it.each(["personal", "commercial"] as const)(
    "moves the correlated %s activity to in progress when staff starts the flow",
    async (lineOfBusiness) => {
      const result = await startFlowWithActivities(lineOfBusiness);

      expect(result.api.tasks.get(result.quoteActivityId)).toMatchObject({
        status: "in_progress",
        quoteSessionId: result.session.id,
        startedById: result.agent.id,
      });
      expect(result.api.tasks.get(result.quoteActivityId)?.startedAt).toBeTruthy();
      expect(result.api.tasks.get(result.unrelatedActivityId)?.status).toBe("open");
      expect(result.api.tasks.get(result.unrelatedActivityId)?.quoteSessionId).toBeUndefined();
    }
  );
});
