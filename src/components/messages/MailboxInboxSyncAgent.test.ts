import { describe, expect, it } from "vitest";
import {
  ACTIVE_MAILBOX_SYNC_INTERVAL_MS,
  claimMailboxSyncLease,
  mailboxSyncRetryDelay,
  pickAutomaticMailboxConnection,
  releaseMailboxSyncLease,
} from "./MailboxInboxSyncAgent";
import type { ConnectedMailbox } from "@/types";

function mailbox(overrides: Partial<ConnectedMailbox> = {}): ConnectedMailbox {
  return {
    id: "mailbox-1",
    tenantId: "tenant-1",
    ownerType: "staff",
    userId: "user-1",
    address: "agent@example.com",
    provider: "gmail",
    status: "connected",
    authMode: "oauth",
    scopes: ["send", "read", "sync"],
    updatedAt: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

describe("automatic mailbox selection", () => {
  it("selects only the current staff user's connected mailbox", () => {
    const selected = pickAutomaticMailboxConnection(
      [
        mailbox({ id: "other-user", userId: "user-2" }),
        mailbox({ id: "marketing", ownerType: "agency_marketing" }),
        mailbox({ id: "needs-auth", status: "needs_auth" }),
        mailbox({ id: "current-user" }),
      ],
      "user-1"
    );

    expect(selected?.id).toBe("current-user");
  });

  it("does not cross into another user's mailbox", () => {
    expect(
      pickAutomaticMailboxConnection([mailbox({ userId: "user-2" })], "user-1")
    ).toBeUndefined();
    expect(
      pickAutomaticMailboxConnection([mailbox({ userId: undefined })], "user-1")
    ).toBeUndefined();
  });
});

describe("automatic mailbox synchronization", () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
  }

  it("lets only one browser tab lead a mailbox cycle until its lease expires", () => {
    const store = storage();
    expect(
      claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-a", now: 1_000 })
    ).toBe(true);
    expect(
      claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-b", now: 2_000 })
    ).toBe(false);
    expect(
      claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-b", now: 14_000 })
    ).toBe(true);
  });

  it("releases only the lease owned by the current browser tab", () => {
    const store = storage();
    claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-a", now: 1_000 });
    releaseMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-b" });
    expect(
      claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-b", now: 2_000 })
    ).toBe(false);
    releaseMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-a" });
    expect(
      claimMailboxSyncLease({ storage: store, key: "tenant:user", ownerId: "tab-b", now: 2_000 })
    ).toBe(true);
  });

  it("checks quickly when healthy and backs off after provider failures", () => {
    expect(mailboxSyncRetryDelay(0)).toBe(ACTIVE_MAILBOX_SYNC_INTERVAL_MS);
    expect(mailboxSyncRetryDelay(1)).toBe(10_000);
    expect(mailboxSyncRetryDelay(2)).toBe(30_000);
    expect(mailboxSyncRetryDelay(10)).toBe(60_000);
  });
});
