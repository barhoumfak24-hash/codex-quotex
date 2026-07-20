import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFreshMailboxToken: vi.fn(),
  writeMailboxSyncCursor: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  txQueryRaw: vi.fn(),
}));

vi.mock("../services/mailboxProvider.js", () => ({
  readFreshMailboxToken: mocks.readFreshMailboxToken,
  writeMailboxSyncCursor: mocks.writeMailboxSyncCursor,
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
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
  mocks.writeMailboxSyncCursor.mockReset().mockResolvedValue(undefined);
  mocks.queryRaw.mockReset().mockResolvedValue([]);
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.txQueryRaw.mockReset();
  mocks.transaction.mockReset().mockImplementation(async (callback) =>
    callback({ $queryRaw: mocks.txQueryRaw })
  );
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
      if (messageId) return jsonResponse(gmailMessage(messageId));
      throw new Error(`Unexpected Gmail request: ${url.toString()}`);
    });

    const result = await syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" });

    expect(result.messages.map((message) => message.externalMessageId)).toEqual(["gmail-1", "gmail-2"]);
    expect(result.importSummary).toEqual({ imported: 2, updated: 0, deduped: 0, failed: 0 });
    expect(mocks.writeMailboxSyncCursor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connection-1" }),
      expect.any(Object),
      { gmailHistoryId: "history-terminal" }
    );
    const cursorOrder = mocks.writeMailboxSyncCursor.mock.invocationCallOrder[0];
    expect(mocks.executeRaw.mock.invocationCallOrder.filter((order) => order < cursorOrder)).toHaveLength(2);
  });

  it("leaves the Gmail cursor untouched when a continuation page fails", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ history: [], historyId: "history-page-1", nextPageToken: "page-2" }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "temporary failure" } }, 503));

    await expect(
      syncMailboxMessages({ tenantId: "tenant-1", userId: "user-1" })
    ).rejects.toThrow("temporary failure");
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(mocks.writeMailboxSyncCursor).not.toHaveBeenCalled();
  });

  it("preserves the old cursor when a fetched message cannot be persisted", async () => {
    mocks.readFreshMailboxToken.mockResolvedValue(googleConnection("history-old"));
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
    mocks.executeRaw.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(1);

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

  it("uses a transaction-scoped advisory lock and skips when another poll owns it", async () => {
    mocks.txQueryRaw.mockResolvedValue([{ locked: false }]);

    const result = await pollDueMailboxConnections();

    expect(result).toMatchObject({ skipped: true, reason: "mailbox_poll_already_running" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(sqlText(mocks.txQueryRaw.mock.calls[0])).toContain("pg_try_advisory_xact_lock");
    expect(sqlText(mocks.txQueryRaw.mock.calls[0])).not.toContain("pg_try_advisory_lock(");
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

function gmailInboundReply(id: string, threadId: string, inReplyTo: string) {
  return {
    id,
    threadId,
    labelIds: ["INBOX", "UNREAD"],
    snippet: "We can quote this account.",
    internalDate: "1767229200000",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "underwriter@carrier.example" },
        { name: "To", value: "agent@example.com" },
        { name: "Message-ID", value: `<${id}@carrier.example>` },
        { name: "In-Reply-To", value: inReplyTo },
        { name: "References", value: inReplyTo },
      ],
      body: { data: Buffer.from("We can quote this account.", "utf8").toString("base64url") },
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
