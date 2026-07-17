import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  txExecuteRaw: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  databaseConfigured: () => true,
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));

import { completeMailboxOAuth } from "../services/mailboxOAuth.js";

beforeEach(() => {
  vi.stubEnv("MAILBOX_OAUTH_ENABLED", "true");
  vi.stubEnv("GOOGLE_MAILBOX_CLIENT_ID", "google-client");
  vi.stubEnv("GOOGLE_MAILBOX_CLIENT_SECRET", "google-secret");
  vi.stubEnv("MAILBOX_TOKEN_ENCRYPTION_KEY", "mailbox-test-encryption-key");
  mocks.queryRaw
    .mockReset()
    .mockResolvedValueOnce([{
      state: "oauth-state",
      tenant_id: "tenant-1",
      user_id: "user-1",
      provider: "google",
      owner_type: "staff",
      redirect_after: "/employee/account-settings",
      code_verifier: "code-verifier",
      expires_at: new Date(Date.now() + 60_000),
    }])
    .mockResolvedValueOnce([{ email: "agent@example.com" }]);
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.txExecuteRaw.mockReset().mockResolvedValue(1);
  mocks.transaction.mockReset().mockImplementation(async (callback) =>
    callback({ $executeRaw: mocks.txExecuteRaw })
  );
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("mailbox OAuth granted scopes", () => {
  it("persists and returns only scopes granted in the token response", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/gmail.send",
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(jsonResponse({
        sub: "google-account-1",
        email: "agent@example.com",
        name: "Agent Example",
      }));

    const result = await completeMailboxOAuth({
      provider: "google",
      code: "authorization-code",
      state: "oauth-state",
    });

    const grantedScopes = [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    expect(result.connection.scopes).toEqual(grantedScopes);
    expect(result.connection.scopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(mocks.txExecuteRaw.mock.calls[0].slice(1)).toContain(JSON.stringify(grantedScopes));
  });

  it("connects the exact agency contact mailbox as the campaign sender", async () => {
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{
        state: "oauth-state",
        tenant_id: "tenant-1",
        user_id: "manager-1",
        provider: "google",
        owner_type: "agency_marketing",
        redirect_after: "/employee/settings",
        code_verifier: "code-verifier",
        expires_at: new Date(Date.now() + 60_000),
      }])
      .mockResolvedValueOnce([{ email: "agency@example.com" }]);
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/gmail.send",
        token_type: "Bearer",
      }))
      .mockResolvedValueOnce(jsonResponse({
        sub: "google-agency-1",
        email: "agency@example.com",
        name: "Agency Team",
      }));

    const result = await completeMailboxOAuth({
      provider: "google",
      code: "authorization-code",
      state: "oauth-state",
    });

    expect(result.connection).toMatchObject({
      id: "mailbox_google_tenant-1_agency_marketing",
      ownerType: "agency_marketing",
      userId: null,
      address: "agency@example.com",
    });
    expect(mocks.txExecuteRaw.mock.calls[0].slice(1)).toContain("agency_marketing");
  });
});

function fetchMock() {
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
