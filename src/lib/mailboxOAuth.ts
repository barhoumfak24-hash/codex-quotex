import { apiBaseUrl } from "@/lib/apiBase";
import type { ConnectedMailbox, MailProvider, User } from "@/types";
import { currentServerSessionToken } from "@/lib/serverSession";

export type MailboxOAuthProvider = "google" | "microsoft";
export type MailboxOAuthOwnerType = "staff" | "agency_marketing";
export type AgencyMarketingCredentialProvider =
  | "auto"
  | "google"
  | "microsoft"
  | "yahoo"
  | "apple"
  | "zoho";

export type MailboxOAuthStartResult =
  | {
      ok: true;
      authorizationUrl: string;
      expiresAt: string;
    }
  | {
      ok: false;
      error?: string;
      message?: string;
    };

export type MailboxDiagnostic = {
  id: string;
  tenantId: string;
  userId?: string | null;
  ownerType: string;
  provider: string;
  address: string;
  displayName?: string | null;
  status: string;
  grantedScopes: string[];
  hasReadScope: boolean;
  hasSendScope: boolean;
  tokenStatus: "valid" | "needs_reauth";
  cursorPresent: boolean;
  cursorKind: "gmail_history" | "graph_delta" | "none";
  lastPoll: {
    at: string;
    action: string;
    fetched: number;
    created: number;
    updated: number;
    deduped: number;
    errors: number;
  } | null;
  inboundLast24h: number;
  lastError?: string | null;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSendAt?: string;
  updatedAt: string;
};

export async function startMailboxOAuth(input: {
  provider: MailboxOAuthProvider;
  user: User;
  tenantId: string;
  redirectAfter?: string;
  ownerType?: MailboxOAuthOwnerType;
}): Promise<MailboxOAuthStartResult> {
  const res = await fetch(`${apiBaseUrl()}/mailboxes/oauth/${input.provider}/start`, {
    method: "POST",
    headers: authHeaders(input.user, input.tenantId),
    body: JSON.stringify({
      redirectAfter: input.redirectAfter ?? "/employee/account-settings",
      ownerType: input.ownerType ?? "staff",
    }),
  });
  const json = (await res.json().catch(() => null)) as MailboxOAuthStartResult | null;
  if (json) return json;
  return { ok: false, error: "mailbox_oauth_failed", message: `${res.status} ${res.statusText}` };
}

export async function saveAgencyMarketingCredentials(input: {
  user: User;
  tenantId: string;
  email: string;
  password: string;
  provider?: AgencyMarketingCredentialProvider;
}): Promise<
  | { ok: true; connection: ConnectedMailbox; passwordConfigured: true }
  | { ok: false; error?: string; message?: string }
> {
  const res = await fetch(`${apiBaseUrl()}/mailboxes/agency-marketing/credentials`, {
    method: "POST",
    headers: authHeaders(input.user, input.tenantId),
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      provider: input.provider ?? "auto",
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | {
        ok: true;
        connection: ServerMailboxConnection;
        passwordConfigured: true;
      }
    | { ok: false; error?: string; message?: string }
    | null;
  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      error: json && "error" in json ? json.error : "agency_marketing_mailbox_failed",
      message:
        (json && "message" in json && json.message) ||
        `Company mailbox setup failed with ${res.status} ${res.statusText}.`,
    };
  }
  return {
    ok: true,
    connection: toConnectedMailbox(json.connection),
    passwordConfigured: true,
  };
}

export async function listMailboxConnections(input: {
  user: User;
  tenantId: string;
  mineOnly?: boolean;
}): Promise<
  | { ok: true; connections: ConnectedMailbox[] }
  | { ok: false; error?: string; message?: string }
> {
  const params = new URLSearchParams();
  if (input.mineOnly ?? true) params.set("mine", "true");
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(`${apiBaseUrl()}/mailboxes/connections${suffix}`, {
    method: "GET",
    headers: authHeaders(input.user, input.tenantId),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: true; connections?: ServerMailboxConnection[] }
    | { ok: false; error?: string; message?: string }
    | null;
  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      error: json && "error" in json ? json.error : "mailbox_connections_failed",
      message:
        (json && "message" in json && json.message) ||
        `Mailbox connection status failed with ${res.status} ${res.statusText}.`,
    };
  }
  return { ok: true, connections: (json.connections ?? []).map(toConnectedMailbox) };
}

export async function listMailboxDiagnostics(input: {
  user: User;
  tenantId: string;
  mineOnly?: boolean;
}): Promise<
  | { ok: true; diagnostics: MailboxDiagnostic[] }
  | { ok: false; error?: string; message?: string }
> {
  const params = new URLSearchParams();
  if (input.mineOnly ?? true) params.set("mine", "true");
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(`${apiBaseUrl()}/mailboxes/diagnostics${suffix}`, {
    method: "GET",
    headers: authHeaders(input.user, input.tenantId),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: true; diagnostics?: MailboxDiagnostic[] }
    | { ok: false; error?: string; message?: string }
    | null;
  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      error: json && "error" in json ? json.error : "mailbox_diagnostics_failed",
      message:
        (json && "message" in json && json.message) ||
        `Mailbox diagnostics failed with ${res.status} ${res.statusText}.`,
    };
  }
  return { ok: true, diagnostics: json.diagnostics ?? [] };
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
  return currentServerSessionToken();
}

type ServerMailboxConnection = {
  id: string;
  tenantId: string;
  userId?: string | null;
  ownerType?: string;
  provider: string;
  address: string;
  displayName?: string | null;
  status: string;
  authMode?: string;
  scopes?: unknown[];
  tokenVaultRef?: string | null;
  externalAccountId?: string | null;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSendAt?: string;
  lastError?: string | null;
  updatedAt: string;
};

function toConnectedMailbox(row: ServerMailboxConnection): ConnectedMailbox {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerType: row.ownerType === "agency_marketing" ? "agency_marketing" : "staff",
    userId: row.userId ?? undefined,
    address: row.address,
    provider: providerToMailProvider(row.provider),
    displayName: row.displayName ?? undefined,
    status:
      row.status === "connected" ||
      row.status === "needs_auth" ||
      row.status === "needs_reauth" ||
      row.status === "error" ||
      row.status === "disabled"
        ? row.status
        : "needs_auth",
    authMode: row.authMode === "smtp_imap" || row.authMode === "demo" ? row.authMode : "oauth",
    scopes: normalizeScopes(row.scopes),
    tokenVaultRef: row.tokenVaultRef ?? undefined,
    externalAccountId: row.externalAccountId ?? undefined,
    connectedAt: row.connectedAt,
    lastSyncAt: row.lastSyncAt,
    lastSendAt: row.lastSendAt,
    lastError: row.lastError ?? undefined,
    updatedAt: row.updatedAt,
  };
}

function providerToMailProvider(provider: string): MailProvider {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "google" || normalized === "gmail") return "gmail";
  if (normalized === "microsoft" || normalized === "outlook") return "outlook";
  return "other";
}

function normalizeScopes(scopes: unknown[] | undefined): ConnectedMailbox["scopes"] {
  const normalized = new Set<"send" | "read" | "sync">();
  for (const scope of scopes ?? []) {
    if (typeof scope !== "string") continue;
    const value = scope.trim().toLowerCase();
    if (!value) continue;
    if (value === "send" || value.includes("gmail.send") || value === "mail.send" || value.endsWith("/mail.send")) {
      normalized.add("send");
    }
    if (
      value === "read" ||
      value.includes("gmail.readonly") ||
      value.includes("gmail.modify") ||
      value === "mail.read" ||
      value === "mail.readwrite" ||
      value.endsWith("/mail.read") ||
      value.endsWith("/mail.readwrite")
    ) {
      normalized.add("read");
      normalized.add("sync");
    }
    if (value === "sync") normalized.add("sync");
  }
  return Array.from(normalized);
}
