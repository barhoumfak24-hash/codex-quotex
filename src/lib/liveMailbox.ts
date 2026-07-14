import { api } from "@/lib/api";
import { apiBaseUrl } from "@/lib/apiBase";
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
  if (job.status === "sending") return { ok: true, skipped: "already_sending" };
  if (job.to.length === 0) {
    const message = job.lastError ?? "No recipient email address was available.";
    api.mailboxOutbox.markFailed(job.id, message);
    return { ok: false, message };
  }

  api.mailboxOutbox.markSending(job.id);
  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/send`, {
      method: "POST",
      headers: authHeaders(input.user, input.tenantId),
      body: JSON.stringify(mailboxPayload(job)),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; result: LiveProviderResult }
      | { ok: false; message?: string; error?: unknown }
      | null;

    if (!response.ok || !json?.ok) {
      const message =
        (json && "message" in json && json.message) ||
        `Mailbox send failed with ${response.status} ${response.statusText}.`;
      api.mailboxOutbox.markFailed(job.id, message);
      return { ok: false, message };
    }

    api.mailboxOutbox.markSent(job.id, json.result);
    return { ok: true, provider: json.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailbox send failed.";
    api.mailboxOutbox.markFailed(job.id, message);
    return { ok: false, message };
  }
}

export async function syncCommunicationsFromLiveMailbox(input: {
  tenantId: string;
  user: User;
  connectionId?: string;
  maxResults?: number;
}): Promise<
  | {
      ok: true;
      imported: number;
      serverImported?: number;
      serverUpdated?: number;
      serverDeduped?: number;
      serverFailed?: number;
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

    let imported = 0;
    for (const message of json.result.messages) {
      const mirrored = api.mailbox.mirrorExternalEmail({
        ...message,
        tenantId: input.tenantId,
        mailboxUserId: input.user.id,
        mailboxAccount: message.mailboxAccount || json.result.mailboxAccount,
        provider: message.provider || json.result.provider,
      });
      if (mirrored) imported += 1;
    }
    return {
      ok: true,
      imported,
      serverImported: json.result.importSummary?.imported,
      serverUpdated: json.result.importSummary?.updated,
      serverDeduped: json.result.importSummary?.deduped,
      serverFailed: json.result.importSummary?.failed,
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
};

function mailboxPayload(job: MailboxOutboxJob) {
  return {
    connectionId: job.mailboxConnectionId,
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
    "x-user-id": user.id,
    "x-user-role": user.role,
    "x-tenant-id": tenantId,
  };
  if (user.branchId) headers["x-branch-id"] = user.branchId;
  const token = authToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function authToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("quotex.authToken") ||
    window.localStorage.getItem("quotex.jwt") ||
    null
  );
}
