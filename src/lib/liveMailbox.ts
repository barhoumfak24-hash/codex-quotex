import { api } from "@/lib/api";
import { apiBaseUrl } from "@/lib/apiBase";
import { serverSessionHeaders } from "@/lib/serverSession";
import type { Communication, CommunicationAttachment, MailboxOutboxJob, User } from "@/types";

export type LiveMailboxSendResult =
  | { ok: true; skipped?: "no_outbox" | "already_sent" | "already_sending"; provider?: LiveProviderResult }
  | { ok: false; message: string };

type LiveProviderResult = {
  provider?: "google" | "microsoft" | "transactional";
  status?: "sent";
  externalMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
  rfc822MessageId?: string;
  messageIdHeader?: string;
  fallbackReason?: string;
};

export type LiveMailboxCapability = {
  mailboxConnected: boolean;
  inboxSyncConnected?: boolean;
  inboxSyncProvider?: string | null;
  carrierReplyRelayConfigured?: boolean;
  transactionalConfigured: boolean;
  transactionalProvider: string;
  missingEnvironmentVariables: string[];
  acceptedConfigurations: string[][];
};

const capabilityCache = new Map<string, Promise<LiveMailboxCapability>>();
const retryInFlight = new Set<string>();

const OUTBOX_RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function getLiveMailboxCapability(input: {
  tenantId: string;
  user: User;
  refresh?: boolean;
}): Promise<LiveMailboxCapability> {
  const key = `${input.tenantId}:${input.user.id}`;
  if (input.refresh) capabilityCache.delete(key);
  const cached = capabilityCache.get(key);
  if (cached) return cached;
  const request = fetch(`${apiBaseUrl()}/mailboxes/capability`, {
    method: "GET",
    headers: authHeaders(input.user, input.tenantId),
  })
    .then(async (response) => {
      const json = (await response.json().catch(() => null)) as
        | { ok: true; capability: LiveMailboxCapability }
        | { ok: false; message?: string }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error(
          (json && "message" in json && json.message) ||
            `Email delivery status could not be checked (${response.status}).`
        );
      }
      return json.capability;
    })
    .catch((error) => {
      capabilityCache.delete(key);
      throw error;
    });
  capabilityCache.set(key, request);
  return request;
}

export function capabilityCanSendEmail(capability: LiveMailboxCapability | null | undefined) {
  return Boolean(capability?.mailboxConnected || capability?.transactionalConfigured);
}

export async function sendCommunicationThroughLiveMailbox(input: {
  tenantId: string;
  user: User;
  communication: Communication;
}): Promise<LiveMailboxSendResult> {
  const job = input.communication.outboxJobId
    ? api.mailboxOutbox.get(input.communication.outboxJobId)
    : undefined;
  if (!job) return { ok: true, skipped: "no_outbox" };
  if (job.status === "sent") return { ok: true, skipped: "already_sent" };
  if (job.status === "sending") {
    return waitForExistingDelivery(job.id);
  }
  if (job.to.length === 0) {
    const message = job.lastError ?? "No recipient email address was available.";
    scheduleOutboxRetry(job.id, message);
    return { ok: false, message };
  }

  api.mailboxOutbox.markSending(job.id);
  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/send`, {
      method: "POST",
      headers: authHeaders(input.user, input.tenantId),
      body: JSON.stringify(mailboxPayload(job, input.user)),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; result: LiveProviderResult }
      | { ok: false; message?: string; error?: unknown }
      | null;

    if (!response.ok || !json?.ok) {
      const message =
        (json && "message" in json && json.message) ||
        `Mailbox send failed with ${response.status} ${response.statusText}.`;
      scheduleOutboxRetry(job.id, message);
      return { ok: false, message };
    }

    api.mailboxOutbox.markSent(job.id, json.result);
    return { ok: true, provider: json.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailbox send failed.";
    scheduleOutboxRetry(job.id, message);
    return { ok: false, message };
  }
}

export async function retryPendingMailboxOutbox(input: {
  tenantId: string;
  user: User;
  limit?: number;
}): Promise<{ attempted: number; sent: number }> {
  if (retryInFlight.has(input.user.id)) return { attempted: 0, sent: 0 };
  retryInFlight.add(input.user.id);
  try {
    const communications = api.communications.listByTenant(input.tenantId);
    const byId = new Map(communications.map((row) => [row.id, row]));
    const jobs = api.mailboxOutbox
      .retryDue(input.tenantId)
      .filter((job) => job.createdById === input.user.id)
      .slice(0, input.limit ?? 10);
    let attempted = 0;
    let sent = 0;
    for (const job of jobs) {
      const communication = byId.get(job.communicationId);
      if (!communication) continue;
      attempted += 1;
      const result = await sendCommunicationThroughLiveMailbox({
        tenantId: input.tenantId,
        user: input.user,
        communication,
      });
      if (result.ok && !result.skipped) sent += 1;
    }
    return { attempted, sent };
  } finally {
    retryInFlight.delete(input.user.id);
  }
}

function scheduleOutboxRetry(jobId: string, message: string) {
  const current = api.mailboxOutbox.get(jobId);
  const attempts = Math.max(1, current?.attemptCount ?? 1);
  const delay = OUTBOX_RETRY_DELAYS_MS[Math.min(attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)];
  api.mailboxOutbox.markFailed(jobId, message, new Date(Date.now() + delay).toISOString());
}

async function waitForExistingDelivery(jobId: string): Promise<LiveMailboxSendResult> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = api.mailboxOutbox.get(jobId);
    if (!current) {
      return { ok: false, message: "The email delivery record could not be found." };
    }
    if (current.status === "sent") {
      return { ok: true, skipped: "already_sent" };
    }
    if (current.status === "failed" || current.status === "cancelled") {
      return {
        ok: false,
        message: current.lastError ?? "The connected mailbox did not confirm delivery.",
      };
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  return {
    ok: false,
    message: "The connected mailbox did not confirm delivery before the request timed out.",
  };
}

export async function syncCommunicationsFromLiveMailbox(input: {
  tenantId: string;
  user: User;
  connectionId?: string;
  maxResults?: number;
  quotingSessionId?: string;
}): Promise<
  | {
      ok: true;
      imported: number;
      serverImported?: number;
      serverUpdated?: number;
      serverDeduped?: number;
      serverFailed?: number;
      processed: number;
      review: number;
      ignored: number;
    }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/sync`, {
      method: "POST",
      headers: authHeaders(input.user, input.tenantId),
      body: JSON.stringify({
        connectionId: input.connectionId,
        maxResults: input.maxResults ?? 25,
      }),
    });
    const json = (await response.json().catch(() => null)) as
      | {
          ok: true;
          result: {
            mailboxAccount: string;
            provider: "gmail" | "outlook";
            messages: SyncedMailboxMessage[];
            importSummary?: {
              imported?: number;
              updated?: number;
              deduped?: number;
              failed?: number;
            };
          };
        }
      | { ok: false; message?: string; error?: unknown }
      | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message:
          (json && "message" in json && json.message) ||
          `Mailbox sync failed with ${response.status} ${response.statusText}.`,
      };
    }

    const mirrored = await mirrorSyncedMailboxMessages(
      input.tenantId,
      input.user,
      json.result.messages,
      input.quotingSessionId
    );
    if (!mirrored.ok) return mirrored;
    return {
      ok: true,
      imported: mirrored.imported,
      serverImported: json.result.importSummary?.imported,
      serverUpdated: json.result.importSummary?.updated,
      serverDeduped: json.result.importSummary?.deduped,
      serverFailed: json.result.importSummary?.failed,
      processed: mirrored.processed,
      review: mirrored.review,
      ignored: mirrored.ignored,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Mailbox sync failed.",
    };
  }
}

export async function getLiveMailboxSyncStatus(input: {
  tenantId: string;
  user: User;
  limit?: number;
}): Promise<
  | {
      ok: true;
      status: Array<{
        id: string;
        action: string;
        entityId: string;
        metadata?: unknown;
        createdAt: string;
      }>;
    }
  | { ok: false; message: string }
> {
  try {
    const url = new URL(`${apiBaseUrl()}/mailboxes/sync/status`);
    url.searchParams.set("limit", String(input.limit ?? 10));
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: authHeaders(input.user, input.tenantId),
    });
    const json = (await response.json().catch(() => null)) as
      | {
          ok: true;
          status: Array<{
            id: string;
            action: string;
            entityId: string;
            metadata?: unknown;
            createdAt: string;
          }>;
        }
      | { ok: false; message?: string; error?: unknown }
      | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message:
          (json && "message" in json && json.message) ||
          `Mailbox sync status failed with ${response.status} ${response.statusText}.`,
      };
    }
    return json;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Mailbox sync status failed.",
    };
  }
}

type SyncedMailboxMessage = {
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
  attachments?: CommunicationAttachment[];
  snippet?: string;
  isRead?: boolean;
  mailboxLabels?: string[];
  sentAt?: string;
  direction?: "inbound" | "outbound";
  carrierSubmissionId?: string;
};

function mailboxPayload(job: MailboxOutboxJob, user: User) {
  return {
    connectionId: job.mailboxConnectionId,
    senderMode: "staff",
    senderName: user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    to: job.to,
    cc: job.cc,
    bcc: job.bcc,
    subject: job.subject,
    text: job.bodyFormat === "html" ? undefined : job.body,
    html: job.bodyFormat === "html" ? job.body : undefined,
    replyTo: job.mailboxAccount,
    replyToMessageIdHeader: job.replyToMessageIdHeader,
    references: job.references,
    externalThreadId: job.externalThreadId,
    replyContext: job.replyContext,
    attachments: (job.attachments ?? []).map(sendableAttachment),
  };
}

function sendableAttachment(attachment: CommunicationAttachment) {
  return {
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    dataUrl: attachment.dataUrl,
  };
}

function authHeaders(user: User, tenantId: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...serverSessionHeaders(),
    "x-user-id": user.id,
    "x-user-role": user.role,
    "x-tenant-id": tenantId,
  };
  if (user.branchId) headers["x-branch-id"] = user.branchId;
  return headers;
}

export async function replayPersistedMailboxCommunications(input: {
  tenantId: string;
  user: User;
  limit?: number;
  quotingSessionId?: string;
}): Promise<
  | { ok: true; imported: number; processed: number; review: number; ignored: number }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/replay`, {
      method: "POST",
      headers: authHeaders(input.user, input.tenantId),
      body: JSON.stringify({ limit: input.limit ?? 250 }),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; messages: SyncedMailboxMessage[] }
      | { ok: false; message?: string }
      | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message:
          (json && "message" in json && json.message) ||
          `Saved mailbox messages could not be checked (${response.status}).`,
      };
    }
    return await mirrorSyncedMailboxMessages(
      input.tenantId,
      input.user,
      json.messages,
      input.quotingSessionId
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Saved mailbox messages could not be checked.",
    };
  }
}

async function mirrorSyncedMailboxMessages(
  tenantId: string,
  user: User,
  messages: SyncedMailboxMessage[],
  quotingSessionId?: string
): Promise<
  | { ok: true; imported: number; processed: number; review: number; ignored: number }
  | { ok: false; message: string }
> {
  try {
    let imported = 0;
    const mirroredCommunicationIds: string[] = [];
    for (const message of messages) {
      const mirrored = api.mailbox.mirrorExternalEmail({
        ...message,
        tenantId,
        mailboxUserId: user.id,
      });
      if (!mirrored) continue;
      imported += 1;
      mirroredCommunicationIds.push(mirrored.id);
    }

    const processing = mirroredCommunicationIds.length > 0
      ? await api.quoting.processInboundCarrierCommunications(tenantId, {
        communicationIds: mirroredCommunicationIds,
        sessionId: quotingSessionId,
      })
      : { processed: 0, review: 0, ignored: 0 };
    return { ok: true, imported, ...processing };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Mailbox messages could not be imported.",
    };
  }
}
