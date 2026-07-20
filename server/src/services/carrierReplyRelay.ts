import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";

export type CarrierReplyContext = {
  communicationId: string;
  threadId?: string;
  customerId?: string;
  prospectId?: string;
  carrierContactId?: string;
  carrierSubmissionId?: string;
};

export type InboundCarrierReply = {
  from: string;
  to: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: string;
  envelope?: string;
  attachments?: Array<{
    id: string;
    fileName: string;
    fileType: string;
    sizeBytes: number;
    dataUrl?: string;
  }>;
};

type ReplyRouteMetadata = CarrierReplyContext & {
  userId: string;
  mailboxAccount: string;
  provider: string;
  replyAddress: string;
  createdAt: string;
  expiresAt: string;
};

const ROUTE_ACTION = "mailbox.reply_route.created";
const ROUTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function carrierReplyRelayConfiguration() {
  const domain = normalizeReplyDomain(process.env.INBOUND_REPLY_DOMAIN);
  const webhookSecret = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET?.trim() ?? "";
  return {
    configured: Boolean(domain && webhookSecret.length >= 24),
    domain,
    webhookSecretConfigured: webhookSecret.length >= 24,
  };
}

export function verifyInboundWebhookSecret(candidate: string): boolean {
  const expected = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET?.trim() ?? "";
  if (expected.length < 24 || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export async function createCarrierReplyRoute(input: {
  tenantId: string;
  userId: string;
  mailboxAccount: string;
  provider?: string;
  context?: CarrierReplyContext;
}): Promise<string | null> {
  const configuration = carrierReplyRelayConfiguration();
  if (!configuration.configured || !configuration.domain || !input.context?.communicationId) return null;

  const token = randomBytes(18).toString("base64url");
  const createdAt = new Date();
  const replyAddress = `reply+${token}@${configuration.domain}`;
  const metadata: ReplyRouteMetadata = {
    ...input.context,
    userId: input.userId,
    mailboxAccount: input.mailboxAccount,
    provider: normalizeProvider(input.provider, input.mailboxAccount),
    replyAddress,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ROUTE_TTL_MS).toISOString(),
  };

  await prisma.auditLog.create({
    data: {
      id: `audit_${randomUUID()}`,
      tenantId: input.tenantId,
      actorId: input.userId,
      action: ROUTE_ACTION,
      entityType: "mailbox_reply_route",
      entityId: token,
      metadata: jsonValue(metadata),
    },
  });
  return replyAddress;
}

export async function ingestCarrierReply(input: InboundCarrierReply): Promise<
  | { status: "linked"; communicationId: string; tenantId: string; userId: string }
  | { status: "deduped"; communicationId: string; tenantId: string; userId: string }
  | { status: "ignored"; reason: string }
> {
  const routeToken = replyRouteToken(input.to);
  if (!routeToken) return { status: "ignored", reason: "reply_route_missing" };

  const route = await prisma.auditLog.findFirst({
    where: { action: ROUTE_ACTION, entityType: "mailbox_reply_route", entityId: routeToken },
    orderBy: { createdAt: "desc" },
  });
  if (!route?.tenantId) return { status: "ignored", reason: "reply_route_unknown" };
  const metadata = replyRouteMetadata(route.metadata);
  if (!metadata || new Date(metadata.expiresAt).getTime() <= Date.now()) {
    return { status: "ignored", reason: "reply_route_expired" };
  }

  const from = normalizeEmail(input.from);
  if (!from) return { status: "ignored", reason: "sender_missing" };
  const parsedHeaders = parseHeaderBlock(input.headers);
  const messageIdHeader = normalizeMessageId(parsedHeaders.get("message-id"));
  const inReplyToHeader = normalizeMessageId(parsedHeaders.get("in-reply-to"));
  const references = parseReferences(parsedHeaders.get("references"));
  const externalMessageId = messageIdHeader || fallbackMessageId(input, routeToken);

  const existing = await prisma.communication.findFirst({
    where: {
      tenantId: route.tenantId,
      channel: "email",
      OR: [
        { messageIdHeader: externalMessageId },
        { mailbox: { path: ["externalMessageId"], equals: externalMessageId } },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    return {
      status: "deduped",
      communicationId: existing.id,
      tenantId: route.tenantId,
      userId: metadata.userId,
    };
  }

  const body = (input.text?.trim() || stripHtml(input.html ?? "") || "Carrier reply received.").slice(0, 250_000);
  const communicationId = `comm_${randomUUID()}`;
  const mailbox = {
    origin: "inbound_relay",
    account: metadata.mailboxAccount,
    provider: metadata.provider,
    connectionId: `relay:${metadata.userId}`,
    userId: metadata.userId,
    routeToken,
    externalMessageId,
    rfc822MessageId: messageIdHeader || undefined,
  };

  await prisma.$transaction(async (tx) => {
    await tx.communication.create({
      data: {
        id: communicationId,
        tenantId: route.tenantId!,
        customerId: metadata.customerId,
        prospectId: metadata.prospectId,
        carrierContactId: metadata.carrierContactId,
        externalRecipientName: displayNameFromHeader(input.from) ?? from,
        externalRecipientEmail: from,
        externalRecipientRole: "Carrier underwriter",
        channel: "email",
        direction: "inbound",
        subject: input.subject?.trim() || undefined,
        threadId: metadata.threadId,
        replyToId: metadata.communicationId,
        mailbox: jsonValue(mailbox),
        attachments: jsonValue(input.attachments ?? []),
        body,
        bodyHtml: input.html?.slice(0, 500_000),
        messageIdHeader: externalMessageId,
        inReplyToHeader: inReplyToHeader || undefined,
        references,
        toRecipients: input.to,
        ccRecipients: input.cc ?? [],
        snippet: body.slice(0, 240),
        isRead: false,
        mailboxLabels: ["inbox", "carrier-reply"],
        resolution: jsonValue({
          carrierSubmissionId: metadata.carrierSubmissionId,
          replyRouteToken: routeToken,
        }),
        sentAt: parseHeaderDate(parsedHeaders.get("date")),
      },
    });
    await tx.auditLog.create({
      data: {
        id: `audit_${randomUUID()}`,
        tenantId: route.tenantId,
        actorId: metadata.userId,
        action: "mailbox.inbound.linked",
        entityType: "mailbox",
        entityId: externalMessageId,
        metadata: jsonValue({
          status: "linked",
          origin: "sendgrid_inbound_parse",
          communicationId,
          routeToken,
          from,
          to: input.to,
          subject: input.subject,
          carrierSubmissionId: metadata.carrierSubmissionId,
        }),
      },
    });
  });

  return { status: "linked", communicationId, tenantId: route.tenantId, userId: metadata.userId };
}

function replyRouteMetadata(value: unknown): ReplyRouteMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const required = ["communicationId", "userId", "mailboxAccount", "provider", "replyAddress", "expiresAt"];
  if (!required.every((key) => typeof row[key] === "string" && String(row[key]).trim())) return null;
  return row as unknown as ReplyRouteMetadata;
}

function replyRouteToken(recipients: string[]): string | null {
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient);
    const local = email.split("@")[0] ?? "";
    const token = local.match(/^reply\+([A-Za-z0-9_-]{20,40})$/)?.[1];
    if (token) return token;
  }
  return null;
}

function normalizeReplyDomain(value: string | undefined): string | null {
  const domain = (value ?? "").trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) && domain.includes(".") ? domain : null;
}

function normalizeProvider(provider: string | undefined, mailboxAccount: string): "gmail" | "outlook" {
  const value = (provider ?? "").toLowerCase();
  if (value.includes("microsoft") || value.includes("outlook")) return "outlook";
  if (/@(?:outlook|hotmail|live)\./i.test(mailboxAccount)) return "outlook";
  return "gmail";
}

function normalizeEmail(value: string): string {
  const match = value.match(/<([^>]+)>/)?.[1] ?? value;
  return match.trim().toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] ?? "";
}

function displayNameFromHeader(value: string): string | undefined {
  return value.match(/^"?([^"<]+?)"?\s*<[^>]+>$/)?.[1]?.trim() || undefined;
}

function parseHeaderBlock(value: string | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  let current = "";
  for (const line of (value ?? "").split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ""} ${line.trim()}`.trim());
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    current = line.slice(0, separator).trim().toLowerCase();
    headers.set(current, line.slice(separator + 1).trim());
  }
  return headers;
}

function normalizeMessageId(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("<") ? trimmed : `<${trimmed.replace(/[<>]/g, "")}>`;
}

function parseReferences(value: string | undefined): string[] {
  return [...(value ?? "").matchAll(/<[^<>\s]+>/g)].map((match) => match[0]).slice(0, 50);
}

function parseHeaderDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function fallbackMessageId(input: InboundCarrierReply, routeToken: string): string {
  const digest = createHash("sha256")
    .update([routeToken, input.from, input.subject ?? "", input.text ?? "", input.html ?? ""].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `<relay-${digest}@quotexinsurance.com>`;
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
