import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFreshMailboxToken: vi.fn(),
  readFreshTenantStaffMailboxToken: vi.fn(),
  writeMailboxSyncCursor: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  processPersistedCarrierReplies: vi.fn(),
  supabaseStateConfigured: vi.fn(),
  readRemoteState: vi.fn(),
}));

vi.mock("../services/mailboxProvider.js", () => ({
  readFreshMailboxToken: mocks.readFreshMailboxToken,
  readFreshTenantStaffMailboxToken: mocks.readFreshTenantStaffMailboxToken,
  writeMailboxSyncCursor: mocks.writeMailboxSyncCursor,
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));

vi.mock("../services/carrierReplyProcessor.js", () => ({
  processPersistedCarrierReplies: mocks.processPersistedCarrierReplies,
}));

vi.mock("../services/supabaseState.js", () => ({
  supabaseStateConfigured: mocks.supabaseStateConfigured,
  readRemoteState: mocks.readRemoteState,
}));

import {
  listPersistedMailboxMessages,
  listMailboxDiagnostics,
  pollDueMailboxConnections,
  syncMailboxMessages,
  syncMailboxReplyMessages,
} from "../services/mailboxSync.js";

beforeEach(() => {
  mocks.readFreshMailboxToken.mockReset();
  mocks.readFreshTenantStaffMailboxToken.mockReset();
  mocks.writeMailboxSyncCursor.mockReset().mockResolvedValue(undefined);
  mocks.queryRaw.mockReset().mockResolvedValue([]);
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.processPersistedCarrierReplies.mockReset().mockResolvedValue({
    candidates: 0,
    processed: 0,
    alreadyProcessed: 0,
    unmatched: 0,
    failed: 0,
  });
  mocks.supabaseStateConfigured.mockReset().mockReturnValue(false);
  mocks.readRemoteState.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mailbox sync reliability", () => {
  it("replays persisted inbound mail only for the authenticated staff mailbox", async () => {
    await listPersistedMailboxMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      limit: 25,
    });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = mocks.queryRaw.mock.calls[0];
    expect(sqlText(query)).toContain("FROM mailbox_connections AS mailbox_connection");
    expect(sqlText(query)).toContain("mailbox_connection.user_id =");
    expect(sqlText(query)).toContain("communication.mailbox->>'origin' = 'inbound_relay'");
    expect(sqlText(query)).toContain("communication.mailbox->>'userId' =");
    expect(query).toContain("tenant-1");
    expect(query).toContain("user-1");
  });

  it("drains every Gmail history page before persisting and advancing the history cursor", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mockCustomerContacts([{ id: "customer-1", email: "client@example.com", additional_contacts: [] }]);
    let activeMessageReads = 0;
    let maxConcurrentMessageReads = 0;
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history") && !url.searchParams.has("pageToken")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "gmail-1" } }] }],
          historyId: "history-page-1",
          nextPageToken: "gmail-page-2",
        });
      }
      if (url.pathname.endsWith("/history") && url.searchParams.get("pageToken") === "gmail-page-2") {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "gmail-2" } }] }],
          historyId: "history-terminal",
        });
      }
      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (messageId) {
        activeMessageReads += 1;
        maxConcurrentMessageReads = Math.max(maxConcurrentMessageReads, activeMessageReads);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeMessageReads -= 1;
        return jsonResponse(gmailMessage(messageId));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.messages.map((message) => message.externalMessageId)).toEqual(["gmail-1", "gmail-2"]);
    expect(result.importSummary).toEqual({ imported: 2, updated: 0, deduped: 0, ignored: 0, failed: 0 });
    expect(mocks.writeMailboxSyncCursor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.any(Object),
      { gmailHistoryId: "history-terminal" }
    );
    const cursorOrder = mocks.writeMailboxSyncCursor.mock.invocationCallOrder[0];
    const persistedBeforeCursor = mocks.executeRaw.mock.calls.filter((call, index) => {
      const order = mocks.executeRaw.mock.invocationCallOrder[index] ?? Number.POSITIVE_INFINITY;
      const sql = sqlText(call);
      return order < cursorOrder && (
        sql.includes("INSERT INTO communications") || sql.includes("UPDATE communications")
      );
    });
    expect(persistedBeforeCursor).toHaveLength(2);
    expect(maxConcurrentMessageReads).toBe(1);
  });

  it("mirrors inbound email from a client address on file", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mockCustomerContacts([{
      id: "customer-known",
      name: "Known Client",
      email: "primary@example.com",
      additional_contacts: [{ email: "known.client@example.com" }],
    }]);
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "known-inbound" } }] }],
          historyId: "history-known",
        });
      }
      if (url.pathname.endsWith("/messages/known-inbound")) {
        return jsonResponse(gmailInboundReply(
          "known-inbound",
          "known-thread",
          "<known-outbound@example.com>",
          { from: "Known Client <KNOWN.CLIENT@example.com>" }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.importSummary).toMatchObject({ imported: 1, ignored: 0, failed: 0 });
    const inserts = mocks.executeRaw.mock.calls.filter((call) => sqlText(call).includes("INSERT INTO communications"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("customer-known");
  });

  it("ignores inbound email from an address that is not on file", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mocks.queryRaw.mockImplementation(async (...args: unknown[]) => {
      const query = sqlText(args);
      if (query.includes("FROM customer_profiles")) return [];
      if (query.includes("FROM communications")) {
        return [{
          id: "legacy-unknown",
          thread_id: "legacy-thread",
          message_id_header: "<unknown-inbound@example.com>",
          in_reply_to_header: "<unknown-outbound@example.com>",
          reference_headers: [],
          mailbox: { account: "agent@example.com", externalMessageId: "unknown-inbound" },
        }];
      }
      return [];
    });
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "unknown-inbound" } }] }],
          historyId: "history-unknown",
        });
      }
      if (url.pathname.endsWith("/messages/unknown-inbound")) {
        return jsonResponse(gmailInboundReply(
          "unknown-inbound",
          "unknown-thread",
          "<unknown-outbound@example.com>",
          { from: "Stranger <stranger@example.com>" }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.importSummary).toMatchObject({ imported: 0, ignored: 1, failed: 0 });
    expect(mocks.executeRaw.mock.calls.some((call) => sqlText(call).includes("INSERT INTO communications"))).toBe(false);
    expect(mocks.executeRaw.mock.calls.some((call) => sqlText(call).includes("UPDATE communications"))).toBe(false);
    expect(mocks.executeRaw.mock.calls.some((call) => call.includes("mailbox.inbound.ignored"))).toBe(true);
  });

  it("allows same-agency prospects and carrier contacts but rejects another agency's address", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mocks.supabaseStateConfigured.mockReturnValue(true);
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 1,
      snapshot: {
        prospects: [
          { id: "prospect-1", tenantId: "tenant-1", email: "prospect@example.com" },
          { id: "prospect-other", tenantId: "tenant-2", email: "other-agency@example.com" },
        ],
        carrierContacts: [
          { id: "carrier-contact-1", tenantId: "tenant-1", email: "underwriter@example.com" },
        ],
      },
    });
    const inboundById: Record<string, ReturnType<typeof gmailInboundReply>> = {
      prospect: gmailInboundReply("prospect", "thread-prospect", "<sent-prospect@example.com>", {
        from: "Prospect <prospect@example.com>",
      }),
      carrier: gmailInboundReply("carrier", "thread-carrier", "<sent-carrier@example.com>", {
        from: "Underwriter <underwriter@example.com>",
      }),
      other: gmailInboundReply("other", "thread-other", "<sent-other@example.com>", {
        from: "Other Agency <other-agency@example.com>",
      }),
    };
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: Object.keys(inboundById).map((id) => ({ message: { id } })) }],
          historyId: "history-state-contacts",
        });
      }
      const messageId = url.pathname.match(/\/messages\/([^/]+)$/)?.[1];
      if (messageId && inboundById[messageId]) return jsonResponse(inboundById[messageId]);
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.importSummary).toMatchObject({ imported: 2, ignored: 1, failed: 0 });
    const inserts = mocks.executeRaw.mock.calls.filter((call) => sqlText(call).includes("INSERT INTO communications"));
    expect(inserts).toHaveLength(2);
    expect(inserts.some((call) => call.includes("prospect-1"))).toBe(true);
    expect(inserts.some((call) => call.includes("carrier-contact-1"))).toBe(true);
    expect(inserts.some((call) => call.includes("prospect-other"))).toBe(false);
  });

  it("persists a snapshot-only client by verified email without violating the customer FK", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mocks.supabaseStateConfigured.mockReturnValue(true);
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 1,
      snapshot: {
        customers: [{
          id: "snapshot-customer-without-relational-row",
          tenantId: "tenant-1",
          name: "Snapshot Client",
          email: "snapshot.client@example.com",
        }],
      },
    });
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "snapshot-client-inbound" } }] }],
          historyId: "history-snapshot-client",
        });
      }
      if (url.pathname.endsWith("/messages/snapshot-client-inbound")) {
        return jsonResponse(gmailInboundReply(
          "snapshot-client-inbound",
          "snapshot-client-thread",
          "<snapshot-client-outbound@example.com>",
          { from: "Snapshot Client <snapshot.client@example.com>" }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.importSummary).toMatchObject({ imported: 1, ignored: 0, failed: 0 });
    const insert = mocks.executeRaw.mock.calls.find((call) => sqlText(call).includes("INSERT INTO communications"));
    expect(insert).toBeDefined();
    expect(insert).not.toContain("snapshot-customer-without-relational-row");
    expect(insert).toContain("Snapshot Client");
    expect(insert).toContain("snapshot.client@example.com");
    expect(insert).toContain("Client");
  });

  it("leaves the Gmail cursor untouched when a continuation page fails", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ history: [], historyId: "history-page-1", nextPageToken: "page-2" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "temporary failure" } }, 400));

    await expect(
      syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" })
    ).rejects.toThrow("temporary failure");
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(mocks.writeMailboxSyncCursor).not.toHaveBeenCalled();
  });

  it("retries a throttled Gmail request before completing the sync", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Too many concurrent requests for user." } }, 429))
      .mockResolvedValueOnce(jsonResponse({ history: [], historyId: "history-current" }));

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.messages).toEqual([]);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(mocks.writeMailboxSyncCursor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.any(Object),
      { gmailHistoryId: "history-current" }
    );
  });

  it("retries an interrupted provider request before completing the sync", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    fetchMock()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(jsonResponse({ history: [], historyId: "history-current" }));

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.messages).toEqual([]);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(mocks.writeMailboxSyncCursor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.any(Object),
      { gmailHistoryId: "history-current" }
    );
  });

  it("preserves the old cursor when a fetched message cannot be persisted", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mockCustomerContacts([{ id: "customer-1", email: "client@example.com", additional_contacts: [] }]);
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history")) {
        return jsonResponse({
          history: [{ messagesAdded: [{ message: { id: "gmail-failed" } }] }],
          historyId: "history-new",
        });
      }
      return jsonResponse(gmailMessage("gmail-failed"));
    });
    mocks.executeRaw
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(1);

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.importSummary.failed).toBe(1);
    expect(mocks.writeMailboxSyncCursor).not.toHaveBeenCalled();
  });

  it("follows Graph next links to the terminal delta link and saves it exactly", async () => {
    const oldDeltaLink = "https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=old";
    const nextLink = "https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=page%2F2";
    const terminalDeltaLink = "https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=next%2Bcursor";
    mocks.readFreshMailboxToken.mockResolvedValue(microsoftConnection(oldDeltaLink));
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === oldDeltaLink) {
        return jsonResponse({ value: [graphMessage("graph-1")], "@odata.nextLink": nextLink });
      }
      if (url === nextLink) {
        return jsonResponse({ value: [graphMessage("graph-2")], "@odata.deltaLink": terminalDeltaLink });
      }
      throw new Error(`Unexpected Graph request: ${url}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(fetchMock().mock.calls.map((call) => String(call[0]))).toEqual([oldDeltaLink, nextLink]);
    expect(result.messages.map((message) => message.externalMessageId)).toEqual(["graph-1", "graph-2"]);
    expect(mocks.writeMailboxSyncCursor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.any(Object),
      { graphDeltaLink: terminalDeltaLink }
    );
  });

  it("checks the exact Gmail thread recorded on the sent carrier email", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection());
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/threads/gmail-thread-1")) {
        return jsonResponse({
          id: "gmail-thread-1",
          messages: [
            gmailMessage("sent-carrier-1"),
            gmailInboundReply("carrier-reply-1", "gmail-thread-1", "<sent-carrier-1@example.com>"),
          ],
        });
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      targets: [{
        externalThreadId: "gmail-thread-1",
        rfc822MessageId: "<sent-carrier-1@example.com>",
        sentAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(String(fetchMock().mock.calls[0][0])).toContain("/threads/gmail-thread-1");
    expect(result.targetsChecked).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "carrier-reply-1",
      externalThreadId: "gmail-thread-1",
      direction: "inbound",
      inReplyToHeader: "<sent-carrier-1@example.com>",
    });
  });

  it("uses the verified original sender mailbox for a same-agency carrier reply check", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      connection_id: "connection-sender",
      user_id: "user-sender",
      address: "sender@example.com",
      provider: "google",
      communication_id: "communication-carrier-1",
      subject: "Commercial application package - Fictional Insured",
      message_id_header: "<sent-carrier-sender@example.com>",
      external_recipient_email: "underwriter@carrier.example",
      to_recipients: ["underwriter@carrier.example"],
      sent_at: new Date("2026-01-01T00:00:00.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      mailbox: {
        origin: "provider_send",
        account: "sender@example.com",
        connectionId: "connection-sender",
        externalThreadId: "gmail-thread-sender",
        rfc822MessageId: "<sent-carrier-sender@example.com>",
      },
      resolution: { verifiedOutbound: true },
    }]);
    mocks.readFreshMailboxToken.mockResolvedValue({
      connection: {
        id: "connection-sender",
        tenant_id: "tenant-1",
        user_id: "user-sender",
        provider: "google",
        address: "sender@example.com",
        status: "connected",
        token_vault_ref: "mailbox-token:sender-vault",
      },
      token: {
        provider: "google",
        accessToken: "sender-google-token",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        return jsonResponse({ messages: [] });
      }
      if (url.pathname.endsWith("/threads/gmail-thread-sender")) {
        return jsonResponse({
          id: "gmail-thread-sender",
          messages: [
            gmailMessage("sent-carrier-sender"),
            gmailInboundReply(
              "carrier-reply-sender",
              "gmail-thread-sender",
              "<sent-carrier-sender@example.com>",
              { from: "Underwriter <underwriter@carrier.example>" }
            ),
          ],
        });
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      connectionId: "connection-sender",
      targets: [{
        communicationId: "communication-carrier-1",
        externalThreadId: "gmail-thread-sender",
        rfc822MessageId: "<sent-carrier-sender@example.com>",
        sentAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    expect(mocks.readFreshMailboxToken).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      userId: "user-sender",
      connectionId: "connection-sender",
      expectedAddress: "sender@example.com",
    }));
    expect(result.messages).toHaveLength(1);
    expect(result.mailboxAccount).toBe("sender@example.com");
  });

  it("checks multiple original sender mailboxes sequentially without crossing threads", async () => {
    const canonicalRow = (suffix: string) => ({
      connection_id: `connection-${suffix}`,
      user_id: `user-${suffix}`,
      address: `${suffix}@example.com`,
      provider: "google",
      communication_id: `communication-${suffix}`,
      subject: `Commercial application package - ${suffix}`,
      message_id_header: `<sent-${suffix}@example.com>`,
      external_recipient_email: `${suffix}@carrier.example`,
      to_recipients: [`${suffix}@carrier.example`],
      sent_at: new Date("2026-01-01T00:00:00.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      mailbox: {
        origin: "provider_send",
        account: `${suffix}@example.com`,
        connectionId: `connection-${suffix}`,
        externalThreadId: `thread-${suffix}`,
        rfc822MessageId: `<sent-${suffix}@example.com>`,
      },
      resolution: { verifiedOutbound: true },
    });
    mocks.queryRaw.mockResolvedValueOnce([canonicalRow("first"), canonicalRow("second")]);
    mocks.readFreshMailboxToken.mockImplementation(async ({ connectionId }: { connectionId?: string }) => {
      const suffix = connectionId?.replace("connection-", "") ?? "unknown";
      return {
        connection: {
          id: `connection-${suffix}`,
          tenant_id: "tenant-1",
          user_id: `user-${suffix}`,
          provider: "google",
          address: `${suffix}@example.com`,
          status: "connected",
          token_vault_ref: `mailbox-token:${suffix}`,
        },
        token: {
          provider: "google",
          accessToken: `token-${suffix}`,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
      };
    });
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        return jsonResponse({ messages: [] });
      }
      const suffix = url.pathname.endsWith("/threads/thread-first")
        ? "first"
        : url.pathname.endsWith("/threads/thread-second")
          ? "second"
          : "";
      if (!suffix) throw new Error(`Unexpected Gmail request: ${url.toString()}`);
      return jsonResponse({
        id: `thread-${suffix}`,
        messages: [
          gmailMessage(`sent-${suffix}`),
          gmailInboundReply(
            `reply-${suffix}`,
            `thread-${suffix}`,
            `<sent-${suffix}@example.com>`,
            { from: `${suffix} underwriter <${suffix}@carrier.example>` }
          ),
        ],
      });
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      connectionId: "untrusted-browser-hint",
      targets: [
        { communicationId: "communication-first" },
        { communicationId: "communication-second" },
      ],
    });

    expect(mocks.readFreshMailboxToken.mock.calls.map(([input]) => input.connectionId)).toEqual([
      "connection-first",
      "connection-second",
    ]);
    expect(result.mailboxesChecked.map((mailbox) => mailbox.mailboxAccount)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(result.messages.map((message) => message.externalMessageId)).toEqual([
      "reply-first",
      "reply-second",
    ]);
  });

  it("rejects an unverified outbound communication when it has no exact recovery key", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      targets: [{
        communicationId: "communication-from-another-agency",
      }],
    })).rejects.toThrow("could not verify the original outbound carrier email");

    expect(mocks.readFreshMailboxToken).not.toHaveBeenCalled();
  });

  it("recovers an old quote-flow reply target through the current mailbox when no send ledger row exists", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection());
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        expect(url.searchParams.get("q")).toContain("from:gbnhone@gmail.com");
        expect(url.searchParams.get("q")).toContain('subject:"commercial application package - fictional insured"');
        return jsonResponse({ messages: [{ id: "carrier-reply-recovered-from-current-mailbox" }] });
      }
      if (url.pathname.endsWith("/messages/carrier-reply-recovered-from-current-mailbox")) {
        return jsonResponse(gmailInboundReply(
          "carrier-reply-recovered-from-current-mailbox",
          "gmail-thread-recovered",
          "<legacy-outbound@example.com>",
          {
            from: "GBN Hone <gbnhone@gmail.com>",
            subject: "Re: Commercial application package - Fictional Insured",
            sentAt: "2026-07-19T23:59:00.000Z",
            body: "Approved. Annual Premium: $4,850.",
          }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      targets: [{
        communicationId: "legacy-local-communication",
        subject: "Commercial application package - Fictional Insured",
        participantEmail: "gbnhone@gmail.com",
        sentAt: "2026-07-19T21:56:30.375Z",
        carrierSubmissionId: "submission-great-lakes",
      }],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "carrier-reply-recovered-from-current-mailbox",
      carrierSubmissionId: "submission-great-lakes",
    });
    expect(mocks.readFreshMailboxToken).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
    }));
  });

  it("recovers old quote-flow replies through an agency mailbox when the checking user has no mailbox", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.readFreshMailboxToken.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.readFreshTenantStaffMailboxToken.mockResolvedValue({
      ...googleConnection(),
      connection: {
        ...googleConnection().connection,
        id: "connection-original-sender",
        user_id: "user-original-sender",
        address: "agent@agency.example",
      },
    });
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        expect(url.searchParams.get("q")).toContain("from:gbnhone@gmail.com");
        expect(url.searchParams.get("q")).toContain('subject:"commercial application package - fictional insured"');
        return jsonResponse({ messages: [{ id: "carrier-reply-found-through-agency-mailbox" }] });
      }
      if (url.pathname.endsWith("/messages/carrier-reply-found-through-agency-mailbox")) {
        return jsonResponse(gmailInboundReply(
          "carrier-reply-found-through-agency-mailbox",
          "gmail-thread-recovered",
          "<legacy-outbound@example.com>",
          {
            from: "GBN Hone <gbnhone@gmail.com>",
            subject: "Re: Commercial application package - Fictional Insured",
            sentAt: "2026-07-19T23:59:00.000Z",
            body: "The coverage has been approved. Annual Premium: $4,850.",
          }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      targets: [{
        communicationId: "legacy-local-communication",
        subject: "Commercial application package - Fictional Insured",
        participantEmail: "gbnhone@gmail.com",
        sentAt: "2026-07-19T21:56:30.375Z",
        carrierSubmissionId: "submission-great-lakes",
      }],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "carrier-reply-found-through-agency-mailbox",
      carrierSubmissionId: "submission-great-lakes",
    });
    expect(mocks.readFreshTenantStaffMailboxToken).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      connectionId: undefined,
    });
  });

  it("rejects a reply batch when any exact target lacks its outbound communication id", async () => {
    await expect(syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-checking-replies",
      targets: [
        {
          communicationId: "communication-carrier-1",
          subject: "Commercial application package - Fictional Insured",
          participantEmail: "first@carrier.example",
          sentAt: "2026-07-19T21:56:30.375Z",
        },
        {
          subject: "Commercial application package - Another Insured",
          participantEmail: "second@carrier.example",
          sentAt: "2026-07-19T21:57:30.375Z",
        },
      ],
    })).rejects.toThrow("must identify its original outbound message");

    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.readFreshMailboxToken).not.toHaveBeenCalled();
  });

  it("recovers a Gmail carrier reply by exact subject, sender, and send time when the outbound fallback has no provider IDs", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection());
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        expect(url.searchParams.get("q")).toContain("from:gbnhone@gmail.com");
        expect(url.searchParams.get("q")).toContain('subject:"commercial application package - fictional insured"');
        return jsonResponse({ messages: [{ id: "carrier-reply-recovered" }] });
      }
      if (url.pathname.endsWith("/messages/carrier-reply-recovered")) {
        return jsonResponse(gmailInboundReply(
          "carrier-reply-recovered",
          "gmail-thread-recovered",
          "<unavailable-fallback-message-id@example.com>",
          {
            from: "GBN Hone <gbnhone@gmail.com>",
            subject: "Re: Commercial application package - Fictional Insured",
            sentAt: "2026-07-19T23:59:00.000Z",
            body: "The coverage has been approved. Annual Premium: $4,850. Required Prior to Binding: signed ACORD applications.",
          }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      targets: [{
        subject: "Commercial application package - Fictional Insured",
        participantEmail: "gbnhone@gmail.com",
        sentAt: "2026-07-19T21:56:30.375Z",
        carrierSubmissionId: "submission-great-lakes",
      }],
    });

    expect(result.targetsChecked).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "carrier-reply-recovered",
      direction: "inbound",
      subject: "Re: Commercial application package - Fictional Insured",
      carrierSubmissionId: "submission-great-lakes",
    });
  });

  it("recovers an exact Gmail reply when a stale non-Gmail thread id is stored on the outbound message", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection());
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/threads/transactional-thread-1")) {
        return jsonResponse({ error: { message: "Invalid thread id." } }, 400);
      }
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        expect(url.searchParams.get("q")).toContain("from:gbnhone@gmail.com");
        return jsonResponse({ messages: [{ id: "carrier-reply-after-stale-thread" }] });
      }
      if (url.pathname.endsWith("/messages/carrier-reply-after-stale-thread")) {
        return jsonResponse(gmailInboundReply(
          "carrier-reply-after-stale-thread",
          "gmail-thread-recovered",
          "<unavailable-fallback-message-id@example.com>",
          {
            from: "GBN Hone <gbnhone@gmail.com>",
            subject: "Re: Commercial application package - Fictional Insured",
            sentAt: "2026-07-19T23:59:00.000Z",
            body: "The coverage has been approved. Annual Premium: $4,850.",
          }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      targets: [{
        externalThreadId: "transactional-thread-1",
        subject: "Commercial application package - Fictional Insured",
        participantEmail: "gbnhone@gmail.com",
        sentAt: "2026-07-19T21:56:30.375Z",
        carrierSubmissionId: "submission-great-lakes",
      }],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "carrier-reply-after-stale-thread",
      direction: "inbound",
      carrierSubmissionId: "submission-great-lakes",
    });
  });

  it("does not recover a same-subject Gmail message from a different sender", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection());
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages") && url.searchParams.has("q")) {
        return jsonResponse({ messages: [{ id: "unrelated-reply" }] });
      }
      if (url.pathname.endsWith("/messages/unrelated-reply")) {
        return jsonResponse(gmailInboundReply(
          "unrelated-reply",
          "gmail-thread-unrelated",
          "<other@example.com>",
          {
            from: "Other Sender <other@example.com>",
            subject: "Re: Commercial application package - Fictional Insured",
            sentAt: "2026-07-19T23:59:00.000Z",
          }
        ));
      }
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      targets: [{
        subject: "Commercial application package - Fictional Insured",
        participantEmail: "gbnhone@gmail.com",
        sentAt: "2026-07-19T21:56:30.375Z",
      }],
    });

    expect(result.targetsChecked).toBe(1);
    expect(result.messages).toHaveLength(0);
  });

  it("checks the exact Microsoft conversation recorded on the sent carrier email", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(microsoftConnection("unused-delta-link"));
    fetchMock().mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1.0/me/messages");
      expect(url.searchParams.get("$filter")).toBe("conversationId eq 'conversation-carrier-1'");
      return jsonResponse({ value: [graphInboundReply("graph-reply-1", "conversation-carrier-1")] });
    });

    const result = await syncMailboxReplyMessages({
      tenantId: "tenant-1",
      userId: "user-1",
      targets: [{
        externalThreadId: "conversation-carrier-1",
        rfc822MessageId: "<sent-graph-1@example.com>",
        sentAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(result.targetsChecked).toBe(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "graph-reply-1",
      externalThreadId: "conversation-carrier-1",
      direction: "inbound",
      inReplyToHeader: "<sent-graph-1@example.com>",
    });
  });

  it("reports only token-granted capabilities, not requested connection scopes", async () => {
    mocks.queryRaw.mockImplementation(async (...args: unknown[]) => {
      const sql = sqlText(args);
      if (sql.includes("FROM mailbox_connections")) {
        return [{
          id: "connection-1",
          tenant_id: "tenant-1",
          user_id: "user-1",
          owner_type: "staff",
          provider: "google",
          address: "agent@example.com",
          display_name: "Agent",
          status: "connected",
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          connected_at: new Date("2026-01-01T00:00:00.000Z"),
          last_sync_at: null,
          last_send_at: null,
          last_error: null,
          updated_at: new Date("2026-01-02T00:00:00.000Z"),
        }];
      }
      if (sql.includes("COUNT(*)")) return [{ count: 0n }];
      return [];
    });
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection(undefined, "https://www.googleapis.com/auth/gmail.send"));

    const [diagnostic] = await listMailboxDiagnostics({ tenantId: "tenant-1" });

    expect(diagnostic.grantedScopes).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
    expect(diagnostic.hasReadScope).toBe(false);
    expect(diagnostic.hasSendScope).toBe(true);
  });

  it("defers an overlapping mailbox sync without calling the provider", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    mocks.executeRaw.mockResolvedValueOnce(0);

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result).toMatchObject({ deferred: true, messages: [] });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("releases its mailbox lease after a provider failure", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    fetchMock().mockRejectedValue(new Error("provider unavailable"));

    await expect(syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" }))
      .rejects.toThrow("Mailbox provider request was interrupted");

    const leaseQueries = mocks.executeRaw.mock.calls.map(sqlText);
    expect(leaseQueries[0]).toContain("SET sync_lease_id");
    expect(leaseQueries.at(-1)).toContain("SET sync_lease_id = NULL");
    expect(leaseQueries.at(-1)).toContain("AND sync_lease_id");
  });

  it("polls without wrapping provider work in a database transaction", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    const result = await pollDueMailboxConnections();

    expect(result).toMatchObject({ checked: 0, failed: 0, results: [] });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlText(mocks.queryRaw.mock.calls[0])).toContain("FROM mailbox_connections");
  });
});

function googleConnection(historyId?: string, scope = "https://www.googleapis.com/auth/gmail.readonly") {
  return {
    connection: {
      id: "connection-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      provider: "google",
      address: "agent@example.com",
      status: "connected",
      token_vault_ref: "mailbox-token:vault-1",
    },
    token: {
      provider: "google",
      accessToken: "google-token",
      scope,
      syncCursor: historyId ? { gmailHistoryId: historyId } : undefined,
    },
  };
}

function microsoftConnection(deltaLink: string) {
  return {
    connection: {
      id: "connection-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      provider: "microsoft",
      address: "agent@example.com",
      status: "connected",
      token_vault_ref: "mailbox-token:vault-1",
    },
    token: {
      provider: "microsoft",
      accessToken: "microsoft-token",
      scope: "Mail.Read Mail.Send",
      syncCursor: { graphDeltaLink: deltaLink },
    },
  };
}

function gmailMessage(id: string) {
  return {
    id,
    threadId: `thread-${id}`,
    labelIds: ["SENT"],
    snippet: `Body ${id}`,
    internalDate: "1767225600000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "agent@example.com" },
        { name: "To", value: "client@example.com" },
        { name: "Message-ID", value: `<${id}@example.com>` },
      ],
      body: { data: Buffer.from(`Body ${id}`, "utf8").toString("base64url") },
    },
  };
}

function gmailInboundReply(
  id: string,
  threadId: string,
  inReplyTo: string,
  overrides: {
    from?: string;
    subject?: string;
    sentAt?: string;
    body?: string;
  } = {}
) {
  const body = overrides.body ?? "We can quote this account.";
  return {
    id,
    threadId,
    labelIds: ["INBOX", "UNREAD"],
    snippet: body,
    internalDate: String(new Date(overrides.sentAt ?? "2026-01-01T01:00:00.000Z").getTime()),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: overrides.from ?? "underwriter@carrier.example" },
        { name: "To", value: "agent@example.com" },
        ...(overrides.subject ? [{ name: "Subject", value: overrides.subject }] : []),
        { name: "Message-ID", value: `<${id}@carrier.example>` },
        { name: "In-Reply-To", value: inReplyTo },
        { name: "References", value: inReplyTo },
      ],
      body: { data: Buffer.from(body, "utf8").toString("base64url") },
    },
  };
}

function graphMessage(id: string) {
  return {
    id,
    conversationId: `conversation-${id}`,
    webLink: `https://outlook.office.com/mail/${id}`,
    subject: `Subject ${id}`,
    bodyPreview: `Body ${id}`,
    sentDateTime: "2026-01-01T00:00:00.000Z",
    isRead: true,
    internetMessageId: `<${id}@example.com>`,
    from: { emailAddress: { address: "agent@example.com" } },
    toRecipients: [{ emailAddress: { address: "client@example.com" } }],
    body: { contentType: "text", content: `Body ${id}` },
    hasAttachments: false,
  };
}

function graphInboundReply(id: string, conversationId: string) {
  return {
    id,
    conversationId,
    webLink: `https://outlook.office.com/mail/${id}`,
    subject: "Re: Commercial application package",
    bodyPreview: "We can quote this account.",
    receivedDateTime: "2026-01-01T01:00:00.000Z",
    isRead: false,
    internetMessageId: `<${id}@carrier.example>`,
    internetMessageHeaders: [
      { name: "In-Reply-To", value: "<sent-graph-1@example.com>" },
      { name: "References", value: "<sent-graph-1@example.com>" },
    ],
    from: { emailAddress: { address: "underwriter@carrier.example" } },
    toRecipients: [{ emailAddress: { address: "agent@example.com" } }],
    body: { contentType: "text", content: "We can quote this account." },
    hasAttachments: false,
  };
}

function fetchMock() {
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function mockCustomerContacts(
  rows: Array<{ id: string; name?: string; email: string; additional_contacts: unknown }>
) {
  mocks.queryRaw.mockImplementation(async (...args: unknown[]) =>
    sqlText(args).includes("FROM customer_profiles")
      ? rows.map((row) => ({ ...row, name: row.name ?? row.email }))
      : []
  );
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sqlText(args: unknown[]): string {
  const strings = args[0];
  return Array.isArray(strings) ? strings.join("?") : String(strings ?? "");
}
