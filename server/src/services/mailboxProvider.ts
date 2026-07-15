import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export type MailboxSendAttachment = {
  fileName: string;
  fileType?: string;
  dataUrl?: string;
  contentBase64?: string;
};

export type MailboxSendInput = {
  tenantId: string;
  userId: string;
  connectionId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  replyToMessageIdHeader?: string;
  references?: string[];
  externalThreadId?: string;
  attachments?: MailboxSendAttachment[];
};

export type MailboxSendResult = {
  provider: "google" | "microsoft";
  externalMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
  rfc822MessageId?: string;
  messageIdHeader?: string;
  status: "sent";
};

export type MailboxSyncCursor = {
  gmailHistoryId?: string;
  graphDeltaLink?: string;
  updatedAt?: string;
};

export type MailboxConnectionRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  provider: string;
  address: string;
  status: string;
  token_vault_ref: string | null;
};

type TokenVaultRow = {
  encrypted_payload: Prisma.JsonValue;
};

export type TokenPayload = {
  provider: "google" | "microsoft";
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  idToken?: string;
  expiresAt?: string;
  externalAccountId?: string;
  email?: string;
  connectedAt?: string;
  syncCursor?: MailboxSyncCursor;
};

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  scopes: string[];
};

type MailboxConnectionLookupInput = {
  tenantId: string;
  userId: string;
  connectionId?: string;
};

type MicrosoftMessageMetadata = {
  id?: string;
  conversationId?: string;
  webLink?: string;
  internetMessageId?: string;
  isDraft?: boolean;
};

const MICROSOFT_IMMUTABLE_ID_PREFERENCE = 'IdType="ImmutableId"';

export async function sendMailboxEmail(input: MailboxSendInput): Promise<MailboxSendResult> {
  if (input.to.length === 0) throw new Error("At least one recipient is required.");
  const connection = await resolveMailboxConnection(input);
  if (connection.status !== "connected") {
    throw new Error("Mailbox is not connected. Reconnect the staff mailbox before live sending.");
  }

  const token = await readMailboxToken(connection);
  const freshToken = await ensureFreshToken(connection, token);

  if (freshToken.provider === "google") {
    return sendGoogleMail(connection, freshToken, input);
  }
  if (freshToken.provider === "microsoft") {
    return sendMicrosoftMail(connection, freshToken, input);
  }
  throw new Error(`Unsupported mailbox provider: ${connection.provider}.`);
}

export async function readFreshMailboxToken(input: MailboxConnectionLookupInput): Promise<{
  connection: MailboxConnectionRow;
  token: TokenPayload;
}> {
  const connection = await resolveMailboxConnection(input);
  if (connection.status !== "connected") {
    throw new Error("Mailbox is not connected. Reconnect the staff mailbox before syncing.");
  }
  const token = await readMailboxToken(connection);
  return { connection, token: await ensureFreshToken(connection, token) };
}

export async function writeMailboxSyncCursor(
  connection: MailboxConnectionRow,
  token: TokenPayload,
  cursor: MailboxSyncCursor
): Promise<TokenPayload> {
  const next: TokenPayload = {
    ...token,
    syncCursor: {
      ...(token.syncCursor ?? {}),
      ...cursor,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeMailboxToken(connection, next);
  return next;
}

async function resolveMailboxConnection(input: MailboxConnectionLookupInput): Promise<MailboxConnectionRow> {
  const rows = input.connectionId
    ? await prisma.$queryRaw<MailboxConnectionRow[]>`
        SELECT id, tenant_id, user_id, provider, address, status, token_vault_ref
        FROM mailbox_connections
        WHERE id = ${input.connectionId}
          AND tenant_id = ${input.tenantId}
          AND (user_id = ${input.userId} OR owner_type = 'agency_marketing')
        LIMIT 1
      `
    : await prisma.$queryRaw<MailboxConnectionRow[]>`
        SELECT id, tenant_id, user_id, provider, address, status, token_vault_ref
        FROM mailbox_connections
        WHERE tenant_id = ${input.tenantId}
          AND user_id = ${input.userId}
          AND owner_type = 'staff'
          AND status = 'connected'
        ORDER BY updated_at DESC
        LIMIT 1
      `;

  const connection = rows[0];
  if (!connection) throw new Error("No connected mailbox was found for this staff account.");
  if (!connection.token_vault_ref) throw new Error("Connected mailbox is missing its encrypted token reference.");
  return connection;
}

async function readMailboxToken(connection: MailboxConnectionRow): Promise<TokenPayload> {
  const rows = await prisma.$queryRaw<TokenVaultRow[]>`
    SELECT encrypted_payload
    FROM mailbox_token_vault
    WHERE connection_id = ${connection.id}
      AND tenant_id = ${connection.tenant_id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Mailbox token vault row was not found.");
  return decryptTokenPayload(row.encrypted_payload);
}

async function ensureFreshToken(connection: MailboxConnectionRow, token: TokenPayload): Promise<TokenPayload> {
  if (!token.expiresAt || Date.parse(token.expiresAt) - Date.now() > 90_000) return token;
  if (!token.refreshToken) {
    await markConnectionError(connection.id, "Mailbox token expired and no refresh token is available.");
    throw new Error("Mailbox token expired. Reconnect the mailbox.");
  }

  const config = providerConfig(token.provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });
  if (token.provider === "microsoft") body.set("scope", config.scopes.join(" "));

  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await safeJson(res)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!res.ok || !json?.access_token) {
    const message = json?.error_description ?? json?.error ?? `Token refresh failed with ${res.status}.`;
    await markConnectionError(connection.id, message);
    throw new Error(message);
  }

  const next: TokenPayload = {
    ...token,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? token.refreshToken,
    tokenType: json.token_type ?? token.tokenType,
    scope: json.scope ?? token.scope,
    expiresAt:
      typeof json.expires_in === "number"
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : token.expiresAt,
  };

  await prisma.$executeRaw`
    UPDATE mailbox_token_vault
    SET encrypted_payload = ${JSON.stringify(encryptTokenPayload(next))}::jsonb,
        updated_at = now()
    WHERE connection_id = ${connection.id}
      AND tenant_id = ${connection.tenant_id}
  `;
  return next;
}

async function writeMailboxToken(connection: MailboxConnectionRow, token: TokenPayload) {
  await prisma.$executeRaw`
    UPDATE mailbox_token_vault
    SET encrypted_payload = ${JSON.stringify(encryptTokenPayload(token))}::jsonb,
        updated_at = now()
    WHERE connection_id = ${connection.id}
      AND tenant_id = ${connection.tenant_id}
  `;
}

async function sendGoogleMail(
  connection: MailboxConnectionRow,
  token: TokenPayload,
  input: MailboxSendInput
): Promise<MailboxSendResult> {
  const raw = buildMimeMessage({
    from: connection.address,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyToMessageIdHeader: input.replyToMessageIdHeader,
    references: input.references,
    attachments: input.attachments,
  });
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      raw: base64Url(Buffer.from(raw, "utf8")),
      threadId: input.externalThreadId,
    }),
  });
  const json = (await safeJson(res)) as { id?: string; threadId?: string; error?: { message?: string } } | null;
  if (!res.ok || !json?.id) {
    const message = json?.error?.message ?? `Gmail send failed with ${res.status}.`;
    await markConnectionError(connection.id, message);
    throw new Error(message);
  }

  const sentMetadata = await readGmailMessageMetadata(json.id, connection.address, token.accessToken).catch(() => null);
  const messageIdHeader = sentMetadata?.messageIdHeader;

  await markConnectionSent(connection.id);
  return {
    provider: "google",
    status: "sent",
    externalMessageId: json.id,
    externalThreadId: json.threadId,
    externalUrl: gmailExactMessageUrl(connection.address, messageIdHeader),
    rfc822MessageId: messageIdHeader,
    messageIdHeader,
  };
}

async function sendMicrosoftMail(
  connection: MailboxConnectionRow,
  token: TokenPayload,
  input: MailboxSendInput
): Promise<MailboxSendResult> {
  const createRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      "content-type": "application/json",
      Prefer: MICROSOFT_IMMUTABLE_ID_PREFERENCE,
    },
    body: JSON.stringify({
      subject: input.subject || "Message from your agent",
      body: {
        contentType: input.html ? "HTML" : "Text",
        content: input.html ?? input.text ?? "",
      },
      toRecipients: input.to.map(graphRecipient),
      ccRecipients: (input.cc ?? []).map(graphRecipient),
      bccRecipients: (input.bcc ?? []).map(graphRecipient),
      attachments: (input.attachments ?? []).map(graphAttachment),
      internetMessageHeaders: graphThreadHeaders(input),
    }),
  });
  const created = (await safeJson(createRes)) as
    | (MicrosoftMessageMetadata & { error?: { message?: string } })
    | null;
  if (!createRes.ok || !created?.id) {
    const message = created?.error?.message ?? `Microsoft draft creation failed with ${createRes.status}.`;
    await markConnectionError(connection.id, message);
    throw new Error(message);
  }

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(created.id)}/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      Prefer: MICROSOFT_IMMUTABLE_ID_PREFERENCE,
    },
  });
  if (!sendRes.ok) {
    const json = (await safeJson(sendRes)) as { error?: { message?: string } } | null;
    const message = json?.error?.message ?? `Microsoft send failed with ${sendRes.status}.`;
    await markConnectionError(connection.id, message);
    throw new Error(message);
  }

  const sent = await readMicrosoftSentMessage(created.id, token.accessToken).catch(() => null);
  await markConnectionSent(connection.id);
  return {
    provider: "microsoft",
    status: "sent",
    externalMessageId: sent?.id ?? created.id,
    externalThreadId: sent?.conversationId ?? created.conversationId,
    externalUrl: sent?.webLink ?? created.webLink,
    rfc822MessageId: sent?.internetMessageId ?? created.internetMessageId,
    messageIdHeader: sent?.internetMessageId ?? created.internetMessageId,
  };
}

async function readMicrosoftSentMessage(
  messageId: string,
  accessToken: string
): Promise<MicrosoftMessageMetadata | null> {
  const url = new URL(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("$select", "id,conversationId,webLink,internetMessageId,isDraft");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        Prefer: MICROSOFT_IMMUTABLE_ID_PREFERENCE,
      },
    });
    const message = (await safeJson(res)) as MicrosoftMessageMetadata | null;
    if (res.ok && message?.id && message.isDraft !== true) return message;
    if (res.status !== 404 && !(res.ok && message?.isDraft === true)) return null;
    if (attempt < 2) await delay(100 * (attempt + 1));
  }
  return null;
}

async function readGmailMessageMetadata(
  messageId: string,
  mailboxAccount: string,
  accessToken: string
): Promise<{ messageIdHeader?: string; externalUrl?: string }> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Message-ID");
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await safeJson(res)) as
    | {
        payload?: { headers?: { name: string; value: string }[] };
        error?: { message?: string };
      }
    | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Gmail metadata lookup failed with ${res.status}.`);
  const headers = new Map(
    (json?.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value])
  );
  const messageIdHeader = headers.get("message-id");
  return {
    messageIdHeader,
    externalUrl: gmailExactMessageUrl(mailboxAccount, messageIdHeader),
  };
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerConfig(provider: "google" | "microsoft"): ProviderConfig {
  if (provider === "google") {
    return {
      clientId: requiredEnv("GOOGLE_MAILBOX_CLIENT_ID"),
      clientSecret: requiredEnv("GOOGLE_MAILBOX_CLIENT_SECRET"),
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      scopes: envList("GOOGLE_MAILBOX_SCOPES", [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
      ]),
    };
  }
  const tenant = env("MICROSOFT_MAILBOX_TENANT") || "organizations";
  return {
    clientId: requiredEnv("MICROSOFT_MAILBOX_CLIENT_ID"),
    clientSecret: requiredEnv("MICROSOFT_MAILBOX_CLIENT_SECRET"),
    tokenEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scopes: envList("MICROSOFT_MAILBOX_SCOPES", [
      "openid",
      "profile",
      "email",
      "offline_access",
      "User.Read",
      "Mail.Send",
      "Mail.Read",
    ]),
  };
}

function buildMimeMessage(input: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  replyToMessageIdHeader?: string;
  references?: string[];
  attachments?: MailboxSendAttachment[];
}): string {
  const boundary = `quotex_${base64Url(randomBytes(18))}`;
  const alternativeBoundary = `quotex_alt_${base64Url(randomBytes(18))}`;
  const hasAttachments = (input.attachments ?? []).length > 0;
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.map(formatAddress).join(", ")}` : "",
    input.bcc?.length ? `Bcc: ${input.bcc.map(formatAddress).join(", ")}` : "",
    `Subject: ${encodeMimeHeader(input.subject || "Message from your agent")}`,
    input.replyToMessageIdHeader ? `In-Reply-To: ${normalizeMessageId(input.replyToMessageIdHeader)}` : "",
    input.references?.length ? `References: ${input.references.map(normalizeMessageId).join(" ")}` : "",
    "MIME-Version: 1.0",
  ].filter(Boolean);

  const text = input.text ?? stripHtml(input.html ?? "");
  const html = input.html;
  const bodyParts = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(text || "Please see attached."),
  ];
  if (html) {
    bodyParts.push(
      `--${alternativeBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      quotedPrintable(html)
    );
  }
  bodyParts.push(`--${alternativeBoundary}--`);

  if (!hasAttachments) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      "",
      ...bodyParts,
      "",
    ].join("\r\n");
  }

  const attachmentParts = (input.attachments ?? []).map((attachment) => {
    const content = attachmentContentBase64(attachment);
    const fileName = attachment.fileName || "attachment";
    return [
      `--${boundary}`,
      `Content-Type: ${attachment.fileType || "application/octet-stream"}; name="${escapeHeaderParam(fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${escapeHeaderParam(fileName)}"`,
      "",
      wrapBase64(content),
    ].join("\r\n");
  });

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    ...bodyParts,
    ...attachmentParts,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function graphThreadHeaders(input: MailboxSendInput) {
  const headers: { name: string; value: string }[] = [];
  if (input.replyToMessageIdHeader) {
    headers.push({ name: "In-Reply-To", value: normalizeMessageId(input.replyToMessageIdHeader) });
  }
  if (input.references?.length) {
    headers.push({ name: "References", value: input.references.map(normalizeMessageId).join(" ") });
  }
  return headers.length > 0 ? headers : undefined;
}

function normalizeMessageId(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  return clean.startsWith("<") && clean.endsWith(">") ? clean : `<${clean.replace(/^<|>$/g, "")}>`;
}

function graphRecipient(email: string) {
  return { emailAddress: { address: email } };
}

function graphAttachment(attachment: MailboxSendAttachment) {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.fileName || "attachment",
    contentType: attachment.fileType || "application/octet-stream",
    contentBytes: attachmentContentBase64(attachment),
  };
}

function attachmentContentBase64(attachment: MailboxSendAttachment): string {
  if (attachment.contentBase64) return attachment.contentBase64.replace(/\s+/g, "");
  if (!attachment.dataUrl) return "";
  const marker = ";base64,";
  const index = attachment.dataUrl.indexOf(marker);
  if (index >= 0) return attachment.dataUrl.slice(index + marker.length).replace(/\s+/g, "");
  const comma = attachment.dataUrl.indexOf(",");
  const payload = comma >= 0 ? attachment.dataUrl.slice(comma + 1) : attachment.dataUrl;
  return Buffer.from(decodeURIComponent(payload), "utf8").toString("base64");
}

function decryptTokenPayload(value: Prisma.JsonValue): TokenPayload {
  const payload = asRecord(value);
  const iv = Buffer.from(requiredString(payload.iv, "token iv"), "base64");
  const tag = Buffer.from(requiredString(payload.tag, "token tag"), "base64");
  const ciphertext = Buffer.from(requiredString(payload.ciphertext, "token ciphertext"), "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<TokenPayload>;
  if (parsed.provider !== "google" && parsed.provider !== "microsoft") {
    throw new Error("Mailbox token payload has an unsupported provider.");
  }
  if (!parsed.accessToken) throw new Error("Mailbox token payload is missing an access token.");
  return parsed as TokenPayload;
}

function encryptTokenPayload(payload: TokenPayload): Record<string, string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    keyRef: env("MAILBOX_TOKEN_KEY_REF") || "env:MAILBOX_TOKEN_ENCRYPTION_KEY",
  };
}

function encryptionKey(): Buffer {
  const raw = requiredEnv("MAILBOX_TOKEN_ENCRYPTION_KEY");
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) return base64;
  return createHash("sha256").update(raw).digest();
}

async function markConnectionSent(connectionId: string) {
  await prisma.$executeRaw`
    UPDATE mailbox_connections
    SET last_send_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE id = ${connectionId}
  `;
}

async function markConnectionError(connectionId: string, error: string) {
  await prisma.$executeRaw`
    UPDATE mailbox_connections
    SET last_error = ${error.slice(0, 1000)},
        updated_at = now()
    WHERE id = ${connectionId}
  `;
}

function formatAddress(email: string): string {
  return /[<>,]/.test(email) ? email : `<${email}>`;
}

function encodeMimeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value.replace(/\r?\n/g, " ") : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function escapeHeaderParam(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

function wrapBase64(value: string): string {
  return value.replace(/(.{1,76})/g, "$1\r\n").trim();
}

function quotedPrintable(value: string): string {
  return value
    .replace(/\r?\n/g, "\r\n")
    .replace(/[^\t\r\n -<>-~]/g, (char) =>
      Buffer.from(char, "utf8")
        .toString("hex")
        .toUpperCase()
        .replace(/([A-F0-9]{2})/g, "=$1")
    );
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function env(key: string) {
  return process.env[key]?.trim() ?? "";
}

function requiredEnv(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`${key} is required for live mailbox delivery.`);
  return value;
}

function envList(key: string, fallback: string[]) {
  const configured = env(key)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : fallback;
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Encrypted mailbox token is malformed.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Encrypted mailbox token is missing ${label}.`);
  return value;
}

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
