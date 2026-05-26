// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Per-user thread mutes (the new ⋯ message-settings menu).
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("messageMutes", () => {
  it("mute / unmute / toggle / isMuted round-trip", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const u = api.users.list(agency.id)[0];
    const args = { tenantId: agency.id, userId: u.id, kind: "client" as const, refId: customer.id };

    expect(api.messageMutes.isMuted(agency.id, u.id, "client", customer.id)).toBeFalsy();
    api.messageMutes.mute(args);
    expect(api.messageMutes.isMuted(agency.id, u.id, "client", customer.id)).toBeTruthy();
    // Idempotent.
    api.messageMutes.mute(args);
    expect(
      api.agencies.list().length >= 1 &&
        api.messageMutes.isMuted(agency.id, u.id, "client", customer.id)
    ).toBeTruthy();
    api.messageMutes.toggle(args);
    expect(api.messageMutes.isMuted(agency.id, u.id, "client", customer.id)).toBeFalsy();
    api.messageMutes.toggle(args);
    expect(api.messageMutes.isMuted(agency.id, u.id, "client", customer.id)).toBeTruthy();
  });

  it("a muted internal thread drops out of the unread count", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [a, b] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const recipient = b ?? a;
    const thread = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, recipient.id],
      createdById: a.id,
    });
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "ping",
    });
    const before = api.internalMessages.unreadCountForUser(agency.id, recipient.id);
    expect(before).toBeGreaterThan(0);
    api.messageMutes.mute({
      tenantId: agency.id,
      userId: recipient.id,
      kind: "internal",
      refId: thread.id,
    });
    expect(api.internalMessages.unreadCountForUser(agency.id, recipient.id)).toBe(before - 1);
  });
});

describe("thread settings actions", () => {
  it("deleteThread removes the internal thread + its messages", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const a = api.users.list(agency.id)[0];
    const thread = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id],
      createdById: a.id,
    });
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "hi",
    });
    api.internalMessages.deleteThread(thread.id);
    expect(db.list("internalThreads").some((t) => t.id === thread.id)).toBe(false);
    expect(db.list("internalMessages").some((m) => m.threadId === thread.id)).toBe(false);
  });

  it("deleteForContact wipes a client's communications + marketing messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      body: "hello",
    });
    expect(api.communications.listByCustomer(customer.id).length).toBeGreaterThan(0);
    api.communications.deleteForContact({ customerId: customer.id });
    api.marketing.deleteForContact({ customerId: customer.id });
    expect(api.communications.listByCustomer(customer.id).length).toBe(0);
    expect(
      api.marketing.listMessages(agency.id).filter((m) => m.customerId === customer.id).length
    ).toBe(0);
  });

  it("markContactRead resolves a client's unread inbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const u = api.users.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "question",
    });
    expect(api.communications.listPendingForCustomer(customer.id).length).toBeGreaterThan(0);
    api.communications.markContactRead({ customerId: customer.id }, u.id);
    expect(api.communications.listPendingForCustomer(customer.id).length).toBe(0);
  });
});