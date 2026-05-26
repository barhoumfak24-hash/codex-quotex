// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askPortalAssistant,
  assistantStarters,
  listAssistantTopics,
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
});

describe("askPortalAssistant", () => {
  it("answers Activity Center questions", () => {
    const a = askPortalAssistant("what is the activity center?");
    expect(a.topicId).toBe("activity-center");
    expect(a.text.toLowerCase()).toContain("activity center");
  });

  it("routes resolve-gate phrasing to the resolve answer", () => {
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
  });

  it("answers policy + claim counts for a known client", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const customer = api.customers.list(agency.id)[0];
    const ctx = {
      tenantId: agency.id,
      viewer: { id: manager.id, role: "manager" as const },
    };
    const pol = askPortalAssistant(
      `how many policies does ${customer.name} have`,
      "manager",
      ctx
    );
    expect(pol.topicId).toBe("data-policies");
    expect(pol.text).toContain(
      String(api.policies.listByCustomer(customer.id).length)
    );
    const clm = askPortalAssistant(
      `how many claims does ${customer.name} have`,
      "manager",
      ctx
    );
    expect(clm.topicId).toBe("data-claims");
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