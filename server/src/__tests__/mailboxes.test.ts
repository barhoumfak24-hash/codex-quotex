import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceTenantIsolation, requireAuth } from "../middleware/auth.js";
import { issueSessionJwt } from "../routes/auth.js";

const mocks = vi.hoisted(() => ({
  sendMailboxEmail: vi.fn(),
  syncMailboxMessages: vi.fn(),
  listMailboxSyncStatus: vi.fn(),
  listMailboxDiagnostics: vi.fn(),
  sendEmail: vi.fn(),
  emailDeliveryConfiguration: vi.fn(),
  listMailboxConnections: vi.fn(),
}));

vi.mock("../services/mailboxOAuth.js", async () => {
  const actual = await vi.importActual<typeof import("../services/mailboxOAuth.js")>(
    "../services/mailboxOAuth.js"
  );
  return { ...actual, listMailboxConnections: mocks.listMailboxConnections };
});

vi.mock("../services/mailboxProvider.js", () => ({
  sendMailboxEmail: mocks.sendMailboxEmail,
}));

vi.mock("../services/mailboxSync.js", () => ({
  syncMailboxMessages: mocks.syncMailboxMessages,
  listMailboxSyncStatus: mocks.listMailboxSyncStatus,
  listMailboxDiagnostics: mocks.listMailboxDiagnostics,
}));

vi.mock("../services/email.js", () => ({
  sendEmail: mocks.sendEmail,
  emailDeliveryConfiguration: mocks.emailDeliveryConfiguration,
}));

const JWT_SECRET = "test-jwt-secret-with-more-than-32-characters";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", JWT_SECRET);
  vi.stubEnv("JWT_ISSUER", "");
  vi.stubEnv("JWT_AUDIENCE", "");
  mocks.sendMailboxEmail.mockReset();
  mocks.syncMailboxMessages.mockReset();
  mocks.listMailboxSyncStatus.mockReset();
  mocks.listMailboxDiagnostics.mockReset();
  mocks.sendEmail.mockReset();
  mocks.emailDeliveryConfiguration.mockReset();
  mocks.listMailboxConnections.mockReset();
  mocks.emailDeliveryConfiguration.mockReturnValue({
    configured: true,
    provider: "sendgrid",
    from: "Quotex Insurance <verified@quotexinsurance.com>",
    missingEnvironmentVariables: [],
    acceptedConfigurations: [["SENDGRID_API_KEY", "EMAIL_FROM or SENDGRID_FROM_EMAIL"]],
  });
  mocks.listMailboxConnections.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mailbox delivery routes", () => {
  it("reports the authenticated staff member's real email capability", async () => {
    mocks.listMailboxConnections.mockResolvedValue([
      { id: "mailbox_1", userId: "user_mail", status: "connected" },
    ]);

    const response = await getMailbox("/capability", staffToken());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      capability: {
        mailboxConnected: true,
        transactionalConfigured: true,
        transactionalProvider: "sendgrid",
        missingEnvironmentVariables: [],
      },
    });
    expect(mocks.listMailboxConnections).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
    });
  });

  it("requires a signed session before sending email", async () => {
    const response = await postMailbox("/send", validSendPayload());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.sendMailboxEmail).not.toHaveBeenCalled();
  });

  it("returns the exact live mailbox send contract on provider success", async () => {
    mocks.sendMailboxEmail.mockResolvedValue({
      provider: "google",
      status: "sent",
      externalMessageId: "gmail_msg_1",
      externalThreadId: "gmail_thread_1",
      externalUrl: "https://mail.google.com/mail/u/?authuser=agent%40example.com#search/rfc822msgid:gmail-msg-1%40example.test",
      rfc822MessageId: "<gmail-msg-1@example.test>",
      messageIdHeader: "<gmail-msg-1@example.test>",
    });

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      result: {
        provider: "google",
        status: "sent",
        externalMessageId: "gmail_msg_1",
        externalThreadId: "gmail_thread_1",
        externalUrl: "https://mail.google.com/mail/u/?authuser=agent%40example.com#search/rfc822msgid:gmail-msg-1%40example.test",
        rfc822MessageId: "<gmail-msg-1@example.test>",
        messageIdHeader: "<gmail-msg-1@example.test>",
      },
    });
    expect(mocks.sendMailboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_mail",
        userId: "user_mail",
        to: ["client@example.com"],
        subject: "Hello from Quotex",
      })
    );
  });

  it("never falls back to a Quotex sender when the staff mailbox is not connected", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: "mailbox_connection_required",
      message: "Connect your Google or Microsoft mailbox in Account settings before sending email.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("passes the staff owner identity to the live mailbox provider", async () => {
    mocks.sendMailboxEmail.mockResolvedValue({ provider: "microsoft", status: "sent" });

    const response = await postMailbox("/send", validSendPayload(), staffToken());

    expect(response.status).toBe(200);
    expect(mocks.sendMailboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "staff", userId: "user_mail" })
    );
  });

  it("returns a readable failure when the staff mailbox cannot deliver", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: "mailbox_connection_required",
      reason: "No connected mailbox was found for this staff account.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends agency campaigns through the connected agency mailbox", async () => {
    mocks.sendMailboxEmail.mockResolvedValue({
      externalMessageId: "gmail_campaign_1",
      provider: "google",
      status: "sent",
    });

    const response = await postMailbox(
      "/send",
      {
        ...validSendPayload(),
        senderMode: "agency_marketing",
        senderName: "Palm Coast Private Client",
        replyTo: "contact@palmcoast.example",
      },
      staffToken()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        provider: "google",
        status: "sent",
        externalMessageId: "gmail_campaign_1",
      },
    });
    expect(mocks.sendMailboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: "agency_marketing",
        to: ["client@example.com"],
      })
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("does not report an agency campaign as sent when its mailbox is not connected", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected agency marketing mailbox was found."));

    const response = await postMailbox(
      "/send",
      {
        ...validSendPayload(),
        senderMode: "agency_marketing",
        senderName: "Palm Coast Private Client",
        replyTo: "contact@palmcoast.example",
      },
      staffToken()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: "mailbox_connection_required",
      message: "Connect the agency main mailbox in Agency setup before sending campaigns.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("syncs provider messages through the same authenticated route", async () => {
    mocks.syncMailboxMessages.mockResolvedValue({
      connectionId: "mailbox_conn_1",
      mailboxAccount: "agent@example.com",
      provider: "gmail",
      messages: [
        {
          mailboxAccount: "agent@example.com",
          mailboxConnectionId: "mailbox_conn_1",
          provider: "gmail",
          externalMessageId: "gmail_msg_in_1",
          from: "client@example.com",
          to: ["agent@example.com"],
          subject: "Reply",
          body: "Thanks",
          direction: "inbound",
        },
      ],
    });

    const response = await postMailbox("/sync", { maxResults: 10 }, staffToken());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        mailboxAccount: "agent@example.com",
        provider: "gmail",
        messages: [{ externalMessageId: "gmail_msg_in_1", direction: "inbound" }],
      },
    });
    expect(mocks.syncMailboxMessages).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
      connectionId: undefined,
      maxResults: 10,
    });
  });
});

async function postMailbox(path: string, payload: unknown, token?: string): Promise<Response> {
  const { mailboxesRoutes } = await import("../routes/mailboxes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/mailboxes", requireAuth, enforceTenantIsolation, mailboxesRoutes);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    return await fetch(`http://127.0.0.1:${address.port}/api/mailboxes${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function getMailbox(path: string, token?: string): Promise<Response> {
  const { mailboxesRoutes } = await import("../routes/mailboxes.js");
  const app = express();
  app.use(express.json());
  app.use("/api/mailboxes", requireAuth, enforceTenantIsolation, mailboxesRoutes);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    return await fetch(`http://127.0.0.1:${address.port}/api/mailboxes${path}`, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function staffToken() {
  return issueSessionJwt({
    userId: "user_mail",
    role: "manager",
    tenantId: "tenant_mail",
    branchId: "branch_mail",
  });
}

function validSendPayload() {
  return {
    to: ["client@example.com"],
    cc: [],
    bcc: [],
    subject: "Hello from Quotex",
    html: "<p>Hello client.</p>",
    text: "Hello client.",
    attachments: [
      {
        fileName: "quote.pdf",
        fileType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    ],
  };
}
