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
}));

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
  mocks.emailDeliveryConfiguration.mockReturnValue({
    configured: true,
    provider: "sendgrid",
    from: "Quotex Insurance <verified@quotexinsurance.com>",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mailbox delivery routes", () => {
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

  it("falls back to transactional delivery when the staff mailbox is not connected", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_msg_1",
      status: "sent",
      provider: "sendgrid",
      configured: true,
    });

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      result: {
        provider: "transactional",
        status: "sent",
        externalMessageId: "sendgrid_msg_1",
        fallbackReason: "No connected mailbox was found for this staff account.",
      },
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "client@example.com",
        subject: "Hello from Quotex",
        html: "<p>Hello client.</p>",
        categories: ["mailbox-fallback", "user-portal"],
      })
    );
  });

  it("returns a readable failure when no mailbox or transactional provider can deliver", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.sendEmail.mockResolvedValue({
      id: "email_not_configured_1",
      status: "failed",
      provider: "unconfigured",
      configured: false,
      error: "No email provider is configured.",
    });

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: "mailbox_send_failed",
      message: "No email provider is configured.",
      fallback: {
        mailboxReason: "No connected mailbox was found for this staff account.",
        provider: "unconfigured",
        configured: false,
      },
    });
  });

  it("sends agency campaigns from the verified sender with the agency contact as reply-to", async () => {
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_campaign_1",
      status: "sent",
      provider: "sendgrid",
      configured: true,
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
        provider: "transactional",
        status: "sent",
        externalMessageId: "sendgrid_campaign_1",
      },
    });
    expect(mocks.sendMailboxEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "client@example.com",
        from: "Palm Coast Private Client <verified@quotexinsurance.com>",
        replyTo: "contact@palmcoast.example",
        categories: ["agency-marketing", "campaign"],
      })
    );
  });

  it("does not report an agency campaign as sent when the provider rejects it", async () => {
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_campaign_failed_1",
      status: "failed",
      provider: "sendgrid",
      configured: true,
      error: "Provider rejected the campaign email.",
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

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      message: "Provider rejected the campaign email.",
    });
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
