import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { databaseConfigured, prisma } from "./prisma.js";

export type MailboxOAuthProvider = "google" | "microsoft";

type ProviderConfig = {
  provider: MailboxOAuthProvider;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

type OAuthStateRow = {
  state: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  redirect_after: string | null;
  code_verifier: string;
  expires_at: Date;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type ProviderProfile = {
  externalAccountId?: string;
  email: string;
  displayName?: string;
};

export function mailboxOAuthReadiness() {
  return {
    enabled: env("MAILBOX_OAUTH_ENABLED") === "true",
    databaseConfigured: databaseConfigured(),
    tokenEncryptionConfigured: Boolean(env("MAILBOX_TOKEN_ENCRYPTION_KEY")),
    providers: (["google", "microsoft"] as const).map((provider) => {
      const missing = missingProviderConfig(provider);
      return {
        provider,
        configured: missing.length === 0,
        missing,
      };
    }),
  };
}

export async function createMailboxOAuthStart(input: {
  provider: MailboxOAuthProvider;
  tenantId: string;
  userId: string;
  redirectAfter?: string;
}) {
  assertMailboxOAuthEnabled();
  if (!databaseConfigured()) {
    return {
      ok: false as const,
      error: "database_not_configured",
      message: "DATABASE_URL is required before mailbox OAuth can persist token state.",
    };
  }

  const config = providerConfig(input.provider);
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const redirectAfter = safeRedirectAfter(input.redirectAfter);

  await prisma.$executeRaw`
    INSERT INTO mailbox_oauth_states (
      state,
      tenant_id,
      user_id,
      provider,
      redirect_after,
      code_verifier,
      expires_at
    )
    VALUES (
      ${state},
      ${input.tenantId},
      ${input.userId},
      ${input.provider},
      ${redirectAfter},
      ${codeVerifier},
      ${expiresAt}
    )
    ON CONFLICT (state)
    DO UPDATE SET
      tenant_id = excluded.tenant_id,
      user_id = excluded.user_id,
      provider = excluded.provider,
      redirect_after = excluded.redirect_after,
      code_verifier = excluded.code_verifier,
      expires_at = excluded.expires_at
  `;

  const authorizationUrl = new URL(config.authorizationEndpoint);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  if (input.provider === "google") {
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("include_granted_scopes", "true");
    authorizationUrl.searchParams.set("prompt", "consent");
  } else {
    authorizationUrl.searchParams.set("prompt", "select_account");
  }

  return {
    ok: true as const,
    authorizationUrl: authorizationUrl.toString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeMailboxOAuth(input: {
  provider: MailboxOAuthProvider;
  code: string;
  state: string;
}) {
  assertMailboxOAuthEnabled();
  const config = providerConfig(input.provider);
  const rows = await prisma.$queryRaw<OAuthStateRow[]>`
    SELECT state, tenant_id, user_id, provider, redirect_after, code_verifier, expires_at
    FROM mailbox_oauth_states
    WHERE state = ${input.state}
      AND provider = ${input.provider}
    LIMIT 1
  `;
  const oauthState = rows[0];
  if (!oauthState) throw new Error("OAuth state was not found or already used.");
  if (oauthState.expires_at.getTime() < Date.now()) {
    await deleteOAuthState(oauthState.state);
    throw new Error("OAuth state expired. Start the mailbox connection again.");
  }

  const token = await exchangeCodeForToken(config, input.code, oauthState.code_verifier);
  if (!token.access_token) throw new Error(token.error_description ?? token.error ?? "Token exchange failed.");
  const profile = await readProviderProfile(input.provider, token.access_token);
  const now = new Date();
  const connectionId = `mailbox_${input.provider}_${oauthState.tenant_id}_${oauthState.user_id}`;
  const vaultId = `mailbox_token_${connectionId}`;
  const tokenVaultRef = `mailbox-token:${vaultId}`;
  const expiresAt =
    typeof token.expires_in === "number" && Number.isFinite(token.expires_in)
      ? new Date(now.getTime() + token.expires_in * 1000).toISOString()
      : undefined;
  const encryptedPayload = encryptTokenPayload({
    provider: input.provider,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    scope: token.scope,
    idToken: token.id_token,
    expiresAt,
    externalAccountId: profile.externalAccountId,
    email: profile.email,
    connectedAt: now.toISOString(),
  });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`
      INSERT INTO mailbox_connections (
        id,
        tenant_id,
        user_id,
        owner_type,
        provider,
        address,
        display_name,
        status,
        auth_mode,
        scopes,
        token_vault_ref,
        external_account_id,
        connected_at,
        updated_at,
        updated_by_id
      )
      VALUES (
        ${connectionId},
        ${oauthState.tenant_id},
        ${oauthState.user_id},
        ${"staff"},
        ${input.provider},
        ${profile.email},
        ${profile.displayName ?? profile.email},
        ${"connected"},
        ${"oauth"},
        ${JSON.stringify(config.scopes)}::jsonb,
        ${tokenVaultRef},
        ${profile.externalAccountId ?? null},
        ${now},
        ${now},
        ${oauthState.user_id}
      )
      ON CONFLICT (id)
      DO UPDATE SET
        provider = excluded.provider,
        address = excluded.address,
        display_name = excluded.display_name,
        status = excluded.status,
        auth_mode = excluded.auth_mode,
        scopes = excluded.scopes,
        token_vault_ref = excluded.token_vault_ref,
        external_account_id = excluded.external_account_id,
        connected_at = excluded.connected_at,
        updated_at = excluded.updated_at,
        updated_by_id = excluded.updated_by_id,
        last_error = NULL
    `;

    await tx.$executeRaw`
      INSERT INTO mailbox_token_vault (
        id,
        tenant_id,
        connection_id,
        provider,
        encrypted_payload,
        encryption_key_ref,
        created_at,
        updated_at
      )
      VALUES (
        ${vaultId},
        ${oauthState.tenant_id},
        ${connectionId},
        ${input.provider},
        ${JSON.stringify(encryptedPayload)}::jsonb,
        ${env("MAILBOX_TOKEN_KEY_REF") || "env:MAILBOX_TOKEN_ENCRYPTION_KEY"},
        ${now},
        ${now}
      )
      ON CONFLICT (connection_id)
      DO UPDATE SET
        provider = excluded.provider,
        encrypted_payload = excluded.encrypted_payload,
        encryption_key_ref = excluded.encryption_key_ref,
        updated_at = excluded.updated_at
    `;

    await tx.$executeRaw`
      DELETE FROM mailbox_oauth_states
      WHERE state = ${oauthState.state}
    `;
  });

  return {
    redirectAfter: safeRedirectAfter(oauthState.redirect_after),
    connection: {
      id: connectionId,
      tenantId: oauthState.tenant_id,
      userId: oauthState.user_id,
      provider: input.provider,
      address: profile.email,
      displayName: profile.displayName ?? profile.email,
      status: "connected",
      authMode: "oauth",
      scopes: config.scopes,
      tokenVaultRef,
      externalAccountId: profile.externalAccountId,
    },
  };
}

export async function listMailboxConnections(input: { tenantId: string; userId?: string }) {
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
      auth_mode: string;
      scopes: unknown;
      token_vault_ref: string | null;
      external_account_id: string | null;
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
      auth_mode,
      scopes,
      token_vault_ref,
      external_account_id,
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

  return rows.map((row: (typeof rows)[number]) => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    ownerType: row.owner_type,
    provider: row.provider,
    address: row.address,
    displayName: row.display_name,
    status: row.status,
    authMode: row.auth_mode,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    tokenVaultRef: row.token_vault_ref,
    externalAccountId: row.external_account_id,
    connectedAt: row.connected_at?.toISOString(),
    lastSyncAt: row.last_sync_at?.toISOString(),
    lastSendAt: row.last_send_at?.toISOString(),
    lastError: row.last_error,
    updatedAt: row.updated_at.toISOString(),
  }));
}

async function exchangeCodeForToken(config: ProviderConfig, code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await safeJson(res)) as TokenResponse | null;
  if (!res.ok) {
    throw new Error(json?.error_description ?? json?.error ?? `Token exchange failed with ${res.status}.`);
  }
  return json ?? {};
}

async function readProviderProfile(provider: MailboxOAuthProvider, accessToken: string): Promise<ProviderProfile> {
  const endpoint =
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
  const res = await fetch(endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const json = (await safeJson(res)) as Record<string, unknown> | null;
  if (!res.ok || !json) throw new Error(`Could not read ${provider} mailbox profile.`);
  if (provider === "google") {
    const email = asString(json.email);
    if (!email) throw new Error("Google did not return a mailbox email address.");
    return {
      externalAccountId: asString(json.sub),
      email,
      displayName: asString(json.name) ?? email,
    };
  }
  const email = asString(json.mail) ?? asString(json.userPrincipalName);
  if (!email) throw new Error("Microsoft did not return a mailbox email address.");
  return {
    externalAccountId: asString(json.id),
    email,
    displayName: asString(json.displayName) ?? email,
  };
}

function providerConfig(provider: MailboxOAuthProvider): ProviderConfig {
  const missing = missingProviderConfig(provider);
  if (missing.length > 0) {
    throw new Error(`${provider} mailbox OAuth is not configured. Missing: ${missing.join(", ")}.`);
  }
  if (provider === "google") {
    return {
      provider,
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      clientId: env("GOOGLE_MAILBOX_CLIENT_ID"),
      clientSecret: env("GOOGLE_MAILBOX_CLIENT_SECRET"),
      redirectUri: redirectUri(provider, "GOOGLE_MAILBOX_REDIRECT_URI"),
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
    provider,
    authorizationEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    clientId: env("MICROSOFT_MAILBOX_CLIENT_ID"),
    clientSecret: env("MICROSOFT_MAILBOX_CLIENT_SECRET"),
    redirectUri: redirectUri(provider, "MICROSOFT_MAILBOX_REDIRECT_URI"),
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

function missingProviderConfig(provider: MailboxOAuthProvider): string[] {
  const keys =
    provider === "google"
      ? ["GOOGLE_MAILBOX_CLIENT_ID", "GOOGLE_MAILBOX_CLIENT_SECRET"]
      : ["MICROSOFT_MAILBOX_CLIENT_ID", "MICROSOFT_MAILBOX_CLIENT_SECRET"];
  return keys.filter((key) => !env(key));
}

function redirectUri(provider: MailboxOAuthProvider, envKey: string): string {
  const configured = env(envKey);
  if (configured) return configured;
  const origin = env("MAILBOX_OAUTH_PUBLIC_API_ORIGIN") || defaultMailboxOrigin();
  return `${origin.replace(/\/+$/, "")}/api/mailboxes/oauth/${provider}/callback`;
}

function defaultMailboxOrigin(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("MAILBOX_OAUTH_PUBLIC_API_ORIGIN is required for mailbox OAuth in production.");
  }
  return "http://localhost:4000";
}

function encryptTokenPayload(payload: Record<string, unknown>): Record<string, string> {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
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
  const raw = env("MAILBOX_TOKEN_ENCRYPTION_KEY");
  if (!raw) throw new Error("MAILBOX_TOKEN_ENCRYPTION_KEY is required to store mailbox OAuth tokens.");
  const base64 = Buffer.from(raw, "base64");
  if (base64.length === 32) return base64;
  return createHash("sha256").update(raw).digest();
}

function assertMailboxOAuthEnabled() {
  if (env("MAILBOX_OAUTH_ENABLED") !== "true") {
    throw new Error("Mailbox OAuth is disabled. Set MAILBOX_OAUTH_ENABLED=true after provider credentials are configured.");
  }
}

function safeRedirectAfter(value?: string | null): string {
  const fallback = "/employee/account-settings";
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function env(key: string) {
  return process.env[key]?.trim() ?? "";
}

function envList(key: string, fallback: string[]) {
  const configured = env(key)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function deleteOAuthState(state: string) {
  await prisma.$executeRaw`
    DELETE FROM mailbox_oauth_states
    WHERE state = ${state}
  `;
}
