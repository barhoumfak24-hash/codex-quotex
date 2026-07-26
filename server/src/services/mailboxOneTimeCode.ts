import { createHash } from "node:crypto";
import { readFreshMailboxToken, type OAuthTokenPayload } from "./mailboxProvider.js";

const CODE_CONTEXT =
  /verification code|security code|one[- ]time (?:password|passcode|code)|\botp\b|authentication code|login code|access code/i;
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const GENERIC_CARRIER_WORDS = new Set([
  "agent", "agency", "carrier", "company", "commercial", "insurance", "insurer", "login", "portal",
]);

type MailboxMessage = {
  id: string;
  receivedAt: number;
  from: string;
  subject: string;
  body: string;
};

export type EmailCodeLookupInput = {
  tenantId: string;
  userId: string;
  carrierName: string;
  carrierHost: string;
  jobCreatedAt: Date;
  excludeMessageKeys?: string[];
};

export type EmailCodeLookupResult =
  | { status: "found"; code: string; messageKey: string; provider: "google" | "microsoft" }
  | { status: "not_found" | "ambiguous" | "mailbox_unavailable"; reason: string };

export async function findCarrierEmailVerificationCode(
  input: EmailCodeLookupInput
): Promise<EmailCodeLookupResult> {
  let mailbox: Awaited<ReturnType<typeof readFreshMailboxToken>>;
  try {
    mailbox = await readFreshMailboxToken({
      tenantId: input.tenantId,
      userId: input.userId,
      ownerType: "staff",
    });
  } catch {
    return {
      status: "mailbox_unavailable",
      reason: "The signed-in staff mailbox is not available for secure inbox reading.",
    };
  }

  const earliest = Math.max(
    input.jobCreatedAt.getTime() - 30_000,
    Date.now() - MAX_MESSAGE_AGE_MS
  );
  let messages: MailboxMessage[];
  try {
    messages =
      mailbox.token.provider === "google"
        ? await readRecentGoogleMessages(mailbox.token, earliest)
        : await readRecentMicrosoftMessages(mailbox.token, earliest);
  } catch {
    return {
      status: "mailbox_unavailable",
      reason: "The connected mailbox could not be checked securely.",
    };
  }

  const excluded = new Set(input.excludeMessageKeys ?? []);
  const matches = messages
    .filter((message) => message.receivedAt >= earliest)
    .filter((message) => messageMatchesCarrier(message, input.carrierName, input.carrierHost))
    .flatMap((message) => {
      const codes = extractOneTimeCodes(`${message.subject}\n${message.body}`);
      if (codes.length !== 1) return [];
      const messageKey = secureMessageKey(mailbox.connection.id, message.id);
      if (excluded.has(messageKey)) return [];
      return [{ message, code: codes[0] as string, messageKey }];
    })
    .sort((a, b) => b.message.receivedAt - a.message.receivedAt);

  if (matches.length === 0) {
    return { status: "not_found", reason: "No recent matching carrier email code was found." };
  }
  if (
    matches.length > 1 &&
    matches[0]?.code !== matches[1]?.code &&
    Math.abs((matches[0]?.message.receivedAt ?? 0) - (matches[1]?.message.receivedAt ?? 0)) < 30_000
  ) {
    return {
      status: "ambiguous",
      reason: "More than one recent carrier verification code matched, so none was selected.",
    };
  }
  return {
    status: "found",
    code: matches[0]!.code,
    messageKey: matches[0]!.messageKey,
    provider: mailbox.token.provider,
  };
}

export function extractOneTimeCodes(value: string): string[] {
  const text = htmlToText(value);
  const matches = [...text.matchAll(new RegExp(CODE_CONTEXT.source, "gi"))];
  const codes = new Set<string>();
  for (const match of matches) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 48), index);
    const after = text.slice(
      index + match[0].length,
      Math.min(text.length, index + match[0].length + 64)
    );
    const afterCodes = candidateCodes(after);
    const beforeCodes = candidateCodes(before);
    const nearest = afterCodes[0] ?? beforeCodes.at(-1);
    if (nearest) codes.add(nearest);
  }
  return [...codes];
}

function candidateCodes(value: string): string[] {
  return [
    ...value.matchAll(
      /(?<![A-Z0-9])([0-9]{4,8}|(?=[A-Z0-9]{6,8}(?![A-Z0-9]))(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})(?![A-Z0-9])/gi
    ),
  ]
    .map((match) => String(match[1] ?? "").toUpperCase())
    .filter(Boolean);
}

export function messageMatchesCarrier(
  message: Pick<MailboxMessage, "from" | "subject">,
  carrierName: string,
  carrierHost: string
): boolean {
  const searchable = `${message.from} ${message.subject}`.toLowerCase();
  const terms = meaningfulCarrierTerms(carrierName, carrierHost);
  return terms.length > 0 && terms.some((term) => searchable.includes(term));
}

function meaningfulCarrierTerms(carrierName: string, carrierHost: string): string[] {
  const hostTerms = normalizeHost(carrierHost)
    .split(".")
    .filter((term) => term.length >= 3 && !["www", "com", "net", "org", "login", "portal", "agents"].includes(term));
  const nameTerms = carrierName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !GENERIC_CARRIER_WORDS.has(term));
  return [...new Set([...hostTerms, ...nameTerms])];
}

async function readRecentGoogleMessages(token: OAuthTokenPayload, earliest: number): Promise<MailboxMessage[]> {
  const query = encodeURIComponent(`after:${Math.floor(earliest / 1000)}`);
  const list = await providerJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${query}`,
    token.accessToken
  );
  const refs = Array.isArray(list?.messages) ? list.messages.slice(0, 20) : [];
  const messages: MailboxMessage[] = [];
  for (const ref of refs) {
    if (!ref?.id) continue;
    const raw = await providerJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
      token.accessToken
    );
    const headers = Array.isArray(raw?.payload?.headers) ? raw.payload.headers : [];
    messages.push({
      id: String(raw.id),
      receivedAt: Number(raw.internalDate ?? 0),
      from: headerValue(headers, "from"),
      subject: headerValue(headers, "subject"),
      body: googlePayloadText(raw.payload),
    });
  }
  return messages;
}

async function readRecentMicrosoftMessages(
  token: OAuthTokenPayload,
  earliest: number
): Promise<MailboxMessage[]> {
  const iso = new Date(earliest).toISOString();
  const params = new URLSearchParams({
    "$top": "20",
    "$filter": `receivedDateTime ge ${iso}`,
    "$orderby": "receivedDateTime desc",
    "$select": "id,receivedDateTime,from,subject,body,bodyPreview",
  });
  const data = await providerJson(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`,
    token.accessToken
  );
  return (Array.isArray(data?.value) ? data.value : []).map((message: any) => ({
    id: String(message.id ?? ""),
    receivedAt: Date.parse(String(message.receivedDateTime ?? "")) || 0,
    from: String(message.from?.emailAddress?.address ?? ""),
    subject: String(message.subject ?? ""),
    body: String(message.body?.content ?? message.bodyPreview ?? ""),
  }));
}

async function providerJson(url: string, accessToken: string): Promise<any> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`mailbox_provider_${response.status}`);
  return response.json();
}

function googlePayloadText(payload: any): string {
  if (!payload || typeof payload !== "object") return "";
  const own = decodeBase64Url(payload.body?.data);
  const child = Array.isArray(payload.parts) ? payload.parts.map(googlePayloadText).join("\n") : "";
  return `${own}\n${child}`.trim();
}

function decodeBase64Url(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function headerValue(headers: any[], name: string): string {
  return String(headers.find((header) => String(header?.name ?? "").toLowerCase() === name)?.value ?? "");
}

function htmlToText(value: string): string {
  return String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHost(value: string): string {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  }
}

function secureMessageKey(connectionId: string, messageId: string): string {
  return createHash("sha256").update(`${connectionId}:${messageId}`).digest("hex");
}
