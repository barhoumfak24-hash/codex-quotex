import { describe, expect, it } from "vitest";
import { pickAutomaticMailboxConnection } from "./MailboxInboxSyncAgent";
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
