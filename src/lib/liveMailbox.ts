import { api } from "@/lib/api";
import { apiBaseUrl } from "@/lib/apiBase";
import type { Communication, CommunicationAttachment, MailboxOutboxJob, User } from "@/types";

export type LiveMailboxSendResult =
  | { ok: true; skipped?: "no_outbox" | "already_sent"; provider?: LiveProviderResult }
  | { ok: false; message: string };

type LiveProviderResult = {
  provider?: "google" | "microsoft";
  status?: "sent";
  externalMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
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

function mailboxPayload(job: MailboxOutboxJob) {
  return {
    connectionId: job.mailboxConnectionId,
    to: job.to,
    cc: job.cc,
    bcc: job.bcc,
    subject: job.subject,
    text: job.bodyFormat === "html" ? undefined : job.body,
    html: job.bodyFormat === "html" ? job.body : undefined,
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
