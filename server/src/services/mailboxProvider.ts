import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { resolveMx } from "node:dns/promises";
import { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
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
  ownerType?: "staff" | "agency_marketing";
  connectionId?: string;
  expectedAddress?: string;
  senderName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
  replyToMessageIdHeader?: string;
  references?: string[];
  externalThreadId?: string;
  attachments?: MailboxSendAttachment[];
};

export type MailboxSendResult = {
  provider: "google" | "microsoft" | "smtp";
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

export type OAuthTokenPayload = {
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

type SmtpTokenPayload = {
  provider: "smtp";
  username: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
  connectedAt: string;
};

export type TokenPayload = OAuthTokenPayload | SmtpTokenPayload;

export type AgencyMarketingCredentialProvider =
  | "auto"
  | "google"
  | "microsoft"
  | "yahoo"
  | "apple"
  | "zoho";

export type SafeMailboxConnection = {
  id: string;
  tenantId: string;
  userId: null;
  ownerType: "agency_marketing";
  provider: "smtp";
  address: string;
  displayName: string;
  status: "connected";
  authMode: "smtp_imap";
  scopes: ["send"];
  tokenVaultRef: string;
  connectedAt: string;
  updatedAt: string;
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
  ownerType?: "staff" | "agency_marketing";
  expectedAddress?: string;
};

type MicrosoftMessageMetadata = {
  id?: string;
  conversationId?: string;
  webLink?: string;
  internetMessageId?: string;
  isDraft?: boolean;
};

const MICROSOFT_IMMUTABLE_ID_PREFERENCE = 'IdType="ImmutableId"';

export class MailboxFallbackSafeError extends Error {
  readonly fallbackSafe = true;
}

export function isMailboxFallbackSafeError(error: unknown): error is MailboxFallbackSafeError {
  return error instanceof MailboxFallbackSafeError;
}

export async function sendMailboxEmail(input: MailboxSendInput): Promise<MailboxSendResult> {
  if (input.to.length === 0) throw new MailboxFallbackSafeError("At least one recipient is required.");
  let connection: MailboxConnectionRow;
  let freshToken: TokenPayload;
  try {
    connection = await resolveMailboxConnection(input);
    if (connection.status !== "connected") {
      throw new Error("Mailbox is not connected. Reconnect the staff mailbox before live sending.");
    }
    const token = await readMailboxToken(connection);
    freshToken = token.provider === "smtp" ? token : await ensureFreshToken(connection, token);
  } catch (error) {
    throw new MailboxFallbackSafeError(error instanceof Error ? error.message : "Mailbox is unavailable.");
  }

  if (freshToken.provider === "google") {
    return sendGoogleMail(connection, freshToken, input);
  }
  if (freshToken.provider === "microsoft") {
    return sendMicrosoftMail(connection, freshToken, input);
  }
  if (freshToken.provider === "smtp") {
    return sendSmtpMail(connection, freshToken, input);
  }
  throw new MailboxFallbackSafeError(`Unsupported mailbox provider: ${connection.provider}.`);
}

export async function saveAgencyMarketingSmtpCredential(input: {
  tenantId: string;
  updatedById: string;
  agencyName: string;
  email: string;
  password: string;
  provider: AgencyMarketingCredentialProvider;
}): Promise<SafeMailboxConnection> {
  const email = normalizeMailboxAddress(input.email);
  const password = input.password.trim();
  if (!email || !password) throw new Error("Company email and email password are required.");

  const smtp = await resolveSmtpConfiguration(email, input.provider);
  const now = new Date();
  const connectionId = `mailbox_smtp_${input.tenantId}_agency_marketing`;
  const vaultId = `mailbox_token_${connectionId}`;
  const tokenVaultRef = `mailbox-token:${vaultId}`;
  const token: SmtpTokenPayload = {
    provider: "smtp",
    username: email,
    password,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectedAt: now.toISOString(),
  };

  await verifySmtpCredential(token);
  const encryptedPayload = encryptTokenPayload(token);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`
      UPDATE mailbox_connections
      SET status = 'disabled', updated_at = ${now}
      WHERE tenant_id = ${input.tenantId}
        AND owner_type = 'agency_marketing'
        AND id <> ${connectionId}
    `;
    await tx.$executeRaw`
      INSERT INTO mailbox_connections (
        id, tenant_id, user_id, owner_type, provider, address, display_name,
        status, auth_mode, scopes, token_vault_ref, connected_at, updated_at, updated_by_id
      ) VALUES (
        ${connectionId}, ${input.tenantId}, NULL, 'agency_marketing', 'smtp', ${email},
        ${input.agencyName.trim() || email}, 'connected', 'smtp_imap', ${JSON.stringify(["send"])}::jsonb,
        ${tokenVaultRef}, ${now}, ${now}, ${input.updatedById}
      )
      ON CONFLICT (id) DO UPDATE SET
        address = excluded.address,
        display_name = excluded.display_name,
        status = excluded.status,
        auth_mode = excluded.auth_mode,
        scopes = excluded.scopes,
        token_vault_ref = excluded.token_vault_ref,
        connected_at = excluded.connected_at,
        updated_at = excluded.updated_at,
        updated_by_id = excluded.updated_by_id,
        last_error = NULL
    `;
    await tx.$executeRaw`
      INSERT INTO mailbox_token_vault (
        id, tenant_id, connection_id, provider, encrypted_payload, encryption_key_ref, created_at, updated_at
      ) VALUES (
        ${vaultId}, ${input.tenantId}, ${connectionId}, 'smtp', ${JSON.stringify(encryptedPayload)}::jsonb,
        ${env("MAILBOX_TOKEN_KEY_REF") || "env:MAILBOX_TOKEN_ENCRYPTION_KEY"}, ${now}, ${now}
      )
      ON CONFLICT (connection_id) DO UPDATE SET
        provider = excluded.provider,
        encrypted_payload = excluded.encrypted_payload,
        encryption_key_ref = excluded.encryption_key_ref,
        updated_at = excluded.updated_at
    `;
  });

  return {
    id: connectionId,
    tenantId: input.tenantId,
    userId: null,
    ownerType: "agency_marketing",
    provider: "smtp",
    address: email,
    displayName: input.agencyName.trim() || email,
    status: "connected",
    authMode: "smtp_imap",
    scopes: ["send"],
    tokenVaultRef,
    connectedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function readFreshMailboxToken(input: MailboxConnectionLookupInput): Promise<{
  connection: MailboxConnectionRow;
  token: OAuthTokenPayload;
}> {
  const connection = await resolveMailboxConnection(input);
  if (connection.status !== "connected") {
    throw new Error("Mailbox is not connected. Reconnect the staff mailbox before syncing.");
  }
  const token = await readMailboxToken(connection);
  if (token.provider === "smtp") {
    throw new Error("Password-based campaign mailboxes are send-only and do not support inbox sync.");
  }
  return { connection, token: await ensureFreshToken(connection, token) };
}

export async function writeMailboxSyncCursor(
  connection: MailboxConnectionRow,
  token: OAuthTokenPayload,
  cursor: MailboxSyncCursor
): Promise<OAuthTokenPayload> {
  const next: OAuthTokenPayload = {
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
  const ownerType = input.ownerType ?? "staff";
  const rows = input.connectionId
    ? ownerType === "agency_marketing"
      ? await prisma.$queryRaw<MailboxConnectionRow[]>`
        SELECT id, tenant_id, user_id, provider, address, status, token_vault_ref
        FROM mailbox_connections
        WHERE id = ${input.connectionId}
          AND tenant_id = ${input.tenantId}
          AND owner_type = 'agency_marketing'
        LIMIT 1
      `
      : await prisma.$queryRaw<MailboxConnectionRow[]>`
        SELECT id, tenant_id, user_id, provider, address, status, token_vault_ref
        FROM mailbox_connections
        WHERE id = ${input.connectionId}
          AND tenant_id = ${input.tenantId}
          AND user_id = ${input.userId}
          AND owner_type = 'staff'
        LIMIT 1
      `
    : ownerType === "agency_marketing"
    ? await prisma.$queryRaw<MailboxConnectionRow[]>`
        SELECT id, tenant_id, user_id, provider, address, status, token_vault_ref
        FROM mailbox_connections
        WHERE tenant_id = ${input.tenantId}
          AND owner_type = 'agency_marketing'
          AND status = 'connected'
        ORDER BY updated_at DESC
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
  if (!connection) {
    throw new Error(
      ownerType === "agency_marketing"
        ? "No connected agency marketing mailbox was found."
        : "No connected mailbox was found for this staff account."
    );
  }
  if (
    input.expectedAddress &&
    normalizeMailboxAddress(connection.address) !== normalizeMailboxAddress(input.expectedAddress)
  ) {
    throw new Error(
      ownerType === "agency_marketing"
        ? "The connected agency marketing mailbox does not match the agency contact email."
        : "The connected mailbox does not match the signed-in staff email."
    );
  }
  if (!connection.token_vault_ref) throw new Error("Connected mailbox is missing its encrypted token reference.");
  return connection;
}

function normalizeMailboxAddress(value: string): string {
  return value.trim().toLowerCase();
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

async function ensureFreshToken(connection: MailboxConnectionRow, token: OAuthTokenPayload): Promise<OAuthTokenPayload> {
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

  const next: OAuthTokenPayload = {
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

async function writeMailboxToken(connection: MailboxConnectionRow, token: OAuthTokenPayload) {
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
  token: OAuthTokenPayload,
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
    await markConnectionError(connection.id, message).catch(() => undefined);
    throw new MailboxFallbackSafeError(message);
  }

  const sentMetadata = await readGmailMessageMetadata(json.id, connection.address, token.accessToken).catch(() => null);
  const messageIdHeader = sentMetadata?.messageIdHeader;

  await markConnectionSent(connection.id).catch(() => undefined);
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
  token: OAuthTokenPayload,
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
    await markConnectionError(connection.id, message).catch(() => undefined);
    throw new MailboxFallbackSafeError(message);
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
    await markConnectionError(connection.id, message).catch(() => undefined);
    throw new MailboxFallbackSafeError(message);
  }

  const sent = await readMicrosoftSentMessage(created.id, token.accessToken).catch(() => null);
  await markConnectionSent(connection.id).catch(() => undefined);
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

async function sendSmtpMail(
  connection: MailboxConnectionRow,
  token: SmtpTokenPayload,
  input: MailboxSendInput
): Promise<MailboxSendResult> {
  const transporter = createSmtpTransport(token);
  try {
    const result = await transporter.sendMail({
      from: formatNamedAddress(input.senderName, connection.address),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo || connection.address,
      subject: input.subject || "A message from your insurance agency",
      text: input.text,
      html: input.html,
      inReplyTo: input.replyToMessageIdHeader,
      references: input.references,
      attachments: (input.attachments ?? []).map((attachment) => ({
        filename: attachment.fileName || "attachment",
        contentType: attachment.fileType || "application/octet-stream",
        content: Buffer.from(attachmentContentBase64(attachment), "base64"),
      })),
    });
    await markConnectionSent(connection.id).catch(() => undefined);
    return {
      provider: "smtp",
      status: "sent",
      externalMessageId: result.messageId || undefined,
      rfc822MessageId: result.messageId || undefined,
      messageIdHeader: result.messageId || undefined,
    };
  } catch (error) {
    const message = smtpCredentialError(error);
    await markConnectionError(connection.id, message).catch(() => undefined);
    throw new MailboxFallbackSafeError(message);
  } finally {
    transporter.close();
  }
}

function createSmtpTransport(token: SmtpTokenPayload) {
  return nodemailer.createTransport({
    host: token.host,
    port: token.port,
    secure: token.secure,
    requireTLS: !token.secure,
    auth: { user: token.username, pass: token.password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

async function verifySmtpCredential(token: SmtpTokenPayload) {
  const transporter = createSmtpTransport(token);
  try {
    await transporter.verify();
  } catch (error) {
    throw new Error(smtpCredentialError(error));
  } finally {
    transporter.close();
  }
}

async function resolveSmtpConfiguration(
  email: string,
  provider: AgencyMarketingCredentialProvider
): Promise<{ host: string; port: number; secure: boolean }> {
  let resolvedProvider = provider;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (resolvedProvider === "auto") {
    resolvedProvider = providerFromDomain(domain) ?? (await providerFromMx(domain)) ?? "auto";
  }
  if (resolvedProvider === "google") return { host: "smtp.gmail.com", port: 465, secure: true };
  if (resolvedProvider === "microsoft") return { host: "smtp.office365.com", port: 587, secure: false };
  if (resolvedProvider === "yahoo") return { host: "smtp.mail.yahoo.com", port: 465, secure: true };
  if (resolvedProvider === "apple") return { host: "smtp.mail.me.com", port: 587, secure: false };
  if (resolvedProvider === "zoho") return { host: "smtp.zoho.com", port: 465, secure: true };
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) throw new Error("Enter a valid company email address.");
  return { host: `smtp.${domain}`, port: 587, secure: false };
}

function providerFromDomain(domain: string): Exclude<AgencyMarketingCredentialProvider, "auto"> | undefined {
  if (["gmail.com", "googlemail.com"].includes(domain)) return "google";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "microsoft";
  if (["yahoo.com", "ymail.com", "rocketmail.com"].includes(domain)) return "yahoo";
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return "apple";
  if (["zoho.com", "zohomail.com"].includes(domain)) return "zoho";
  return undefined;
}

async function providerFromMx(
  domain: string
): Promise<Exclude<AgencyMarketingCredentialProvider, "auto"> | undefined> {
  if (!domain) return undefined;
  try {
    const exchanges = (await resolveMx(domain)).map((row) => row.exchange.toLowerCase()).join(" ");
    if (/google|googlemail/.test(exchanges)) return "google";
    if (/outlook|protection\.outlook|microsoft/.test(exchanges)) return "microsoft";
    if (/yahoodns|yahoo/.test(exchanges)) return "yahoo";
    if (/icloud/.test(exchanges)) return "apple";
    if (/zoho/.test(exchanges)) return "zoho";
  } catch {
    return undefined;
  }
  return undefined;
}

function smtpCredentialError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The mailbox provider rejected the connection.";
  if (/auth|credential|password|535|5\.7\.8/i.test(raw)) {
    return "The company mailbox rejected those credentials. Use the mailbox provider's app password when required.";
  }
  if (/timeout|timed out|connect|enotfound|econn/i.test(raw)) {
    return "The company mailbox could not be reached. Check the email provider and try again.";
  }
  return "The company mailbox could not be verified. Check the email and app password, then try again.";
}

function formatNamedAddress(name: string | undefined, email: string): string {
  const cleanName = (name ?? "").replace(/[\r\n<>]/g, " ").replace(/\s{2,}/g, " ").trim();
  return cleanName ? `"${cleanName.replace(/"/g, "'")}" <${email}>` : email;
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
  if (parsed.provider === "smtp") {
    if (!parsed.username || !parsed.password || !parsed.host || !parsed.port) {
      throw new Error("Encrypted SMTP mailbox credentials are incomplete.");
    }
    return parsed as SmtpTokenPayload;
  }
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
    SET status = 'connected',
        last_send_at = now(),
        last_error = NULL,
        updated_at = now()
    WHERE id = ${connectionId}
  `;
}

async function markConnectionError(connectionId: string, error: string) {
  await prisma.$executeRaw`
    UPDATE mailbox_connections
    SET status = 'error',
        last_error = ${error.slice(0, 1000)},
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
