// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Express-quote follow-up activity. Customer submits the abbreviated
// quote form → AI runs, prospect record is created → an Activity
// Center task lands in the agent's queue with aiReplyBody already
// containing a pre-drafted questionnaire. When the agent sends the
// reply, the task auto-resolves so they don't have to click Mark
// resolved separately.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("tasks.createExpressQuoteFollowUp + logReply auto-resolve", () => {
  it("creates a task with aiReplyBody pre-filled and the expressQuoteFollowUp flag", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.createExpressQuoteFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      title: "Express quote — Jane Doe: Coastal Home",
      aiReplyBody: "Hi Jane,\n\n1. Year built\n2. Roof age\n…",
      aiReplySubject: "A few questions to finalize your quote",
      assignedToId: agent.id,
    });
    expect(task.expressQuoteFollowUp).toBe(true);
    expect(task.aiReplyBody).toMatch(/Year built/);
    expect(task.aiReplySubject).toMatch(/finalize/i);
    expect(task.assignedToId).toBe(agent.id);
  });

  it("logReply auto-resolves the express-quote follow-up task", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.createExpressQuoteFollowUp({
      tenantId: agency.id,
      customerId: customer.id,
      title: "Express quote",
      aiReplyBody: "Q…",
      aiReplySubject: "Q",
      assignedToId: agent.id,
    });
    api.tasks.logReply(task.id, agent.id);
    const reloaded = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === task.id)!;
    expect(reloaded.status).toBe("resolved");
    expect(reloaded.completedAt).toBeTruthy();
    expect(reloaded.completedById).toBe(agent.id);
  });

  it("logReply on a non-express task does NOT auto-resolve", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Normal task",
    });
    api.tasks.logReply(task.id, agent.id);
    const reloaded = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.id === task.id)!;
    expect(reloaded.status).not.toBe("resolved");
    expect(reloaded.completedAt).toBeFalsy();
  });
});