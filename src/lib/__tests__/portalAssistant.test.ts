// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askPortalAssistant,
  askPortalAssistantSmart,
  assistantStarters,
  executePortalAssistantAction,
  listAssistantTopics,
  parseAssistantLLMResponse,
} from "../portalAssistant";

// =====================================================================
// Portal assistant matcher. Keyword-scored FAQ + live data lookups.
// Verify the obvious how-to questions route correctly, manager-only
// topics flag for agents, unknown questions fall back to a menu, and
// "how many X does <client> have?" answers from the live record set.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("askPortalAssistant", () => {
  it("answers Activity Center questions", () => {
    const a = askPortalAssistant("what is the activity center?");
    expect(a.topicId).toBe("activity-center");
    expect(a.text.toLowerCase()).toContain("activity center");
  });

  it("routes resolve closeout phrasing to the resolve answer", () => {
    const a = askPortalAssistant("why can't I mark this resolved");
    expect(a.topicId).toBe("resolve-gate");
  });

  it("answers reminder + recurrence questions", () => {
    expect(askPortalAssistant("how do I set a recurring reminder").topicId).toBe(
      "reminders"
    );
    expect(askPortalAssistant("how do company reminders work").topicId).toBe(
      "company-reminders"
    );
  });

  it("answers prospect conversion questions", () => {
    expect(
      askPortalAssistant("how do I convert a prospect to a client").topicId
    ).toBe("convert-prospect");
  });

  it("prepends a heads-up caveat on manager-only topics for agents", () => {
    const asAgent = askPortalAssistant("how do I set performance goals", "agent");
    expect(asAgent.topicId).toBe("analytics-goals");
    expect(asAgent.text).toContain("Heads up");
    const asManager = askPortalAssistant("how do I set performance goals", "manager");
    expect(asManager.text).not.toContain("Heads up");
  });

  it("returns a topic menu for greetings", () => {
    const a = askPortalAssistant("hi");
    expect(a.topicId).toBeUndefined();
    expect((a.related ?? []).length).toBeGreaterThan(0);
  });

  it("falls back to a menu for unknown questions", () => {
    const a = askPortalAssistant("what's the weather in Miami");
    expect(a.topicId).toBeUndefined();
    expect((a.related ?? []).length).toBeGreaterThan(0);
  });

  it("exposes starters + the full topic list", () => {
    expect(assistantStarters().length).toBeGreaterThan(0);
    expect(listAssistantTopics().length).toBeGreaterThan(5);
  });

  it("links manager workflow questions to the exact training chapter", () => {
    const a = askPortalAssistant(
      "how do I reassign an activity to multiple users",
      "manager"
    );
    const links = [a.action, ...(a.actions ?? [])].map((action) => action?.to);
    expect(a.text).toContain("Training video:");
    expect(links).toContain(
      "/employee/training?video=manager-activity-routing&chapter=multi-user-reassignment&section=multi-user-reassignment&autoplay=1"
    );
  });

  it("links agent document-send questions to the exact training chapter", () => {
    const a = askPortalAssistant("how do I send selected PDFs to holders", "agent");
    const links = [a.action, ...(a.actions ?? [])].map((action) => action?.to);
    expect(a.text).toContain("Training video:");
    expect(links).toContain(
      "/employee/training?video=agent-messages-documents-esign&chapter=send-selected-pdfs&section=send-selected-pdfs&autoplay=1"
    );
  });

  it("can answer directly from training videos when no KB topic is stronger", () => {
    const a = askPortalAssistant(
      "how do I complete a calendar event without deleting it",
      "agent"
    );
    expect(a.topicId).toBe("video-agent-calendar-activities-complete-or-reschedule");
    expect(a.action?.to).toBe(
      "/employee/training?video=agent-calendar-activities&chapter=complete-or-reschedule&section=complete-or-reschedule&autoplay=1"
    );
  });

  it("answers 'how many assets does <client> have' from live data", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const expected = api.assets.listByCustomer(customer.id).length;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    const a = askPortalAssistant(
      `how many assets does ${customer.name} have`,
      "manager",
      ctx
    );
    expect(a.topicId).toBe("data-assets");
    expect(a.text).toContain(customer.name);
    expect(a.text).toContain(String(expected));
    // It also includes the how-to so the answer is actionable.
    expect(a.text.toLowerCase()).toContain("assets card");
    if (expected === 1) {
      expect(a.action?.to).toContain(`/employee/clients/${customer.id}/assets/`);
    } else {
      expect(a.action).toEqual({ label: "View assets", to: `/employee/clients/${customer.id}` });
    }
  });

  it("answers policy + claim counts for a known client", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customers = api.customers.list(agency.id);
    const policyCustomer =
      customers.find((c) => api.policies.listByCustomer(c.id).length > 0) ?? customers[0];
    const claimCustomer =
      customers.find((c) => api.claims.listByCustomer(c.id).length > 0) ?? customers[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    const pol = askPortalAssistant(
      `how many policies does ${policyCustomer.name} have`,
      "manager",
      ctx
    );
    expect(pol.topicId).toBe("data-policies");
    expect(pol.text).toContain(
      String(api.policies.listByCustomer(policyCustomer.id).length)
    );
    expect(pol.action?.label).toBe("View policy");
    expect(pol.action?.to).toMatch(/^\/employee\/policies\//);
    const clm = askPortalAssistant(
      `how many claims does ${claimCustomer.name} have`,
      "manager",
      ctx
    );
    expect(clm.topicId).toBe("data-claims");
    expect(clm.text).toContain(String(api.claims.listByCustomer(claimCustomer.id).length));
    if (api.claims.listByCustomer(claimCustomer.id).length > 0) {
      expect(clm.action?.label).toBe("View claim");
      expect(clm.action?.to).toMatch(/^\/employee\/claims\?claim=/);
    }
  });

  it("gives a deep profile when a known client is named without a metric", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    const a = askPortalAssistant(`tell me about ${customer.name}`, "manager", ctx);
    expect(a.topicId).toBe("data-profile");
    expect(a.text).toContain(customer.name);
    expect(a.text.toLowerCase()).toContain("premium under management");
    expect(a.action).toEqual({ label: "View client", to: `/employee/clients/${customer.id}` });
  });

  it("answers from the current client page instead of generic help", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
      currentPath: `/employee/clients/${customer.id}`,
    };

    const a = askPortalAssistant("what should I do here?", "manager", ctx);

    expect(a.topicId).toBe("current-client");
    expect(a.text).toContain(customer.name);
    expect(a.text).toContain("AI quoting");
    expect((a.actions ?? []).map((action) => action.to)).toContain(
      `/employee/clients/${customer.id}#ai-quoting-workspace`
    );
  });

  it("summarizes the current policy page with linked actions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const policy = api.policies.listByTenant(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
      currentPath: `/employee/policies/${policy.id}`,
    };

    const a = askPortalAssistant("summarize this page", "manager", ctx);

    expect(a.topicId).toBe("current-policy");
    expect(a.text).toContain(policy.policyNumber ?? policy.id);
    expect((a.actions ?? []).map((action) => action.to)).toContain(
      `/employee/clients/${policy.customerId}`
    );
  });

  it("gives an operational dashboard snapshot for current-page questions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
      currentPath: "/employee",
    };

    const a = askPortalAssistant("what should I do next?", "manager", ctx);

    expect(a.topicId).toBe("current-dashboard");
    expect(a.text).toContain("Open activities");
    expect((a.actions ?? []).map((action) => action.to)).toContain("/employee/tasks");
  });

  it("answers premium, agent, contact, and renewal-date questions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    expect(
      askPortalAssistant(`what is ${customer.name}'s total premium`, "manager", ctx).topicId
    ).toBe("data-premium");
    expect(
      askPortalAssistant(`who is ${customer.name}'s agent`, "manager", ctx).topicId
    ).toBe("data-agent");
    expect(
      askPortalAssistant(`what is ${customer.name}'s email`, "manager", ctx).topicId
    ).toBe("data-contact");
    expect(
      askPortalAssistant(`when does ${customer.name} renew`, "manager", ctx).topicId
    ).toMatch(/data-renewalDate/);
  });

  it("answers agency-wide aggregate questions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    expect(askPortalAssistant("how many clients does the agency have", "manager", ctx).topicId).toBe(
      "agg-clients"
    );
    expect(
      askPortalAssistant("what is the total premium under management", "manager", ctx).topicId
    ).toBe("agg-premium");
    expect(askPortalAssistant("how many open activities are there", "manager", ctx).topicId).toBe(
      "agg-activities"
    );
  });

  it("lets managers ask about a specific agent's performance", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };

    const a = askPortalAssistant(`how is ${agent.name} performing`, "manager", ctx);

    expect(a.topicId).toBe("data-agent-stats");
    expect(a.text).toContain(agent.name);
    expect(a.text).toContain("Premium under management");
    expect(a.text).toContain("Assigned clients");
    expect(a.action).toEqual({
      label: `View ${agent.name} performance`,
      to: `/employee/analytics?agent=${encodeURIComponent(agent.id)}`,
    });
  });

  it("ranks agents for manager leaderboard questions and links to the top drill-down", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };

    const a = askPortalAssistant("which agent has the most premium under management", "manager", ctx);

    expect(a.topicId).toBe("data-agent-leaderboard");
    expect(a.text).toContain("Premium under management leaderboard");
    expect(a.action?.label).toMatch(/^View .+ performance$/);
    expect(a.action?.to).toMatch(/^\/employee\/analytics\?agent=/);
  });

  it("does not expose staff performance drill-downs to agents", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const viewer = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const other = api.users
      .list(agency.id)
      .find((u) => (u.role === "agent" || u.role === "manager") && u.id !== viewer.id)!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: viewer.id, role: "agent" as const },
    };

    const a = askPortalAssistant(`how is ${other.name} performing`, "agent", ctx);

    expect(a.topicId).not.toBe("data-agent-stats");
    expect(a.action?.to ?? "").not.toContain("/employee/analytics?agent=");
  });

  it("does not let a how-to question with a stray name token hijack data lookup", async () => {
    // "how do I mark an activity resolved" should answer the resolve
    // how-to even if a client happens to share a name token, because
    // there's no data intent + only a weak match.
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    const a = askPortalAssistant("how do I mark an activity resolved", "manager", ctx);
    expect(a.topicId).toBe("resolve-gate");
  });

  it("without context, data questions fall back to the how-to KB", () => {
    // No ctx → can't look up records, but the metric keyword still
    // routes to the relevant how-to instead of erroring.
    const a = askPortalAssistant("where do I see asset details");
    expect(a.topicId).toBe("asset-details");
  });
});

describe("askPortalAssistant — conversation continuity", () => {
  it("'tell me more' walks into a related entry from the previous topic", () => {
    const first = askPortalAssistant("how does the routing card work");
    expect(first.topicId).toBe("routing-card");
    const history = [
      { from: "user" as const, text: "how does the routing card work" },
      {
        from: "assistant" as const,
        text: first.text,
        topicId: first.topicId,
      },
    ];
    const second = askPortalAssistant("tell me more", "manager", undefined, history);
    // Walks into a related entry the user hasn't seen yet.
    expect(second.topicId).toBeTruthy();
    expect(second.topicId).not.toBe("routing-card");
    expect(second.text).toMatch(/Going deeper/);
  });

  it("pronoun follow-up stays anchored on the previous topic", () => {
    const first = askPortalAssistant("how do I expand a message card to full screen");
    expect(first.topicId).toBe("expand-message-card");
    const history = [
      { from: "user" as const, text: "how do I expand a message card to full screen" },
      {
        from: "assistant" as const,
        text: first.text,
        topicId: first.topicId,
      },
    ];
    const second = askPortalAssistant("where is it?", "agent", undefined, history);
    // Short pronoun question after a known topic re-anchors there.
    expect(second.topicId).toBe("expand-message-card");
  });

  it("a brand-new question still switches topics cleanly", () => {
    const first = askPortalAssistant("how do I expand a message card to full screen");
    const history = [
      { from: "user" as const, text: "how do I expand a message card to full screen" },
      {
        from: "assistant" as const,
        text: first.text,
        topicId: first.topicId,
      },
    ];
    const second = askPortalAssistant(
      "how do I renew a policy's documents",
      "agent",
      undefined,
      history
    );
    expect(second.topicId).toBe("renew-documents-policy");
  });
});

describe("askPortalAssistant — niche feature coverage", () => {
  it("answers the new-send-modal question", () => {
    const a = askPortalAssistant("how do I start a new conversation in messages");
    expect(a.topicId).toBe("new-send-modal");
  });
  it("answers the ⋯ message settings menu question", () => {
    const a = askPortalAssistant("how do I mute a conversation");
    expect(a.topicId).toBe("message-settings-menu");
  });
  it("answers the AI inbound triage question", () => {
    const a = askPortalAssistant("how does ai auto create activity from messages");
    expect(a.topicId).toBe("ai-inbound-triage");
  });
  it("answers the Renew documents question", () => {
    const a = askPortalAssistant("how do I renew documents");
    expect(a.topicId).toBe("renew-documents-policy");
  });
  it("answers the Preview filled template question", () => {
    const a = askPortalAssistant("how do I preview a filled template");
    expect(a.topicId).toBe("preview-filled-template");
  });
  it("answers the download client information question", () => {
    const a = askPortalAssistant("how do I download client information");
    expect(a.topicId).toBe("download-dossier");
  });
});

describe("askPortalAssistant actionable confirmations", () => {
  it("turns portal navigation commands into confirmation-gated actions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant("take me to the activity center", "manager", ctx);

    expect(answer.pendingAction?.kind).toBe("navigate");
    expect(answer.pendingAction?.confirmation).toMatch(/activity center/i);
    expect(answer.text).not.toContain("Training video:");
    expect((answer.actions ?? []).some((action) => action.label.startsWith("Watch:"))).toBe(false);
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.success).toBe(true);
    expect(result.action?.to).toBe("/employee/tasks");
  });

  it("keeps how-to phrasing in training mode instead of converting it to an app action", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant(
      "can you show me how to reassign an activity to multiple users",
      "manager",
      ctx
    );

    expect(answer.pendingAction).toBeUndefined();
    expect(answer.text).toContain("Training video:");
    expect([answer.action, ...(answer.actions ?? [])].some((action) => action?.label.startsWith("Watch:"))).toBe(true);
  });

  it("keeps direct app commands in action mode instead of answering with training", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
      currentPath: `/employee/clients/${customer.id}`,
    };

    const answer = askPortalAssistant("send selected PDFs to holders", "manager", ctx);

    expect(answer.topicId).toBe("action-proposal");
    expect(answer.pendingAction?.kind).toBe("navigate");
    expect(answer.text).not.toContain("Training video:");
    if (answer.pendingAction?.kind !== "navigate") throw new Error("Expected navigation action");
    expect(answer.pendingAction.to).toBe(`/employee/clients/${customer.id}#documents`);
  });

  it("starts an activity only through the confirmed action executor", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Assistant actionable test",
      assignedToId: manager.id,
      createdById: manager.id,
    });
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
      currentPath: `/employee/tasks?focus=${task.id}`,
    };

    const answer = askPortalAssistant("start this activity", "manager", ctx);

    expect(api.tasks.statusOf(task)).toBe("open");
    expect(answer.pendingAction?.kind).toBe("task.markInProgress");
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.success).toBe(true);
    expect(api.tasks.statusOf(api.tasks.get(task.id)!)).toBe("in_progress");
  });

  it("opens the exact billing record for a named client after confirmation", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const policy = api.policies.listByCustomer(customer.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant(`open ${customer.name} billing`, "manager", ctx);

    expect(answer.pendingAction?.kind).toBe("navigate");
    if (answer.pendingAction?.kind !== "navigate") throw new Error("Expected navigation action");
    expect(answer.pendingAction.to).toBe(`/employee/billing/${policy.id}`);
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.action?.to).toBe(`/employee/billing/${policy.id}`);
  });

  it("creates a timestamped client remark only after confirmation", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
      currentPath: `/employee/clients/${customer.id}`,
    };

    const before = api.notes.listByCustomer(customer.id).length;
    const answer = askPortalAssistant(
      "add a note that client called about the renewal packet",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("note.create");
    expect(api.notes.listByCustomer(customer.id)).toHaveLength(before);
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.success).toBe(true);
    const notes = api.notes.listByCustomer(customer.id);
    expect(notes).toHaveLength(before + 1);
    expect(notes[notes.length - 1].body.toLowerCase()).toContain("client called about the renewal packet");
  });

  it("creates a client activity with a due date only after confirmation", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
      currentPath: `/employee/clients/${customer.id}`,
    };

    const answer = askPortalAssistant(
      "create activity for this client to call about renewal tomorrow",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("task.create");
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.success).toBe(true);
    expect(result.action?.to).toMatch(/^\/employee\/tasks\?focus=/);
    const taskId = decodeURIComponent(result.action!.to.split("focus=")[1]);
    const task = api.tasks.get(taskId)!;
    expect(task.customerId).toBe(customer.id);
    expect(task.dueAt).toBeTruthy();
  });

  it("creates a personal calendar event through the confirmed executor", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };
    const before = api.calendarEvents.listForUser(agency.id, manager.id).length;

    const answer = askPortalAssistant("schedule renewal review tomorrow", "manager", ctx);

    expect(answer.pendingAction?.kind).toBe("calendar.create");
    const result = executePortalAssistantAction(answer.pendingAction!, ctx);
    expect(result.success).toBe(true);
    expect(api.calendarEvents.listForUser(agency.id, manager.id)).toHaveLength(before + 1);
  });

  it("creates a personal reminder with an exact parsed time only after confirmation", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };
    const before = api.reminders.listForUser(agency.id, manager.id).length;

    const answer = askPortalAssistant(
      "remind me to call Chubb tomorrow at 3pm",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("reminder.create");
    if (answer.pendingAction?.kind !== "reminder.create") {
      throw new Error("Expected reminder action");
    }
    expect(answer.pendingAction.title).toMatch(/^3 PM call Chubb - /);
    expect(answer.pendingAction.confirmation).toContain("3 PM call Chubb");
    const result = executePortalAssistantAction(answer.pendingAction, ctx);
    expect(result.success).toBe(true);
    expect(result.action?.to).toBe("/employee/calendar");
    const reminders = api.reminders.listForUser(agency.id, manager.id);
    expect(reminders).toHaveLength(before + 1);
    expect(reminders.some((reminder) => /^3 PM call Chubb - /.test(reminder.title ?? ""))).toBe(true);
  });

  it("asks for an exact reminder time instead of guessing", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant("remind me to call Chubb tomorrow", "manager", ctx);

    expect(answer.pendingAction).toBeUndefined();
    expect(answer.text.toLowerCase()).toContain("exact time");
  });

  it("asks for reminder subject when only a time is provided", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant("set a reminder tomorrow at 3pm", "manager", ctx);

    expect(answer.pendingAction).toBeUndefined();
    expect(answer.text.toLowerCase()).toContain("what you want");
  });

  it("creates company reminders as recipient reminder rows, not calendar-only events", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const staff = api.users
      .list(agency.id)
      .filter((u) => ["agent", "manager", "csr"].includes(u.role) && u.active !== false);
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };
    const beforeByUser = new Map(
      staff.map((u) => [u.id, api.reminders.listForUser(agency.id, u.id).length])
    );

    const answer = askPortalAssistant(
      "create a company reminder to review renewal pipeline tomorrow at 3pm",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("reminder.createCompany");
    if (answer.pendingAction?.kind !== "reminder.createCompany") {
      throw new Error("Expected company reminder action");
    }
    expect(answer.pendingAction.recipientIds).toHaveLength(staff.length);
    expect(answer.pendingAction.title).toMatch(/^3 PM review renewal pipeline - /);
    const result = executePortalAssistantAction(answer.pendingAction, ctx);
    expect(result.success).toBe(true);
    expect(result.action?.to).toBe("/employee");
    for (const user of staff) {
      const reminders = api.reminders.listForUser(agency.id, user.id);
      expect(reminders).toHaveLength((beforeByUser.get(user.id) ?? 0) + 1);
      expect(
        reminders.some(
          (reminder) =>
            /^3 PM review renewal pipeline - /.test(reminder.title ?? "") &&
            reminder.scope === "company"
        )
      ).toBe(true);
    }
  });

  it("uses audience phrases only for routing and keeps company reminder titles clean", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant(
      "create a reminder for personal lines only regarding sales meeting tomorrow at 11am",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("reminder.createCompany");
    if (answer.pendingAction?.kind !== "reminder.createCompany") {
      throw new Error("Expected company reminder action");
    }
    expect(answer.pendingAction.title).toMatch(/^11 AM sales meeting - /);
    expect(answer.pendingAction.title.toLowerCase()).not.toContain("personal lines");
    const recipients = answer.pendingAction.recipientIds.map((id) => api.users.get(id)!);
    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.every((user) => user.role !== "manager")).toBe(true);
    expect(recipients.every((user) => user.lineOfBusiness === "personal")).toBe(true);
  });

  it("treats company reminder calendar phrasing as a company reminder", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: manager.role },
    };

    const answer = askPortalAssistant(
      "add a company reminder tomorrow at 4pm to review carrier follow ups on the calendar",
      "manager",
      ctx
    );

    expect(answer.pendingAction?.kind).toBe("reminder.createCompany");
    if (answer.pendingAction?.kind !== "reminder.createCompany") {
      throw new Error("Expected company reminder action");
    }
    expect(answer.pendingAction.title).toMatch(/^4 PM review carrier follow ups - /);
  });
});

describe("askPortalAssistantSmart", () => {
  it("parses fenced JSON model answers", () => {
    const parsed = parseAssistantLLMResponse(
      '```json\n{"text":"Open Activity Center, move the card to In progress, then resolve it.","related":["How do I mark an activity resolved?"]}\n```'
    );
    expect(parsed.text).toContain("Activity Center");
    expect(parsed.related).toEqual(["How do I mark an activity resolved?"]);
  });

  it("uses AI synthesis when the model is available", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          text: "Open the Activity Center, choose the activity, mark it in progress, then resolve it. Add a resolution note so context lands on the client timeline.",
          related: ["How do I mark an activity resolved?"],
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const a = await askPortalAssistantSmart(
      "walk me through how to resolve an activity step by step",
      "manager"
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(a.topicId).toBe("resolve-gate");
    expect(a.text).toContain("resolution note");
    expect(a.related).toContain("How do I mark an activity resolved?");
  });

  it("reports temporary AI unavailability when the model fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    const smart = await askPortalAssistantSmart("what is the activity center?", "agent");
    expect(smart.topicId).toBe("ai-unavailable");
    expect(smart.text).toContain("temporarily unavailable");
  });

  it("does not silently use local synthesis when production AI is unavailable", async () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 503 })));

    const smart = await askPortalAssistantSmart("what is the activity center?", "agent");

    expect(smart.topicId).toBe("ai-unavailable");
    expect(smart.text).toContain("temporarily unavailable");
  });

  it("combines closely related local topics for workflow-style prompts", () => {
    const a = askPortalAssistant(
      "walk me through the activity center and reminders step by step",
      "manager"
    );
    expect(a.text).toContain("1.");
    expect(a.text).toContain("Activity Center");
    expect(a.text).toContain("reminder");
  });
});
