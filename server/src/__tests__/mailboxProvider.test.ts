import { createCipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  createTransport: vi.fn(),
  verifyTransport: vi.fn(),
  closeTransport: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

import {
  isMailboxFallbackSafeError,
  readFreshTenantStaffMailboxToken,
  saveAgencyMarketingSmtpCredential,
  sendMailboxEmail,
} from "../services/mailboxProvider.js";

const ENCRYPTION_SECRET = "mailbox-provider-test-key";

beforeEach(() => {
  vi.stubEnv("MAILBOX_TOKEN_ENCRYPTION_KEY", ENCRYPTION_SECRET);
  mocks.queryRaw.mockReset()
    .mockResolvedValueOnce([{
      id: "connection-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      provider: "microsoft",
      address: "agent@example.com",
      status: "connected",
      token_vault_ref: "mailbox-token:vault-1",
    }])
    .mockResolvedValueOnce([{
      encrypted_payload: encryptToken({
        provider: "microsoft",
        accessToken: "microsoft-access-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    }]);
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.transaction.mockReset().mockImplementation(async (callback) =>
    callback({ $executeRaw: mocks.executeRaw })
  );
  mocks.verifyTransport.mockReset().mockResolvedValue(true);
  mocks.closeTransport.mockReset();
  mocks.createTransport.mockReset().mockReturnValue({
    verify: mocks.verifyTransport,
    close: mocks.closeTransport,
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Microsoft mailbox send metadata", () => {
  it("refetches the sent item with an immutable ID and returns its exact link", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        id: "immutable-draft-id",
        conversationId: "draft-conversation",
        webLink: "https://outlook.office.com/mail/drafts/draft-link",
        internetMessageId: "<draft@example.com>",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        id: "immutable-draft-id",
        conversationId: "sent-conversation",
        webLink: "https://outlook.office.com/mail/sentitems/exact-link",
        internetMessageId: "<sent@example.com>",
        isDraft: false,
      }));

    const result = await sendMailboxEmail(validMicrosoftSend());

    expect(result).toEqual({
      provider: "microsoft",
      status: "sent",
      connectionId: "connection-1",
      mailboxAccount: "agent@example.com",
      externalMessageId: "immutable-draft-id",
      externalThreadId: "sent-conversation",
      externalUrl: "https://outlook.office.com/mail/sentitems/exact-link",
      rfc822MessageId: "<sent@example.com>",
      messageIdHeader: "<sent@example.com>",
    });
    expect(fetchMock()).toHaveBeenCalledTimes(3);
    expect(fetchMock().mock.calls[0][1]?.headers).toMatchObject({ Prefer: 'IdType="ImmutableId"' });
    expect(fetchMock().mock.calls[2][1]?.headers).toMatchObject({ Prefer: 'IdType="ImmutableId"' });
    expect(String(fetchMock().mock.calls[2][0])).toContain("/me/messages/immutable-draft-id?");
  });

  it("keeps a successful configured-provider send successful when sent-item lookup is unavailable", async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({
        id: "immutable-draft-id",
        conversationId: "draft-conversation",
        webLink: "https://outlook.office.com/mail/drafts/draft-link",
        internetMessageId: "<draft@example.com>",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "lookup unavailable" } }, 503));

    const result = await sendMailboxEmail(validMicrosoftSend());

    expect(result).toMatchObject({
      provider: "microsoft",
      status: "sent",
      externalMessageId: "immutable-draft-id",
      externalUrl: "https://outlook.office.com/mail/drafts/draft-link",
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not turn accepted provider delivery into a failure when bookkeeping is unavailable", async () => {
    mocks.executeRaw.mockRejectedValueOnce(new Error("database temporarily unavailable"));
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ id: "immutable-draft-id" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ id: "immutable-draft-id", isDraft: false }));

    await expect(sendMailboxEmail(validMicrosoftSend())).resolves.toMatchObject({
      provider: "microsoft",
      status: "sent",
      externalMessageId: "immutable-draft-id",
    });
  });

  it("marks an explicit provider rejection as safe for transactional fallback", async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ error: { message: "Mailbox permission revoked" } }, 403));

    const error = await sendMailboxEmail(validMicrosoftSend()).catch((caught) => caught);

    expect(isMailboxFallbackSafeError(error)).toBe(true);
  });

  it("does not mark an ambiguous network failure as safe for fallback", async () => {
    fetchMock().mockRejectedValueOnce(new Error("connection reset after request write"));

    const error = await sendMailboxEmail(validMicrosoftSend()).catch((caught) => caught);

    expect(isMailboxFallbackSafeError(error)).toBe(false);
  });

  it("refuses to send through a mailbox that does not match the required sender address", async () => {
    mocks.queryRaw.mockReset().mockResolvedValueOnce([{
      id: "connection-1",
      tenant_id: "tenant-1",
      user_id: null,
      provider: "microsoft",
      address: "old-marketing@example.com",
      status: "connected",
      token_vault_ref: "mailbox-token:vault-1",
    }]);

    const error = await sendMailboxEmail({
      ...validMicrosoftSend(),
      ownerType: "agency_marketing",
      expectedAddress: "contact@example.com",
    }).catch((caught) => caught);

    expect(isMailboxFallbackSafeError(error)).toBe(true);
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

describe("tenant mailbox reply sync", () => {
  it("recovers a reconnected sender mailbox when a quote flow retains a stale connection id", async () => {
    mocks.queryRaw.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "current-connection",
        tenant_id: "tenant-1",
        user_id: "user-1",
        provider: "google",
        address: "agent@example.com",
        status: "connected",
        token_vault_ref: "mailbox-token:current",
      }])
      .mockResolvedValueOnce([{
        encrypted_payload: encryptToken({
          provider: "google",
          accessToken: "google-access-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      }]);

    const result = await readFreshTenantStaffMailboxToken({
      tenantId: "tenant-1",
      connectionId: "retired-connection",
      expectedAddress: "Agent@Example.com",
    });

    expect(result.connection).toMatchObject({
      id: "current-connection",
      tenant_id: "tenant-1",
      address: "agent@example.com",
    });
    expect(result.token).toMatchObject({
      provider: "google",
      accessToken: "google-access-token",
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });
});

describe("agency marketing SMTP credentials", () => {
  it("verifies the mailbox before persisting it as connected", async () => {
    const connection = await saveAgencyMarketingSmtpCredential({
      tenantId: "tenant-1",
      updatedById: "manager-1",
      agencyName: "Example Agency",
      email: "marketing@gmail.com",
      password: "app-password",
      provider: "auto",
    });

    expect(mocks.verifyTransport).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(connection).toMatchObject({
      address: "marketing@gmail.com",
      status: "connected",
    });
  });

  it("does not persist credentials when the provider rejects them", async () => {
    mocks.verifyTransport.mockRejectedValueOnce(new Error("535 5.7.8 Username and Password not accepted"));

    await expect(
      saveAgencyMarketingSmtpCredential({
        tenantId: "tenant-1",
        updatedById: "manager-1",
        agencyName: "Example Agency",
        email: "marketing@gmail.com",
        password: "wrong-password",
        provider: "auto",
      })
    ).rejects.toThrow(/rejected those credentials/i);

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.closeTransport).toHaveBeenCalledTimes(1);
  });
});

function validMicrosoftSend() {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    to: ["client@example.com"],
    subject: "Policy update",
    text: "Your policy is ready.",
  };
}

function encryptToken(payload: Record<string, unknown>) {
  const key = createHash("sha256").update(ENCRYPTION_SECRET).digest();
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    alg: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    keyRef: "env:MAILBOX_TOKEN_ENCRYPTION_KEY",
  };
}

function fetchMock() {
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
