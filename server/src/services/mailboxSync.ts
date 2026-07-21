import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { readFreshMailboxToken, writeMailboxSyncCursor, type OAuthTokenPayload } from "./mailboxProvider.js";
import { prisma } from "./prisma.js";
import { readRemoteState, supabaseStateConfigured } from "./supabaseState.js";

export type MailboxSyncInput = {
  tenantId: string;
  userId: string;
  connectionId?: string;
  maxResults?: number;
};

export type MailboxReplyTarget = {
  communicationId?: string;
  externalThreadId?: string;
  rfc822MessageId?: string;
  sentAt?: string;
  subject?: string;
  participantEmail?: string;
  carrierSubmissionId?: string;
};

export type MailboxReplySyncInput = {
  tenantId: string;
  userId: string;
  connectionId?: string;
  targets: MailboxReplyTarget[];
};

type AuthorizedReplyMailbox = {
  connection_id: string;
  user_id: string;
  address: string;
  communication_id: string;
};

type CanonicalReplyTargetRow = AuthorizedReplyMailbox & {
  provider: string;
  subject: string | null;
  message_id_header: string | null;
  external_recipient_email: string | null;
  to_recipients: unknown;
  sent_at: Date | null;
  created_at: Date;
  mailbox: unknown;
  resolution: unknown;
};

type AuthorizedReplyGroup = {
  userId: string;
  connectionId: string;
  expectedAddress: string;
  targets: MailboxReplyTarget[];
};

export type MailboxSyncImportSummary = {
  imported: number;
  updated: number;
  deduped: number;
  failed: number;
};

export type SyncedMailboxMessage = {
  mailboxAccount: string;
  mailboxConnectionId: string;
  provider: "gmail" | "outlook";
  externalMessageId: string;
  externalThreadId?: string;
  externalUrl?: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  bodyHtml?: string;
  rawMimeRef?: string;
  rfc822MessageId?: string;
  messageIdHeader?: string;
  inReplyToHeader?: string;
  references?: string[];
  attachments?: SyncedMailboxAttachment[];
  snippet?: string;
  isRead?: boolean;
  mailboxLabels?: string[];
  sentAt?: string;
  direction: "inbound" | "outbound";
  carrierSubmissionId?: string;
};

export type SyncedMailboxAttachment = {
  id: string;
  fileName: string;
  fileType: string;
  sizeBytes?: number;
  dataUrl?: string;
  storagePath?: string;
};

type PersistedMailboxMessageRow = {
  mailbox: unknown;
  resolution: unknown;
  external_recipient_email: string | null;
  customer_email: string | null;
  direction: string;
  subject: string | null;
  body: string;
  body_html: string | null;
  raw_mime_ref: string | null;
  message_id_header: string | null;
  in_reply_to_header: string | null;
  reference_headers: unknown;
  to_recipients: unknown;
  cc_recipients: unknown;
  bcc_recipients: unknown;
  attachments: unknown;
  snippet: string | null;
  is_read: boolean;
  mailbox_labels: unknown;
  sent_at: Date | null;
  created_at: Date;
};

type GmailListResponse = {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
  error?: { message?: string };
};

type GmailHistoryResponse = {
  history?: Array<{
    id?: string;
    messages?: { id: string; threadId?: string }[];
    messagesAdded?: Array<{ message?: { id: string; threadId?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
  error?: { message?: string };
};

type GmailProfileResponse = {
  emailAddress?: string;
  historyId?: string;
  error?: { message?: string };
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
  error?: { message?: string };
};

type GmailThreadResponse = {
  id?: string;
  historyId?: string;
  messages?: GmailMessage[];
  error?: { message?: string };
};

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

type GraphMessageList = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
  error?: { message?: string };
};

type GraphMessage = {
  id: string;
  conversationId?: string;
  webLink?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  parentFolderId?: string;
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
};

type GraphRecipient = { emailAddress?: { address?: string; name?: string } };

type GraphAttachmentList = {
  value?: Array<{
    id?: string;
    name?: string;
    contentType?: string;
    size?: number;
    isInline?: boolean;
    contentBytes?: string;
  }>;
};

type MailboxConnectionForPersistence = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  provider: string;
  address: string;
};

type ExistingCommunicationRow = {
  id: string;
  thread_id: string | null;
  message_id_header: string | null;
  in_reply_to_header: string | null;
  reference_headers: unknown;
  mailbox: unknown;
};

type ResolvedContact =
  | { customerId: string; externalRecipientEmail?: never; externalRecipientName?: never; externalRecipientRole?: never }
  | {
      customerId?: never;
      externalRecipientEmail: string | null;
      externalRecipientName: string;
      externalRecipientRole: string;
    };

type AdvisoryLockTransaction = {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export async function syncMailboxMessages(input: MailboxSyncInput): Promise<{
  connectionId: string;
  mailboxAccount: string;
  provider: "gmail" | "outlook";
  messages: SyncedMailboxMessage[];
  importSummary: MailboxSyncImportSummary;
}> {
  const { connection, token } = await readFreshMailboxToken(input);
  const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 50);
  if (token.provider === "google") {
    const result = await syncGmailMessages(
      connection.id,
      connection.address,
      token.accessToken,
      maxResults,
      token.syncCursor?.gmailHistoryId
    );
    const messages = result.messages;
    const importSummary = await persistSyncedMailboxMessages(connection, messages);
    if (result.nextHistoryId && importSummary.failed === 0) {
      await writeMailboxSyncCursor(connection, token, { gmailHistoryId: result.nextHistoryId });
    }
    await markConnectionSynced(connection.id);
    return { connectionId: connection.id, mailboxAccount: connection.address, provider: "gmail", messages, importSummary };
  }
  const result = await syncMicrosoftMessages(
    connection.id,
    connection.address,
    token.accessToken,
    maxResults,
    token.syncCursor?.graphDeltaLink
  );
  const messages = result.messages;
  const importSummary = await persistSyncedMailboxMessages(connection, messages);
  if (result.nextDeltaLink && importSummary.failed === 0) {
    await writeMailboxSyncCursor(connection, token, { graphDeltaLink: result.nextDeltaLink });
  }
  await markConnectionSynced(connection.id);
  return { connectionId: connection.id, mailboxAccount: connection.address, provider: "outlook", messages, importSummary };
}

export async function syncMailboxReplyMessages(input: MailboxReplySyncInput): Promise<{
  connectionId: string;
  mailboxAccount: string;
  provider: "gmail" | "outlook";
  mailboxesChecked: Array<{ connectionId: string; mailboxAccount: string; provider: "gmail" | "outlook" }>;
  targetsChecked: number;
  messages: SyncedMailboxMessage[];
  importSummary: MailboxSyncImportSummary;
}> {
  const requestedTargets = uniqueReplyTargets(input.targets);
  const groups = await resolveAuthorizedReplyGroups(input, requestedTargets);
  const messages: SyncedMailboxMessage[] = [];
  const importSummary: MailboxSyncImportSummary = { imported: 0, updated: 0, deduped: 0, failed: 0 };
  const mailboxesChecked: Array<{ connectionId: string; mailboxAccount: string; provider: "gmail" | "outlook" }> = [];

  for (const group of groups) {
    const { connection, token } = await readFreshMailboxToken({
      tenantId: input.tenantId,
      userId: group.userId,
      connectionId: group.connectionId,
      expectedAddress: group.expectedAddress,
    });
    const provider = token.provider === "google" ? "gmail" : "outlook";
    const synced = token.provider === "google"
      ? await syncGmailReplyMessages(connection.id, connection.address, token.accessToken, group.targets)
      : await syncMicrosoftReplyMessages(connection.id, connection.address, token.accessToken, group.targets);
    const summary = await persistSyncedMailboxMessages(connection, synced);
    messages.push(...synced);
    importSummary.imported += summary.imported;
    importSummary.updated += summary.updated;
    importSummary.deduped += summary.deduped;
    importSummary.failed += summary.failed;
    mailboxesChecked.push({ connectionId: connection.id, mailboxAccount: connection.address, provider });
    await markConnectionSynced(connection.id);
  }

  const firstMailbox = mailboxesChecked[0];
  return {
    connectionId: firstMailbox?.connectionId ?? "",
    mailboxAccount: firstMailbox?.mailboxAccount ?? "",
    provider: firstMailbox?.provider ?? "gmail",
    mailboxesChecked,
    targetsChecked: groups.reduce((total, group) => total + group.targets.length, 0),
    messages,
    importSummary,
  };
}

export async function listPersistedMailboxMessages(input: {
  tenantId: string;
  userId: string;
  limit?: number;
}): Promise<SyncedMailboxMessage[]> {
  const limit = Math.min(Math.max(input.limit ?? 250, 1), 500);
  const rows = await prisma.$queryRaw<PersistedMailboxMessageRow[]>`
    SELECT
      communication.mailbox,
      communication.resolution,
      communication.external_recipient_email,
      customer.email AS customer_email,
      communication.direction,
      communication.subject,
      communication.body,
      communication.body_html,
      communication.raw_mime_ref,
      communication.message_id_header,
      communication.in_reply_to_header,
      communication.reference_headers,
      communication.to_recipients,
      communication.cc_recipients,
      communication.bcc_recipients,
      communication.attachments,
      communication.snippet,
      communication.is_read,
      communication.mailbox_labels,
      communication.sent_at,
      communication.created_at
    FROM communications AS communication
    LEFT JOIN customer_profiles AS customer
      ON customer.id = communication.customer_id
      AND customer.tenant_id = communication.tenant_id
    WHERE communication.tenant_id = ${input.tenantId}
      AND communication.channel = 'email'
      AND communication.direction = 'inbound'
      AND communication.mailbox->>'origin' IN ('provider_sync', 'inbound_relay')
      AND COALESCE(communication.mailbox->>'externalMessageId', '') <> ''
      AND (
        (
          communication.mailbox->>'origin' = 'provider_sync'
          AND EXISTS (
            SELECT 1
            FROM mailbox_connections AS mailbox_connection
            WHERE mailbox_connection.id = communication.mailbox->>'connectionId'
              AND mailbox_connection.tenant_id = ${input.tenantId}
              AND mailbox_connection.user_id = ${input.userId}
          )
        )
        OR (
          communication.mailbox->>'origin' = 'inbound_relay'
          AND communication.mailbox->>'userId' = ${input.userId}
        )
      )
    ORDER BY COALESCE(communication.sent_at, communication.created_at) DESC
    LIMIT ${limit}
  `;

  return rows.flatMap((row) => {
    const mailbox = asRecord(row.mailbox);
    const mailboxAccount = stringValue(mailbox.account);
    const externalMessageId = stringValue(mailbox.externalMessageId);
    const from = row.external_recipient_email ?? row.customer_email ?? "";
    if (!mailboxAccount || !externalMessageId || !from) return [];
    const providerValue = stringValue(mailbox.provider).toLowerCase();
    const resolution = asRecord(row.resolution);
    const provider: "gmail" | "outlook" =
      providerValue === "microsoft" || providerValue === "outlook" ? "outlook" : "gmail";
    const to = stringArray(row.to_recipients);
    return [{
      mailboxAccount,
      mailboxConnectionId: stringValue(mailbox.connectionId),
      provider,
      externalMessageId,
      externalThreadId: optionalString(mailbox.externalThreadId),
      externalUrl: optionalString(mailbox.externalUrl),
      from,
      to: to.length > 0 ? to : [mailboxAccount],
      cc: stringArray(row.cc_recipients),
      bcc: stringArray(row.bcc_recipients),
      subject: row.subject ?? undefined,
      body: row.body,
      bodyHtml: row.body_html ?? undefined,
      rawMimeRef: row.raw_mime_ref ?? optionalString(mailbox.rawMimeRef),
      rfc822MessageId: optionalString(mailbox.rfc822MessageId),
      messageIdHeader: row.message_id_header ?? undefined,
      inReplyToHeader: row.in_reply_to_header ?? undefined,
      references: stringArray(row.reference_headers),
      attachments: Array.isArray(row.attachments)
        ? (row.attachments as SyncedMailboxAttachment[])
        : [],
      snippet: row.snippet ?? undefined,
      isRead: row.is_read,
      mailboxLabels: stringArray(row.mailbox_labels),
      sentAt: (row.sent_at ?? row.created_at).toISOString(),
      direction: "inbound" as const,
      carrierSubmissionId: optionalString(resolution.carrierSubmissionId),
    }];
  });
}

export async function syncDueMailboxConnections(input: { maxConnections?: number; maxResults?: number } = {}) {
  const maxConnections = Math.min(Math.max(input.maxConnections ?? 50, 1), 100);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tenant_id: string;
      user_id: string | null;
      address: string;
      provider: string;
      last_sync_at: Date | null;
    }>
  >`
    SELECT id, tenant_id, user_id, address, provider, last_sync_at
    FROM mailbox_connections
    WHERE status = 'connected'
      AND owner_type = 'staff'
      AND user_id IS NOT NULL
    ORDER BY COALESCE(last_sync_at, '1970-01-01'::timestamp) ASC, updated_at ASC
    LIMIT ${maxConnections}
  `;

  const results = [];
  let imported = 0;
  let updated = 0;
  let deduped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.user_id) continue;
    try {
      const result = await syncMailboxMessages({
        tenantId: row.tenant_id,
        userId: row.user_id,
        connectionId: row.id,
        maxResults: input.maxResults ?? 25,
      });
      imported += result.importSummary.imported;
      updated += result.importSummary.updated;
      deduped += result.importSummary.deduped;
      failed += result.importSummary.failed;
      await recordMailboxAudit({
        tenantId: row.tenant_id,
        actorId: row.user_id,
        action: "mailbox.sync.completed",
        entityId: row.id,
        metadata: {
          address: row.address,
          provider: row.provider,
          fetched: result.messages.length,
          created: result.importSummary.imported,
          errors: result.importSummary.failed,
          imported: result.importSummary.imported,
          updated: result.importSummary.updated,
          deduped: result.importSummary.deduped,
          failed: result.importSummary.failed,
          messageCount: result.messages.length,
        },
      });
      results.push({
        connectionId: row.id,
        mailboxAccount: row.address,
        provider: row.provider,
        ok: true,
        messageCount: result.messages.length,
        importSummary: result.importSummary,
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Mailbox sync failed.";
      await markConnectionError(row.id, message);
      await recordMailboxAudit({
        tenantId: row.tenant_id,
        actorId: row.user_id,
        action: "mailbox.sync.failed",
        entityId: row.id,
        metadata: { address: row.address, provider: row.provider, reason: message },
      });
      results.push({
        connectionId: row.id,
        mailboxAccount: row.address,
        provider: row.provider,
        ok: false,
        error: message,
      });
    }
  }

  return {
    checked: rows.length,
    imported,
    updated,
    deduped,
    failed,
    results,
  };
}

export async function pollDueMailboxConnections(input: { maxConnections?: number; maxResults?: number } = {}) {
  return prisma.$transaction(async (tx: AdvisoryLockTransaction) => {
    const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext('quotex-mailbox-poll')) AS locked
    `;
    if (rows[0]?.locked !== true) {
      return {
        checked: 0,
        imported: 0,
        updated: 0,
        deduped: 0,
        failed: 0,
        skipped: true,
        reason: "mailbox_poll_already_running",
        results: [],
      };
    }
    return await syncDueMailboxConnections(input);
  }, { timeout: 10 * 60_000 });
}

export async function listMailboxSyncStatus(input: { tenantId: string; limit?: number }) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      action: string;
      entity_id: string;
      metadata: unknown;
      created_at: Date;
    }>
  >`
    SELECT id, action, entity_id, metadata, created_at
    FROM audit_logs
    WHERE tenant_id = ${input.tenantId}
      AND (action LIKE 'mailbox.sync.%' OR action LIKE 'mailbox.inbound.%')
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listMailboxDiagnostics(input: { tenantId: string; userId?: string }) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tenant_id: string;
      user_id: string | null;
      owner_type: string;
      provider: string;
      address: string;
      display_name: string | null;
      status: string;
      scopes: unknown;
      connected_at: Date | null;
      last_sync_at: Date | null;
      last_send_at: Date | null;
      last_error: string | null;
      updated_at: Date;
    }>
  >`
    SELECT
      id,
      tenant_id,
      user_id,
      owner_type,
      provider,
      address,
      display_name,
      status,
      scopes,
      connected_at,
      last_sync_at,
      last_send_at,
      last_error,
      updated_at
    FROM mailbox_connections
    WHERE tenant_id = ${input.tenantId}
      AND (${input.userId ?? null}::text IS NULL OR user_id = ${input.userId ?? null})
    ORDER BY updated_at DESC
  `;

  return Promise.all(
    rows.map(async (row) => {
      let tokenStatus: "valid" | "needs_reauth" = "valid";
      let tokenScopes: string[] = [];
      let cursorPresent = false;
      let cursorKind: "gmail_history" | "graph_delta" | "none" = "none";
      let tokenError: string | null = null;

      if (!row.user_id) {
        tokenStatus = "needs_reauth";
        tokenError = "Mailbox connection is not assigned to a staff user.";
      } else {
        try {
          const { token } = await readFreshMailboxToken({
            tenantId: row.tenant_id,
            userId: row.user_id,
            connectionId: row.id,
          });
          tokenScopes = normalizeTokenScopes(token);
          cursorPresent = Boolean(token.syncCursor?.gmailHistoryId || token.syncCursor?.graphDeltaLink);
          cursorKind = token.syncCursor?.gmailHistoryId
            ? "gmail_history"
            : token.syncCursor?.graphDeltaLink
              ? "graph_delta"
              : "none";
        } catch (error) {
          tokenStatus = "needs_reauth";
          tokenError = error instanceof Error ? error.message : "Mailbox token could not be read.";
        }
      }

      const lastPollRows = await prisma.$queryRaw<
        Array<{ action: string; metadata: unknown; created_at: Date }>
      >`
        SELECT action, metadata, created_at
        FROM audit_logs
        WHERE tenant_id = ${row.tenant_id}
          AND entity_id = ${row.id}
          AND action IN ('mailbox.sync.completed', 'mailbox.sync.failed')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const inboundCountRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM communications
        WHERE tenant_id = ${row.tenant_id}
          AND channel = 'email'
          AND direction = 'inbound'
          AND mailbox->>'connectionId' = ${row.id}
          AND created_at >= now() - interval '24 hours'
      `;
      const lastPoll = lastPollRows[0];
      const lastPollMetadata = asRecord(lastPoll?.metadata);

      return {
        id: row.id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        ownerType: row.owner_type,
        provider: row.provider,
        address: row.address,
        displayName: row.display_name,
        status: row.status,
        grantedScopes: tokenScopes,
        hasReadScope: hasReadScope(tokenScopes),
        hasSendScope: hasSendScope(tokenScopes),
        tokenStatus,
        cursorPresent,
        cursorKind,
        lastPoll: lastPoll
          ? {
              at: lastPoll.created_at.toISOString(),
              action: lastPoll.action,
              fetched: numberFromMetadata(lastPollMetadata, "fetched", "messageCount"),
              created: numberFromMetadata(lastPollMetadata, "created", "imported"),
              updated: numberFromMetadata(lastPollMetadata, "updated"),
              deduped: numberFromMetadata(lastPollMetadata, "deduped"),
              errors: numberFromMetadata(lastPollMetadata, "errors", "failed"),
            }
          : null,
        inboundLast24h: Number(inboundCountRows[0]?.count ?? 0),
        lastError: tokenError ?? row.last_error,
        connectedAt: row.connected_at?.toISOString(),
        lastSyncAt: row.last_sync_at?.toISOString(),
        lastSendAt: row.last_send_at?.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    })
  );
}

async function syncGmailMessages(
  connectionId: string,
  mailboxAccount: string,
  accessToken: string,
  maxResults: number,
  historyId?: string
): Promise<{ messages: SyncedMailboxMessage[]; nextHistoryId?: string }> {
  if (historyId) {
    try {
      const ids = new Set<string>();
      const seenPageTokens = new Set<string>();
      let pageToken: string | undefined;
      let nextHistoryId: string | undefined;
      do {
        const historyUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
        historyUrl.searchParams.set("startHistoryId", historyId);
        historyUrl.searchParams.set("historyTypes", "messageAdded");
        historyUrl.searchParams.set("maxResults", String(maxResults));
        if (pageToken) historyUrl.searchParams.set("pageToken", pageToken);
        const history = await providerJson<GmailHistoryResponse>(historyUrl.toString(), accessToken);
        uniqueGmailHistoryMessageIds(history).forEach((id) => ids.add(id));
        nextHistoryId = history.historyId ?? nextHistoryId;
        pageToken = history.nextPageToken;
        if (pageToken && seenPageTokens.has(pageToken)) {
          throw new Error("Gmail history returned a repeated continuation token.");
        }
        if (pageToken) seenPageTokens.add(pageToken);
      } while (pageToken);

      const messages = await readGmailMessagesById(ids, accessToken);
      return {
        messages: messages
          .filter((message) => !message.error)
          .map((message) => normalizeGmailMessage(connectionId, mailboxAccount, message)),
        nextHistoryId,
      };
    } catch (error) {
      if (!isExpiredGmailHistoryError(error)) throw error;
      // Gmail history IDs expire. Fall back to a bounded recent scan and reset
      // the cursor to the account's current historyId.
    }
  }

  const nextHistoryId = await readGmailProfileHistoryId(accessToken);
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(maxResults));
  listUrl.searchParams.set("q", "newer_than:1d");
  const list = await providerJson<GmailListResponse>(listUrl.toString(), accessToken);
  const rows = list.messages ?? [];
  const messages = await readGmailMessagesById(rows.map((row) => row.id), accessToken);
  return {
    messages: messages
      .filter((message) => !message.error)
      .map((message) => normalizeGmailMessage(connectionId, mailboxAccount, message)),
    nextHistoryId,
  };
}

async function syncGmailReplyMessages(
  connectionId: string,
  mailboxAccount: string,
  accessToken: string,
  targets: MailboxReplyTarget[]
): Promise<SyncedMailboxMessage[]> {
  const resolvedTargets = [...targets];
  const threadIds = new Set(
    targets.map((target) => target.externalThreadId?.trim()).filter((value): value is string => Boolean(value))
  );

  for (const target of targets) {
    if (target.externalThreadId || !target.rfc822MessageId) continue;
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", "5");
    listUrl.searchParams.set("q", `rfc822msgid:${bareMessageId(target.rfc822MessageId)}`);
    const list = await providerJson<GmailListResponse>(listUrl.toString(), accessToken);
    for (const row of list.messages ?? []) {
      if (!row.threadId) continue;
      threadIds.add(row.threadId);
      resolvedTargets.push({ ...target, externalThreadId: row.threadId });
    }
  }

  const messages = new Map<string, SyncedMailboxMessage>();
  for (const threadId of threadIds) {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`
    );
    url.searchParams.set("format", "full");
    let thread: GmailThreadResponse;
    try {
      thread = await providerJson<GmailThreadResponse>(url.toString(), accessToken);
    } catch (error) {
      // Outbound messages sent before OAuth was connected can carry a
      // transactional-provider thread id. Gmail correctly rejects that id;
      // the exact subject/sender/time recovery pass below can still find the
      // reply in the connected mailbox.
      if (isMissingGmailItemError(error)) continue;
      throw error;
    }
    for (const rawMessage of thread.messages ?? []) {
      if (rawMessage.error) continue;
      const message = normalizeGmailMessage(connectionId, mailboxAccount, rawMessage);
      const matchedTarget = replyTargetForMessage(message, resolvedTargets);
      if (message.direction !== "inbound" || !matchedTarget) continue;
      message.carrierSubmissionId = matchedTarget.carrierSubmissionId;
      messages.set(message.externalMessageId, message);
    }
  }

  // Transactional fallback sends do not receive Gmail thread IDs. Recover
  // those replies with a deliberately narrow query and then verify the exact
  // normalized subject, counterparty address, and send timestamp locally.
  for (const target of targets.filter(isRecoveryReplyTarget)) {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", "20");
    listUrl.searchParams.set("q", gmailRecoveryQuery(target));
    const list = await providerJson<GmailListResponse>(listUrl.toString(), accessToken);
    const rows = await readGmailMessagesById((list.messages ?? []).map((row) => row.id), accessToken);
    for (const row of rows) {
      if (row.error) continue;
      const message = normalizeGmailMessage(connectionId, mailboxAccount, row);
      const matchedTarget = replyTargetForMessage(message, [target]);
      if (message.direction !== "inbound" || !matchedTarget) continue;
      message.carrierSubmissionId = matchedTarget.carrierSubmissionId;
      messages.set(message.externalMessageId, message);
    }
  }
  return [...messages.values()];
}

async function readGmailMessagesById(ids: Iterable<string>, accessToken: string): Promise<GmailMessage[]> {
  return Promise.all(
    Array.from(new Set(Array.from(ids).filter(Boolean))).map(async (id) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
      url.searchParams.set("format", "full");
      try {
        return await providerJson<GmailMessage>(url.toString(), accessToken);
      } catch (error) {
        if (isMissingGmailItemError(error)) {
          return { id, error: { message: "Gmail message is no longer available." } };
        }
        throw error;
      }
    })
  );
}

function uniqueGmailHistoryMessageIds(history: GmailHistoryResponse): string[] {
  const ids = new Set<string>();
  for (const row of history.history ?? []) {
    for (const item of row.messagesAdded ?? []) {
      if (item.message?.id) ids.add(item.message.id);
    }
    for (const message of row.messages ?? []) {
      if (message.id) ids.add(message.id);
    }
  }
  return Array.from(ids);
}

async function readGmailProfileHistoryId(accessToken: string): Promise<string | undefined> {
  const profile = await providerJson<GmailProfileResponse>(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    accessToken
  );
  return profile.historyId;
}

function normalizeGmailMessage(
  connectionId: string,
  mailboxAccount: string,
  message: GmailMessage
): SyncedMailboxMessage {
  const headers = headerMap(message.payload?.headers ?? []);
  const html = findGmailBody(message.payload, "text/html");
  const text = findGmailBody(message.payload, "text/plain");
  const from = headers.get("from") ?? "";
  const to = splitAddressHeader(headers.get("to"));
  const cc = splitAddressHeader(headers.get("cc"));
  const bcc = splitAddressHeader(headers.get("bcc"));
  const labelIds = message.labelIds ?? [];
  const sentAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined;
  const messageIdHeader = headers.get("message-id");
  return {
    mailboxAccount,
    mailboxConnectionId: connectionId,
    provider: "gmail",
    externalMessageId: message.id,
    externalThreadId: message.threadId,
    externalUrl: gmailExactMessageUrl(mailboxAccount, messageIdHeader),
    from,
    to,
    cc,
    bcc,
    subject: headers.get("subject"),
    body: text || stripHtml(html) || message.snippet || "",
    bodyHtml: html,
    rawMimeRef: `gmail://${connectionId}/${message.id}`,
    rfc822MessageId: messageIdHeader,
    messageIdHeader,
    inReplyToHeader: headers.get("in-reply-to"),
    references: splitReferences(headers.get("references")),
    attachments: gmailAttachments(message.payload, message.id),
    snippet: message.snippet,
    isRead: !labelIds.includes("UNREAD"),
    mailboxLabels: labelIds,
    sentAt,
    direction: normalizeEmail(from) === normalizeEmail(mailboxAccount) ? "outbound" : "inbound",
  };
}

async function syncMicrosoftMessages(
  connectionId: string,
  mailboxAccount: string,
  accessToken: string,
  maxResults: number,
  deltaLink?: string
): Promise<{ messages: SyncedMailboxMessage[]; nextDeltaLink?: string }> {
  const initialUrl = deltaLink
    ? new URL(deltaLink)
    : new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta");
  if (!deltaLink) {
    initialUrl.searchParams.set("$top", String(maxResults));
    initialUrl.searchParams.set(
      "$select",
      "id,conversationId,webLink,from,toRecipients,ccRecipients,bccRecipients,subject,body,bodyPreview,receivedDateTime,sentDateTime,isRead,parentFolderId,internetMessageId,internetMessageHeaders,hasAttachments"
    );
  }
  const messages: GraphMessage[] = [];
  const seenLinks = new Set<string>();
  let nextLink: string | undefined = initialUrl.toString();
  let nextDeltaLink: string | undefined;
  while (nextLink) {
    if (seenLinks.has(nextLink)) throw new Error("Microsoft Graph delta returned a repeated continuation link.");
    seenLinks.add(nextLink);
    const list: GraphMessageList = await providerJson<GraphMessageList>(nextLink, accessToken);
    messages.push(...(list.value ?? []));
    nextDeltaLink = list["@odata.deltaLink"] ?? nextDeltaLink;
    nextLink = list["@odata.nextLink"];
  }
  if (!nextDeltaLink) {
    throw new Error("Microsoft Graph delta did not return a terminal delta link.");
  }
  return {
    messages: await Promise.all(
      messages.map((message) => normalizeGraphMessage(connectionId, mailboxAccount, accessToken, message))
    ),
    nextDeltaLink,
  };
}

async function syncMicrosoftReplyMessages(
  connectionId: string,
  mailboxAccount: string,
  accessToken: string,
  targets: MailboxReplyTarget[]
): Promise<SyncedMailboxMessage[]> {
  const resolvedTargets = [...targets];
  const conversationIds = new Set(
    targets.map((target) => target.externalThreadId?.trim()).filter((value): value is string => Boolean(value))
  );

  for (const target of targets) {
    if (target.externalThreadId || !target.rfc822MessageId) continue;
    const rootUrl = graphMessageListUrl(
      `internetMessageId eq '${escapeODataString(normalizeMessageId(target.rfc822MessageId))}'`,
      5
    );
    const rootMessages = await readGraphMessagePages(rootUrl, accessToken);
    for (const message of rootMessages) {
      if (!message.conversationId) continue;
      conversationIds.add(message.conversationId);
      resolvedTargets.push({ ...target, externalThreadId: message.conversationId });
    }
  }

  const messages = new Map<string, SyncedMailboxMessage>();
  for (const conversationId of conversationIds) {
    const listUrl = graphMessageListUrl(
      `conversationId eq '${escapeODataString(conversationId)}'`,
      50
    );
    const rows = await readGraphMessagePages(listUrl, accessToken);
    for (const row of rows) {
      const message = await normalizeGraphMessage(connectionId, mailboxAccount, accessToken, row);
      const matchedTarget = replyTargetForMessage(message, resolvedTargets);
      if (message.direction !== "inbound" || !matchedTarget) continue;
      message.carrierSubmissionId = matchedTarget.carrierSubmissionId;
      messages.set(message.externalMessageId, message);
    }
  }

  for (const target of targets.filter(isRecoveryReplyTarget)) {
    const sentTime = Date.parse(target.sentAt ?? "");
    if (!Number.isFinite(sentTime)) continue;
    const since = new Date(sentTime - 300_000).toISOString();
    const rows = await readGraphMessagePages(
      graphMessageListUrl(`receivedDateTime ge ${since}`, 100),
      accessToken
    );
    for (const row of rows) {
      const message = await normalizeGraphMessage(connectionId, mailboxAccount, accessToken, row);
      const matchedTarget = replyTargetForMessage(message, [target]);
      if (message.direction !== "inbound" || !matchedTarget) continue;
      message.carrierSubmissionId = matchedTarget.carrierSubmissionId;
      messages.set(message.externalMessageId, message);
    }
  }
  return [...messages.values()];
}

function graphMessageListUrl(filter: string, top: number): URL {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$top", String(top));
  url.searchParams.set(
    "$select",
    "id,conversationId,webLink,from,toRecipients,ccRecipients,bccRecipients,subject,body,bodyPreview,receivedDateTime,sentDateTime,isRead,parentFolderId,internetMessageId,internetMessageHeaders,hasAttachments"
  );
  return url;
}

async function readGraphMessagePages(initialUrl: URL, accessToken: string): Promise<GraphMessage[]> {
  const messages: GraphMessage[] = [];
  const seenLinks = new Set<string>();
  let nextLink: string | undefined = initialUrl.toString();
  while (nextLink) {
    if (seenLinks.has(nextLink)) throw new Error("Microsoft Graph returned a repeated continuation link.");
    seenLinks.add(nextLink);
    const list: GraphMessageList = await providerJson<GraphMessageList>(nextLink, accessToken);
    messages.push(...(list.value ?? []));
    nextLink = list["@odata.nextLink"];
  }
  return messages;
}

async function normalizeGraphMessage(
  connectionId: string,
  mailboxAccount: string,
  accessToken: string,
  message: GraphMessage
): Promise<SyncedMailboxMessage> {
  const headers = headerMap(message.internetMessageHeaders ?? []);
  const attachments = message.hasAttachments
    ? await graphAttachments(message.id, accessToken)
    : [];
  const from = formatGraphAddress(message.from);
  const html = message.body?.contentType?.toLowerCase() === "html" ? message.body?.content ?? "" : undefined;
  const text = message.body?.contentType?.toLowerCase() === "text" ? message.body?.content ?? "" : stripHtml(html ?? "");
  const messageIdHeader = message.internetMessageId ?? headers.get("message-id");
  return {
    mailboxAccount,
    mailboxConnectionId: connectionId,
    provider: "outlook",
    externalMessageId: message.id,
    externalThreadId: message.conversationId,
    externalUrl: message.webLink,
    from,
    to: (message.toRecipients ?? []).map(formatGraphAddress).filter(Boolean),
    cc: (message.ccRecipients ?? []).map(formatGraphAddress).filter(Boolean),
    bcc: (message.bccRecipients ?? []).map(formatGraphAddress).filter(Boolean),
    subject: message.subject,
    body: text || message.bodyPreview || "",
    bodyHtml: html,
    rawMimeRef: `graph://${connectionId}/${message.id}`,
    rfc822MessageId: messageIdHeader,
    messageIdHeader,
    inReplyToHeader: headers.get("in-reply-to"),
    references: splitReferences(headers.get("references")),
    attachments,
    snippet: message.bodyPreview,
    isRead: message.isRead,
    mailboxLabels: message.parentFolderId ? [message.parentFolderId] : undefined,
    sentAt: message.sentDateTime ?? message.receivedDateTime,
    direction: normalizeEmail(from) === normalizeEmail(mailboxAccount) ? "outbound" : "inbound",
  };
}

async function graphAttachments(messageId: string, accessToken: string): Promise<SyncedMailboxAttachment[]> {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments`);
  url.searchParams.set("$top", "25");
  const list = await providerJson<GraphAttachmentList>(url.toString(), accessToken);
  return (list.value ?? []).map((attachment) => ({
    id: attachment.id ?? `graph_attachment_${messageId}_${attachment.name ?? "file"}`,
    fileName: attachment.name ?? "attachment",
    fileType: attachment.contentType ?? "application/octet-stream",
    sizeBytes: attachment.size,
    dataUrl:
      attachment.contentBytes && attachment.contentType
        ? `data:${attachment.contentType};base64,${attachment.contentBytes}`
        : undefined,
    storagePath: attachment.contentBytes ? undefined : `graph://${messageId}/${attachment.id ?? attachment.name}`,
  }));
}

function uniqueReplyTargets(targets: MailboxReplyTarget[]): MailboxReplyTarget[] {
  const unique = new Map<string, MailboxReplyTarget>();
  for (const target of targets) {
    const externalThreadId = target.externalThreadId?.trim() || undefined;
    const rfc822MessageId = target.rfc822MessageId?.trim() || undefined;
    const subject = target.subject?.trim() || undefined;
    const participantEmail = normalizeEmail(target.participantEmail);
    const sentAt = target.sentAt?.trim() || undefined;
    const communicationId = target.communicationId?.trim() || undefined;
    if (!communicationId && !externalThreadId && !rfc822MessageId && !(subject && participantEmail && sentAt)) continue;
    const key = [
      externalThreadId ?? "",
      canonicalMessageId(rfc822MessageId),
      normalizeReplySubject(subject),
      participantEmail,
      sentAt ?? "",
      communicationId ?? "",
    ].join("|");
    unique.set(key, {
      communicationId,
      externalThreadId,
      rfc822MessageId,
      sentAt,
      subject,
      participantEmail: participantEmail || undefined,
      carrierSubmissionId: target.carrierSubmissionId?.trim() || undefined,
    });
  }
  return [...unique.values()];
}

async function resolveAuthorizedReplyGroups(
  input: MailboxReplySyncInput,
  targets: MailboxReplyTarget[]
): Promise<AuthorizedReplyGroup[]> {
  const communicationIds = [...new Set(
    targets.map((target) => target.communicationId?.trim()).filter((value): value is string => Boolean(value))
  )];

  if (communicationIds.length === 0) {
    const { connection } = await readFreshMailboxToken(input);
    return [{
      userId: input.userId,
      connectionId: connection.id,
      expectedAddress: connection.address,
      targets,
    }];
  }
  if (communicationIds.length !== targets.length) {
    throw new Error("Every carrier reply target must identify its original outbound message.");
  }

  // Exact carrier checks are routed exclusively from the server-owned send
  // record. A browser-provided connection hint must never override or narrow
  // the original sender mailbox selected here.
  const requestedConnectionId = null;
  const canonicalRows = await prisma.$queryRaw<CanonicalReplyTargetRow[]>`
    SELECT
      mailbox_connection.id AS connection_id,
      mailbox_connection.user_id AS user_id,
      mailbox_connection.address,
      mailbox_connection.provider,
      communication.id AS communication_id,
      communication.subject,
      communication.message_id_header,
      communication.external_recipient_email,
      communication.to_recipients,
      communication.sent_at,
      communication.created_at,
      communication.mailbox,
      communication.resolution
    FROM communications AS communication
    JOIN mailbox_connections AS mailbox_connection
      ON mailbox_connection.tenant_id = communication.tenant_id
      AND mailbox_connection.owner_type = 'staff'
      AND mailbox_connection.status = 'connected'
      AND mailbox_connection.id = communication.mailbox->>'connectionId'
      AND lower(mailbox_connection.address) = lower(communication.mailbox->>'account')
    WHERE communication.tenant_id = ${input.tenantId}
      AND communication.id IN (${Prisma.join(communicationIds)})
      AND communication.channel = 'email'
      AND communication.direction = 'outbound'
      AND communication.mailbox->>'origin' = 'provider_send'
      AND communication.resolution->>'verifiedOutbound' = 'true'
      AND (${requestedConnectionId}::text IS NULL OR mailbox_connection.id = ${requestedConnectionId})
  `;

  const canonicalById = new Map(canonicalRows.map((row) => [row.communication_id, row]));
  const missingIds = communicationIds.filter((communicationId) => !canonicalById.has(communicationId));
  if (missingIds.length > 0) {
    const legacyRows = await resolveLegacyReplyTargets(input, missingIds, requestedConnectionId);
    legacyRows.forEach((row) => canonicalById.set(row.communication_id, row));
  }
  if (communicationIds.some((communicationId) => !canonicalById.has(communicationId))) {
    throw new Error("The carrier reply check could not verify the original outbound carrier email.");
  }

  const groups = new Map<string, AuthorizedReplyGroup>();
  for (const communicationId of communicationIds) {
    const row = canonicalById.get(communicationId)!;
    const target = canonicalTargetFromRow(row);
    if (!target.externalThreadId && !target.rfc822MessageId && !isRecoveryReplyTarget(target)) {
      throw new Error("The original carrier email is missing the provider identifiers required to check replies.");
    }
    const existing = groups.get(row.connection_id);
    if (existing) existing.targets.push(target);
    else groups.set(row.connection_id, {
      userId: row.user_id,
      connectionId: row.connection_id,
      expectedAddress: row.address,
      targets: [target],
    });
  }
  return [...groups.values()];
}

function canonicalTargetFromRow(row: CanonicalReplyTargetRow): MailboxReplyTarget {
  const mailbox = asRecord(row.mailbox);
  const resolution = asRecord(row.resolution);
  const recipients = stringArray(row.to_recipients);
  const sentAt = dateValue(row.sent_at) ?? dateValue(row.created_at);
  return {
    communicationId: row.communication_id,
    externalThreadId: optionalString(mailbox.externalThreadId),
    rfc822MessageId: row.message_id_header ?? optionalString(mailbox.rfc822MessageId),
    sentAt: sentAt?.toISOString(),
    subject: row.subject ?? undefined,
    participantEmail: row.external_recipient_email ?? recipients[0],
    carrierSubmissionId: optionalString(resolution.carrierSubmissionId),
  };
}

async function resolveLegacyReplyTargets(
  input: MailboxReplySyncInput,
  communicationIds: string[],
  requestedConnectionId: string | null
): Promise<CanonicalReplyTargetRow[]> {
  if (!supabaseStateConfigured()) return [];
  const stateId = process.env.STATE_SYNC_ID?.trim() || process.env.VITE_STATE_SYNC_ID?.trim() || "default";
  const state = await readRemoteState(`app_state:${stateId}`).catch(() => null);
  const snapshot = asRecord(state?.snapshot);
  const communications = objectArray(snapshot.communications);
  const carrierContacts = objectArray(snapshot.carrierContacts);
  const byId = new Map(communications.map((row) => [stringValue(row.id), row]));
  const validIds = communicationIds.filter((communicationId) => {
    const row = byId.get(communicationId);
    return row &&
      stringValue(row.tenantId) === input.tenantId &&
      stringValue(row.channel) === "email" &&
      stringValue(row.direction) === "outbound";
  });
  if (validIds.length === 0) return [];

  const auditRows = await prisma.$queryRaw<AuthorizedReplyMailbox[]>`
    SELECT DISTINCT ON (audit.metadata->>'communicationId')
      mailbox_connection.id AS connection_id,
      mailbox_connection.user_id AS user_id,
      mailbox_connection.address,
      audit.metadata->>'communicationId' AS communication_id
    FROM audit_logs AS audit
    JOIN mailbox_connections AS mailbox_connection
      ON mailbox_connection.tenant_id = audit.tenant_id
      AND mailbox_connection.owner_type = 'staff'
      AND mailbox_connection.status = 'connected'
      AND mailbox_connection.user_id = COALESCE(NULLIF(audit.metadata->>'userId', ''), audit.actor_id)
      AND lower(mailbox_connection.address) = lower(audit.metadata->>'mailboxAccount')
    WHERE audit.tenant_id = ${input.tenantId}
      AND audit.action IN ('mailbox.reply_route.created', 'mailbox.reply_route.unavailable')
      AND audit.metadata->>'communicationId' IN (${Prisma.join(validIds)})
      AND (${requestedConnectionId}::text IS NULL OR mailbox_connection.id = ${requestedConnectionId})
    ORDER BY audit.metadata->>'communicationId', audit.created_at DESC, mailbox_connection.updated_at DESC
  `;

  return auditRows.flatMap((audit) => {
    const communication = byId.get(audit.communication_id);
    if (!communication) return [];
    const carrierContactId = optionalString(communication.carrierContactId);
    const carrierContact = carrierContactId
      ? carrierContacts.find((row) => stringValue(row.id) === carrierContactId)
      : undefined;
    const to = stringArray(communication.to);
    const participantEmail = optionalString(communication.externalRecipientEmail) ||
      to[0] || optionalString(carrierContact?.email);
    const mailbox = {
      origin: "legacy_verified_send",
      account: audit.address,
      connectionId: audit.connection_id,
      externalThreadId: optionalString(communication.externalThreadId),
      rfc822MessageId: optionalString(communication.rfc822MessageId) || optionalString(communication.messageIdHeader),
    };
    return [{
      ...audit,
      provider: "",
      subject: optionalString(communication.subject) || null,
      message_id_header: optionalString(communication.rfc822MessageId) || optionalString(communication.messageIdHeader) || null,
      external_recipient_email: participantEmail || null,
      to_recipients: to,
      sent_at: dateValue(communication.createdAt),
      created_at: dateValue(communication.createdAt) ?? new Date(),
      mailbox,
      resolution: { carrierSubmissionId: optionalString(communication.carrierSubmissionId) },
    }];
  });
}

function replyTargetForMessage(
  message: SyncedMailboxMessage,
  targets: MailboxReplyTarget[]
): MailboxReplyTarget | undefined {
  const replyMessageIds = new Set(
    [message.inReplyToHeader, ...(message.references ?? [])]
      .map(canonicalMessageId)
      .filter(Boolean)
  );
  for (const target of targets) {
    const targetMessageId = canonicalMessageId(target.rfc822MessageId);
    if (targetMessageId && replyMessageIds.has(targetMessageId)) return target;
    if (target.externalThreadId && message.externalThreadId === target.externalThreadId) {
      if (!target.sentAt || !message.sentAt) return target;
      const targetTime = Date.parse(target.sentAt);
      const messageTime = Date.parse(message.sentAt);
      if (!Number.isFinite(targetTime) || !Number.isFinite(messageTime) || messageTime >= targetTime - 300_000) {
        return target;
      }
    }
    if (!isRecoveryReplyTarget(target)) continue;
    if (normalizeReplySubject(message.subject) !== normalizeReplySubject(target.subject)) continue;
    if (normalizeEmail(message.from) !== normalizeEmail(target.participantEmail)) continue;
    const targetTime = Date.parse(target.sentAt ?? "");
    const messageTime = Date.parse(message.sentAt ?? "");
    if (Number.isFinite(targetTime) && Number.isFinite(messageTime) && messageTime >= targetTime - 300_000) {
      return target;
    }
  }
  return undefined;
}

function isRecoveryReplyTarget(target: MailboxReplyTarget): boolean {
  return Boolean(target.subject?.trim() && normalizeEmail(target.participantEmail) && target.sentAt?.trim());
}

function normalizeReplySubject(value?: string): string {
  return (value ?? "")
    .trim()
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function gmailRecoveryQuery(target: MailboxReplyTarget): string {
  const subject = normalizeReplySubject(target.subject).replace(/([\\"])/g, "\\$1");
  const sentTime = Date.parse(target.sentAt ?? "");
  const after = Number.isFinite(sentTime)
    ? new Date(sentTime - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "/")
    : undefined;
  return [
    "in:anywhere",
    `from:${normalizeEmail(target.participantEmail)}`,
    `subject:\"${subject}\"`,
    after ? `after:${after}` : "",
  ].filter(Boolean).join(" ");
}

function canonicalMessageId(value?: string): string {
  return bareMessageId(value ?? "").toLowerCase();
}

function bareMessageId(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

function normalizeMessageId(value: string): string {
  const bare = bareMessageId(value);
  return bare ? `<${bare}>` : "";
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function providerJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json().catch(() => null)) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new MailboxProviderHttpError(
      json?.error?.message ?? `Mailbox sync failed with ${res.status}.`,
      res.status
    );
  }
  return json;
}

class MailboxProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MailboxProviderHttpError";
  }
}

function isExpiredGmailHistoryError(error: unknown): boolean {
  return error instanceof MailboxProviderHttpError && error.status === 404;
}

function isMissingGmailItemError(error: unknown): boolean {
  return error instanceof MailboxProviderHttpError && (error.status === 400 || error.status === 404);
}

function findGmailBody(part: GmailPart | undefined, mimeType: string): string {
  if (!part) return "";
  if (part.mimeType === mimeType && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const value = findGmailBody(child, mimeType);
    if (value) return value;
  }
  return "";
}

function gmailAttachments(part: GmailPart | undefined, messageId: string): SyncedMailboxAttachment[] {
  if (!part) return [];
  const current =
    part.filename && part.body
      ? [
          {
            id: `gmail_attachment_${messageId}_${part.partId ?? part.filename}`,
            fileName: part.filename,
            fileType: part.mimeType ?? "application/octet-stream",
            sizeBytes: part.body.size,
            dataUrl: part.body.data
              ? `data:${part.mimeType ?? "application/octet-stream"};base64,${base64UrlToBase64(part.body.data)}`
              : undefined,
            storagePath: part.body.attachmentId ? `gmail://${messageId}/${part.body.attachmentId}` : undefined,
          },
        ]
      : [];
  return [...current, ...(part.parts ?? []).flatMap((child) => gmailAttachments(child, messageId))];
}

function headerMap(headers: { name: string; value: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  headers.forEach((header) => map.set(header.name.toLowerCase(), header.value));
  return map;
}

function splitAddressHeader(value?: string): string[] {
  return (value ?? "")
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitReferences(value?: string): string[] {
  return (value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatGraphAddress(value?: GraphRecipient): string {
  const address = value?.emailAddress?.address?.trim();
  const name = value?.emailAddress?.name?.trim();
  if (!address) return "";
  return name && name !== address ? `${name} <${address}>` : address;
}

function normalizeEmail(value?: string): string {
  const raw = (value ?? "").trim();
  const bracketed = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const email = bracketed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  return (email ?? bracketed).trim().toLowerCase();
}

function decodeBase64Url(value: string): string {
  return Buffer.from(base64UrlToBase64(value), "base64").toString("utf8");
}

function base64UrlToBase64(value: string): string {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/");
  return clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "=");
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function markConnectionSynced(connectionId: string) {
  await prisma.$executeRaw`
    UPDATE mailbox_connections
    SET last_sync_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE id = ${connectionId}
  `;
}

async function persistSyncedMailboxMessages(
  connection: MailboxConnectionForPersistence,
  messages: SyncedMailboxMessage[]
): Promise<MailboxSyncImportSummary> {
  const summary: MailboxSyncImportSummary = { imported: 0, updated: 0, deduped: 0, failed: 0 };
  for (const message of messages) {
    if (message.direction === "inbound") {
      await recordInboundAttempt(connection, message, "received");
    }
    try {
      const result = await upsertSyncedCommunication(connection, message);
      if (result === "inserted") summary.imported += 1;
      else if (result === "updated") summary.updated += 1;
      else summary.deduped += 1;
      if (message.direction === "inbound") {
        await recordInboundAttempt(connection, message, result === "inserted" || result === "updated" ? "linked" : "deduped");
      }
    } catch (error) {
      summary.failed += 1;
      if (message.direction === "inbound") {
        await recordInboundAttempt(connection, message, "failed", error instanceof Error ? error.message : "Inbound import failed.");
      }
    }
  }
  return summary;
}

async function upsertSyncedCommunication(
  connection: MailboxConnectionForPersistence,
  message: SyncedMailboxMessage
): Promise<"inserted" | "updated" | "deduped"> {
  const mailboxAccount = message.mailboxAccount || connection.address;
  const mailboxAddress = normalizeEmail(mailboxAccount);
  const provider = message.provider;
  const from = normalizeEmail(message.from);
  const recipients = [...message.to, ...(message.cc ?? [])].map(normalizeEmail).filter(Boolean);
  const direction = message.direction ?? (from === mailboxAddress ? "outbound" : "inbound");
  const contactEmail = direction === "outbound" ? recipients.find((email) => email !== mailboxAddress) : from;

  const existing = await findExistingCommunication(connection.tenant_id, mailboxAddress, message);
  const mailbox = {
    origin: "provider_sync",
    account: mailboxAccount,
    provider,
    connectionId: connection.id,
    externalMessageId: message.externalMessageId,
    externalThreadId: message.externalThreadId,
    externalUrl: message.externalUrl,
    rawMimeRef: message.rawMimeRef,
    rfc822MessageId: message.rfc822MessageId ?? message.messageIdHeader,
  };
  const resolution = message.carrierSubmissionId
    ? { carrierSubmissionId: message.carrierSubmissionId, matchedBy: "mailbox_reply_target" }
    : undefined;

  if (existing) {
    await prisma.$executeRaw`
      UPDATE communications
      SET subject = COALESCE(${message.subject ?? null}, subject),
          body = ${message.body},
          body_html = ${message.bodyHtml ?? null},
          raw_mime_ref = ${message.rawMimeRef ?? null},
          message_id_header = COALESCE(${message.messageIdHeader ?? null}, message_id_header),
          in_reply_to_header = ${message.inReplyToHeader ?? null},
          reference_headers = ${JSON.stringify(message.references ?? [])}::jsonb,
          to_recipients = ${JSON.stringify(message.to)}::jsonb,
          cc_recipients = ${JSON.stringify(message.cc ?? [])}::jsonb,
          bcc_recipients = ${JSON.stringify(message.bcc ?? [])}::jsonb,
          attachments = ${JSON.stringify(message.attachments ?? [])}::jsonb,
          snippet = ${message.snippet ?? null},
          is_read = ${message.isRead ?? false},
          mailbox_labels = ${JSON.stringify(message.mailboxLabels ?? [])}::jsonb,
          mailbox = COALESCE(mailbox, '{}'::jsonb) || ${JSON.stringify(mailbox)}::jsonb,
          resolution = COALESCE(resolution, '{}'::jsonb) || ${JSON.stringify(resolution ?? {})}::jsonb,
          sent_at = COALESCE(${message.sentAt ? new Date(message.sentAt) : null}, sent_at),
          updated_at = now()
      WHERE id = ${existing.id}
        AND tenant_id = ${connection.tenant_id}
    `;
    return "updated";
  }

  const contact = contactEmail
    ? await resolveServerEmailContact(connection.tenant_id, contactEmail, message, direction)
    : {
        externalRecipientEmail: null,
        externalRecipientName: "Unassigned mailbox message",
        externalRecipientRole: "Unassigned",
      };
  const threadId = await resolveServerThreadId(
    connection.tenant_id,
    connection.id,
    provider,
    contactEmail || `unassigned:${message.externalMessageId}`,
    message
  );
  const id = `comm_${randomUUID()}`;
  const createdAt = message.sentAt ? new Date(message.sentAt) : new Date();
  await prisma.$executeRaw`
    INSERT INTO communications (
      id,
      tenant_id,
      customer_id,
      prospect_id,
      carrier_contact_id,
      external_recipient_name,
      external_recipient_email,
      external_recipient_role,
      channel,
      direction,
      subject,
      thread_id,
      mailbox,
      resolution,
      attachments,
      body,
      body_html,
      raw_mime_ref,
      message_id_header,
      in_reply_to_header,
      reference_headers,
      to_recipients,
      cc_recipients,
      bcc_recipients,
      snippet,
      is_read,
      mailbox_labels,
      sent_at,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${connection.tenant_id},
      ${"customerId" in contact ? contact.customerId : null},
      ${null},
      ${null},
      ${"externalRecipientName" in contact ? contact.externalRecipientName : null},
      ${"externalRecipientEmail" in contact ? contact.externalRecipientEmail : null},
      ${"externalRecipientRole" in contact ? contact.externalRecipientRole : null},
      ${"email"},
      ${direction},
      ${message.subject ?? null},
      ${threadId},
      ${JSON.stringify(mailbox)}::jsonb,
      ${JSON.stringify(resolution ?? {})}::jsonb,
      ${JSON.stringify(message.attachments ?? [])}::jsonb,
      ${message.body},
      ${message.bodyHtml ?? null},
      ${message.rawMimeRef ?? null},
      ${message.messageIdHeader ?? null},
      ${message.inReplyToHeader ?? null},
      ${JSON.stringify(message.references ?? [])}::jsonb,
      ${JSON.stringify(message.to)}::jsonb,
      ${JSON.stringify(message.cc ?? [])}::jsonb,
      ${JSON.stringify(message.bcc ?? [])}::jsonb,
      ${message.snippet ?? null},
      ${message.isRead ?? false},
      ${JSON.stringify(message.mailboxLabels ?? [])}::jsonb,
      ${message.sentAt ? new Date(message.sentAt) : null},
      ${createdAt},
      now()
    )
  `;

  return "inserted";
}

async function findExistingCommunication(
  tenantId: string,
  mailboxAddress: string,
  message: SyncedMailboxMessage
): Promise<ExistingCommunicationRow | null> {
  const rows = await prisma.$queryRaw<ExistingCommunicationRow[]>`
    SELECT id, thread_id, message_id_header, in_reply_to_header, reference_headers, mailbox
    FROM communications
    WHERE tenant_id = ${tenantId}
      AND channel = 'email'
      AND (
        mailbox->>'externalMessageId' = ${message.externalMessageId}
        OR (${message.messageIdHeader ?? null}::text IS NOT NULL AND message_id_header = ${message.messageIdHeader ?? null})
      )
      AND COALESCE(lower(mailbox->>'account'), '') = ${mailboxAddress}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function resolveServerThreadId(
  tenantId: string,
  connectionId: string,
  provider: "gmail" | "outlook",
  contactEmail: string,
  message: SyncedMailboxMessage
): Promise<string> {
  const referencedHeaders = new Set(
    [message.inReplyToHeader, ...(message.references ?? [])]
      .map((value) => normalizeMessageHeaderId(value))
      .filter(Boolean)
  );
  const rows = await prisma.$queryRaw<ExistingCommunicationRow[]>`
    SELECT id, thread_id, message_id_header, in_reply_to_header, reference_headers, mailbox
    FROM communications
    WHERE tenant_id = ${tenantId}
      AND channel = 'email'
      AND mailbox->>'connectionId' = ${connectionId}
    ORDER BY created_at DESC
    LIMIT 500
  `;
  const matched = rows.find((row) => {
    const mailbox = asRecord(row.mailbox);
    if (message.externalThreadId && mailbox.externalThreadId === message.externalThreadId) return true;
    const rowHeaders = [
      row.message_id_header,
      row.in_reply_to_header,
      ...(Array.isArray(row.reference_headers) ? row.reference_headers : []),
    ].map((value) => normalizeMessageHeaderId(typeof value === "string" ? value : undefined));
    return rowHeaders.some((value) => value && referencedHeaders.has(value));
  });
  if (matched?.thread_id) return matched.thread_id;

  const subjectKey = (message.subject ?? "message")
    .trim()
    .toLowerCase()
    .replace(/^re:\s*/i, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
  return message.externalThreadId
    ? `provider:${provider}:${message.externalThreadId}`
    : `provider:${provider}:${contactEmail}:${subjectKey}`;
}

async function resolveServerEmailContact(
  tenantId: string,
  email: string,
  message: SyncedMailboxMessage,
  direction: "inbound" | "outbound"
): Promise<ResolvedContact> {
  const target = normalizeEmail(email);
  const customers = await prisma.$queryRaw<Array<{ id: string; email: string; additional_contacts: unknown }>>`
    SELECT id, email, additional_contacts
    FROM customer_profiles
    WHERE tenant_id = ${tenantId}
      AND archived = false
  `;
  const customer = customers.find((row) => {
    if (normalizeEmail(row.email) === target) return true;
    return additionalContactEmails(row.additional_contacts).some((item) => item === target);
  });
  if (customer) return { customerId: customer.id };

  return {
    externalRecipientEmail: target,
    externalRecipientName: displayNameFromEmailHeader(direction === "inbound" ? message.from : undefined) ?? target,
    externalRecipientRole: "External contact",
  };
}

function additionalContactEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const email = (item as { email?: unknown }).email;
      return typeof email === "string" ? normalizeEmail(email) : "";
    })
    .filter(Boolean);
}

async function recordInboundAttempt(
  connection: MailboxConnectionForPersistence,
  message: SyncedMailboxMessage,
  status: "received" | "linked" | "deduped" | "failed",
  reason?: string
) {
  await recordMailboxAudit({
    tenantId: connection.tenant_id,
    actorId: connection.user_id ?? "mailbox-sync",
    action: `mailbox.inbound.${status}`,
    entityId: message.externalMessageId,
    metadata: {
      status,
      reason,
      mailboxAccount: message.mailboxAccount || connection.address,
      provider: message.provider,
      connectionId: connection.id,
      externalThreadId: message.externalThreadId,
      messageIdHeader: message.messageIdHeader,
      from: message.from,
      to: message.to,
      subject: message.subject,
      sentAt: message.sentAt,
    },
  });
}

async function recordMailboxAudit(input: {
  tenantId: string;
  actorId: string;
  action: string;
  entityId: string;
  metadata: Record<string, unknown>;
}) {
  await prisma.$executeRaw`
    INSERT INTO audit_logs (id, tenant_id, actor_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (
      ${`audit_${randomUUID()}`},
      ${input.tenantId},
      ${input.actorId},
      ${input.action},
      ${"mailbox"},
      ${input.entityId},
      ${JSON.stringify(input.metadata)}::jsonb,
      now()
    )
  `;
}

async function markConnectionError(connectionId: string, message: string) {
  await prisma.$executeRaw`
    UPDATE mailbox_connections
    SET last_error = ${message},
        updated_at = now()
    WHERE id = ${connectionId}
  `;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const result = stringValue(value);
  return result || undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeTokenScopes(token: OAuthTokenPayload): string[] {
  return (token.scope ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasReadScope(scopes: string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.toLowerCase();
    return (
      normalized === "read" ||
      normalized === "sync" ||
      normalized.includes("gmail.readonly") ||
      normalized.includes("gmail.modify") ||
      normalized === "mail.read" ||
      normalized === "mail.readwrite" ||
      normalized.endsWith("/mail.read") ||
      normalized.endsWith("/mail.readwrite")
    );
  });
}

function hasSendScope(scopes: string[]): boolean {
  return scopes.some((scope) => {
    const normalized = scope.toLowerCase();
    return (
      normalized === "send" ||
      normalized.includes("gmail.send") ||
      normalized === "mail.send" ||
      normalized.endsWith("/mail.send")
    );
  });
}

function numberFromMetadata(metadata: Record<string, unknown>, primary: string, fallback?: string): number {
  const value = metadata[primary] ?? (fallback ? metadata[fallback] : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function gmailExactMessageUrl(mailboxAccount: string, messageIdHeader?: string): string | undefined {
  const rfc822MessageId = normalizeRfc822MessageId(messageIdHeader);
  if (!rfc822MessageId) return undefined;
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(
    mailboxAccount
  )}#search/rfc822msgid:${encodeURIComponent(rfc822MessageId)}`;
}

function normalizeRfc822MessageId(value?: string): string {
  return (value ?? "").trim().replace(/^<+/, "").replace(/>+$/, "");
}

function normalizeMessageHeaderId(value?: string): string {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function displayNameFromEmailHeader(value?: string): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const name = raw.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (!name || normalizeEmail(name) === normalizeEmail(raw)) return null;
  return name;
}
