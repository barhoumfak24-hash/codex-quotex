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

  it("links the newest unresolved coverage-change activity even when its text does not mention quoting", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const older = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `Coverage change — ${customer.name}`,
      topic: "coverage_change",
      createdById: agent.id,
    });
    const newest = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `Coverage change — ${customer.name}`,
      topic: "coverage_change",
      createdById: agent.id,
    });

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: customer.name,
      address: "901 Test Street, Northville, MI 48167",
      lineOfBusiness: "personal",
    });

    expect(api.tasks.get(newest.id)).toMatchObject({
      status: "in_progress",
      quoteSessionId: session.id,
    });
    expect(api.tasks.get(older.id)?.status).toBe("open");
    expect(api.tasks.get(older.id)?.quoteSessionId).toBeUndefined();
  });

  it("voids the prior quote flow when a clean replacement is explicitly started", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const firstActivity = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `${customer.name} requested an auto quote`,
      createdById: agent.id,
    });
    const secondActivity = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `${customer.name} requested a home quote`,
      createdById: agent.id,
    });
    const baseInput = {
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      contactName: customer.name,
      lineOfBusiness: "personal" as const,
      forceNew: true,
    };

    const firstSession = await api.quoting.startSession({
      ...baseInput,
      assetType: "luxury_vehicle",
      activityTaskIds: [firstActivity.id],
      activityActorId: agent.id,
    });
    const secondSession = await api.quoting.startSession({
      ...baseInput,
      assetType: "coastal_home",
      address: "903 Test Street, Northville, MI 48167",
      activityTaskIds: [secondActivity.id],
      activityActorId: agent.id,
    });

    expect(firstSession.id).not.toBe(secondSession.id);
    expect(api.quoting.get(firstSession.id)).toMatchObject({
      status: "voided",
      supersededBySessionId: secondSession.id,
    });
    expect(api.quoting.get(secondSession.id)?.status).not.toBe("voided");
    expect(api.tasks.get(secondActivity.id)).toMatchObject({
      status: "in_progress",
      quoteSessionId: secondSession.id,
    });
  });

  it("does not borrow another activity when a separate quote flow is added from the client card", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const existingActivity = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `${customer.name} requested a quote`,
      createdById: agent.id,
    });

    await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: customer.name,
      address: "904 Test Street, Northville, MI 48167",
      lineOfBusiness: "personal",
      forceNew: true,
    });

    expect(api.tasks.get(existingActivity.id)).toMatchObject({
      status: "open",
    });
    expect(api.tasks.get(existingActivity.id)?.quoteSessionId).toBeUndefined();
  });

  it("repairs an existing ranking-ready flow without resolving the underlying client activity", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const user = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "quote-sync@example.com",
      name: "Quote Sync Client",
    });
    const customer = api.customers.create({
      tenantId: agency.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      marketingOptInEmail: false,
      marketingOptInSms: false,
      assignedAgentId: agent.id,
    });
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: customer.name,
      address: "902 Test Street, Northville, MI 48167",
      lineOfBusiness: "personal",
    });
    db.update("quotingSessions", session.id, { status: "complete" });
    const activity = api.tasks.create({
      tenantId: agency.id,
      customerId: customer.id,
      assignedToId: agent.id,
      title: `Coverage change — ${customer.name}`,
      topic: "coverage_change",
      createdById: agent.id,
    });

    expect(api.quoting.reconcileActivities(agency.id, agent.id)).toBe(1);
    expect(api.tasks.get(activity.id)).toMatchObject({
      status: "in_progress",
      quoteSessionId: session.id,
    });
    expect(api.tasks.get(activity.id)?.completedAt).toBeFalsy();
    expect(api.quoting.reconcileActivities(agency.id, agent.id)).toBe(0);
  });
});
