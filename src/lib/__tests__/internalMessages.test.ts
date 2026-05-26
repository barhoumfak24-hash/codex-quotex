// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Internal staff messaging. 1:1 + group threads, read receipts,
// urgency-tagged messages. Powers the Activity Center → Messages
// page and the dashboard "Internal messages" notification card.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("internalMessages namespace", () => {
  it("openThread is idempotent — same participant set returns the same thread", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [a, b] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const t1 = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id],
      createdById: a.id,
    });
    const t2 = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [b.id, a.id],
      createdById: b.id,
    });
    expect(t1.id).toBe(t2.id);
  });

  it("send appends a message and bumps lastMessageAt on the thread", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [a, b] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const thread = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id],
      createdById: a.id,
    });
    const before = thread.lastMessageAt;
    await new Promise((r) => setTimeout(r, 5));
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "hey",
      urgency: "urgent",
    });
    const msgs = api.internalMessages.listMessages(thread.id);
    expect(msgs.length).toBe(1);
    expect(msgs[0].urgency).toBe("urgent");
    const reloaded = api.internalMessages
      .listThreadsForUser(agency.id, a.id)
      .find((t) => t.id === thread.id)!;
    expect(reloaded.lastMessageAt > before).toBe(true);
  });

  it("unreadCountForUser excludes the sender's own messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [a, b] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const thread = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id],
      createdById: a.id,
    });
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "hello b",
    });
    expect(api.internalMessages.unreadCountForUser(agency.id, a.id)).toBe(0);
    expect(api.internalMessages.unreadCountForUser(agency.id, b.id)).toBe(1);
    api.internalMessages.markRead(thread.id, b.id);
    expect(api.internalMessages.unreadCountForUser(agency.id, b.id)).toBe(0);
  });

  it("unreadThreadsForUser surfaces the latest unread message per thread", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const [a, b] = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    const thread = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id],
      createdById: a.id,
    });
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "first",
    });
    api.internalMessages.send({
      threadId: thread.id,
      tenantId: agency.id,
      fromUserId: a.id,
      body: "second",
    });
    const out = api.internalMessages.unreadThreadsForUser(agency.id, b.id);
    expect(out.length).toBe(1);
    expect(out[0].thread.id).toBe(thread.id);
    expect(out[0].latest.body).toBe("second");
  });

  it("group threads with 3+ participants stay distinct from sub-set DMs", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const users = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager");
    if (users.length < 2) return; // skip if seed has only 1
    const [a, b] = users;
    const dm = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id],
      createdById: a.id,
    });
    // Manufacture a third participant id so we can build a group.
    const group = api.internalMessages.openThread({
      tenantId: agency.id,
      participantIds: [a.id, b.id, "user_phantom"],
      createdById: a.id,
      topic: "Renewals triage",
    });
    expect(dm.id).not.toBe(group.id);
    expect(group.topic).toBe("Renewals triage");
  });
});