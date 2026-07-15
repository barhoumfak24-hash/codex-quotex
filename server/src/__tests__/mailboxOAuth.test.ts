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
  mocks.queryRaw.mockReset().mockResolvedValue([{
    state: "oauth-state",
    tenant_id: "tenant-1",
    user_id: "user-1",
    provider: "google",
    redirect_after: "/employee/account-settings",
    code_verifier: "code-verifier",
    expires_at: new Date(Date.now() + 60_000),
  }]);
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
