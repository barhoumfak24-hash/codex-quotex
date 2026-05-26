// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Email threading + AI subject generation. Replies inherit a thread
// and a "Re:" subject; new chats start a fresh threadId. The AI
// subject helper turns a draft body into a concise subject line.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("communications threading", () => {
  it("persists threadId + replyToId + subject on an outbound email", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const root = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Your coastal home quote",
      threadId: "thread_abc",
      body: "Here is your quote.",
      createdById: api.users.list(agency.id)[0].id,
    });
    expect(root.threadId).toBe("thread_abc");
    const reply = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Re: Your coastal home quote",
      threadId: "thread_abc",
      replyToId: root.id,
      body: "Following up.",
      createdById: api.users.list(agency.id)[0].id,
    });
    expect(reply.threadId).toBe("thread_abc");
    expect(reply.replyToId).toBe(root.id);
    // Both messages share the thread.
    const inThread = api.communications
      .listByCustomer(customer.id)
      .filter((c) => c.threadId === "thread_abc");
    expect(inThread.length).toBe(2);
  });
});

describe("aiEmailSubject", () => {
  it("derives a topical subject from the body", async () => {
    const { aiEmailSubject } = await import("../ai");
    expect(await aiEmailSubject({ body: "Your policy is up for renewal next month." })).toMatch(
      /renewal/i
    );
    expect(await aiEmailSubject({ body: "We still need a few documents to upload." })).toMatch(
      /document/i
    );
    expect(await aiEmailSubject({ body: "Here is your premium quote estimate." })).toMatch(
      /quote/i
    );
  });

  it("appends the contact's first name when provided", async () => {
    const { aiEmailSubject } = await import("../ai");
    const s = await aiEmailSubject({
      body: "Your renewal is coming up.",
      contactName: "Alexandra Whitford",
    });
    expect(s).toContain("Alexandra");
  });

  it("falls back to the first words of the body when no topic matches", async () => {
    const { aiEmailSubject } = await import("../ai");
    const s = await aiEmailSubject({ body: "Just checking in to say hello there friend" });
    expect(s.length).toBeGreaterThan(0);
  });
});