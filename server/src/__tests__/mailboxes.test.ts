import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enforceTenantIsolation, requireAuth } from "../middleware/auth.js";
import { issueSessionJwt } from "../routes/auth.js";

const mocks = vi.hoisted(() => ({
  sendMailboxEmail: vi.fn(),
  syncMailboxMessages: vi.fn(),
  syncMailboxReplyMessages: vi.fn(),
  listPersistedMailboxMessages: vi.fn(),
  listMailboxSyncStatus: vi.fn(),
  listMailboxDiagnostics: vi.fn(),
  sendEmail: vi.fn(),
  emailDeliveryConfiguration: vi.fn(),
  listMailboxConnections: vi.fn(),
  isMailboxFallbackSafeError: vi.fn(),
  saveAgencyMarketingSmtpCredential: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  agencyFindFirst: vi.fn(),
  mailboxConnectionFindFirst: vi.fn(),
  createCarrierReplyRoute: vi.fn(),
  recordCarrierReplyRouteUnavailable: vi.fn(),
  carrierReplyRelayConfiguration: vi.fn(),
  carrierReplyRelayReadiness: vi.fn(),
}));

vi.mock("../services/mailboxOAuth.js", async () => {
  const actual = await vi.importActual<typeof import("../services/mailboxOAuth.js")>(
    "../services/mailboxOAuth.js"
  );
  return { ...actual, listMailboxConnections: mocks.listMailboxConnections };
});

vi.mock("../services/mailboxProvider.js", () => ({
  sendMailboxEmail: mocks.sendMailboxEmail,
  isMailboxFallbackSafeError: mocks.isMailboxFallbackSafeError,
  saveAgencyMarketingSmtpCredential: mocks.saveAgencyMarketingSmtpCredential,
}));

vi.mock("../services/prisma.js", () => ({
  databaseConfigured: () => true,
  prisma: {
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    agency: { findFirst: mocks.agencyFindFirst },
    mailboxConnection: { findFirst: mocks.mailboxConnectionFindFirst },
  },
}));

vi.mock("../services/mailboxSync.js", () => ({
  syncMailboxMessages: mocks.syncMailboxMessages,
  syncMailboxReplyMessages: mocks.syncMailboxReplyMessages,
  listPersistedMailboxMessages: mocks.listPersistedMailboxMessages,
  listMailboxSyncStatus: mocks.listMailboxSyncStatus,
  listMailboxDiagnostics: mocks.listMailboxDiagnostics,
}));

vi.mock("../services/email.js", () => ({
  sendEmail: mocks.sendEmail,
  emailDeliveryConfiguration: mocks.emailDeliveryConfiguration,
}));

vi.mock("../services/carrierReplyRelay.js", () => ({
  createCarrierReplyRoute: mocks.createCarrierReplyRoute,
  recordCarrierReplyRouteUnavailable: mocks.recordCarrierReplyRouteUnavailable,
  carrierReplyRelayConfiguration: mocks.carrierReplyRelayConfiguration,
  carrierReplyRelayReadiness: mocks.carrierReplyRelayReadiness,
}));

const JWT_SECRET = "test-jwt-secret-with-more-than-32-characters";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", JWT_SECRET);
  vi.stubEnv("JWT_ISSUER", "");
  vi.stubEnv("JWT_AUDIENCE", "");
  mocks.sendMailboxEmail.mockReset();
  mocks.syncMailboxMessages.mockReset();
  mocks.syncMailboxReplyMessages.mockReset();
  mocks.listPersistedMailboxMessages.mockReset();
  mocks.listMailboxSyncStatus.mockReset();
  mocks.listMailboxDiagnostics.mockReset();
  mocks.sendEmail.mockReset();
  mocks.emailDeliveryConfiguration.mockReset();
  mocks.listMailboxConnections.mockReset();
  mocks.isMailboxFallbackSafeError.mockReset();
  mocks.saveAgencyMarketingSmtpCredential.mockReset();
  mocks.userFindUnique.mockReset();
  mocks.userFindFirst.mockReset();
  mocks.agencyFindFirst.mockReset();
  mocks.mailboxConnectionFindFirst.mockReset();
  mocks.createCarrierReplyRoute.mockReset().mockResolvedValue(null);
  mocks.recordCarrierReplyRouteUnavailable.mockReset().mockResolvedValue(undefined);
  mocks.carrierReplyRelayConfiguration.mockReset().mockReturnValue({
    configured: true,
    domain: "reply.quotexinsurance.com",
    webhookSecretConfigured: true,
  });
  mocks.carrierReplyRelayReadiness.mockReset().mockResolvedValue({
    configured: true,
    domain: "reply.quotexinsurance.com",
    webhookSecretConfigured: true,
    active: true,
    reason: "active",
    checkedAt: "2026-07-20T00:00:00.000Z",
  });
  mocks.emailDeliveryConfiguration.mockReturnValue({
    configured: true,
    provider: "sendgrid",
    from: "Quotex Insurance <verified@quotexinsurance.com>",
    missingEnvironmentVariables: [],
    acceptedConfigurations: [["SENDGRID_API_KEY", "EMAIL_FROM or SENDGRID_FROM_EMAIL"]],
  });
  mocks.listMailboxConnections.mockResolvedValue([]);
  mocks.listPersistedMailboxMessages.mockResolvedValue([]);
  mocks.isMailboxFallbackSafeError.mockReturnValue(true);
  mocks.userFindUnique.mockResolvedValue({
    id: "user_mail",
    role: "manager",
    tenantId: "tenant_mail",
    branchId: "branch_mail",
    authVersion: 0,
    status: "active",
    agency: { active: true },
  });
  mocks.userFindFirst.mockResolvedValue({ name: "Abe Fakhoury", email: "abe@example.com" });
  mocks.agencyFindFirst.mockResolvedValue({
    name: "Palm Coast Private Client",
    contactEmail: "contact@palmcoast.example",
  });
  mocks.mailboxConnectionFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mailbox delivery routes", () => {
  it("stores an agency campaign mailbox through the protected credential service without returning its password", async () => {
    mocks.saveAgencyMarketingSmtpCredential.mockResolvedValue({
      id: "mailbox_smtp_tenant_mail_agency_marketing",
      tenantId: "tenant_mail",
      userId: null,
      ownerType: "agency_marketing",
      provider: "smtp",
      address: "marketing@agency.example",
      displayName: "Palm Coast Private Client",
      status: "connected",
      authMode: "smtp_imap",
      scopes: ["send"],
      tokenVaultRef: "mailbox-token:mailbox_token_1",
      connectedAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    });

    const response = await postMailbox(
      "/agency-marketing/credentials",
      {
        email: "marketing@agency.example",
        password: "app-password-value",
      },
      staffToken()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      passwordConfigured: true,
      connection: {
        address: "marketing@agency.example",
        ownerType: "agency_marketing",
        status: "connected",
      },
    });
    expect(JSON.stringify(body)).not.toContain("app-password-value");
    expect(mocks.saveAgencyMarketingSmtpCredential).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      updatedById: "user_mail",
      agencyName: "Palm Coast Private Client",
      email: "marketing@agency.example",
      password: "app-password-value",
      provider: "auto",
    });
  });

  it("reports the authenticated staff member's real email capability", async () => {
    mocks.listMailboxConnections.mockResolvedValue([
      {
        id: "mailbox_1",
        userId: "user_mail",
        status: "connected",
        authMode: "oauth",
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      },
    ]);

    const response = await getMailbox("/capability", staffToken());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      capability: {
        mailboxConnected: true,
        inboxSyncConnected: true,
        inboxSyncProvider: "google",
        carrierReplyRelayConfigured: true,
        carrierReplyRelayActive: true,
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

  it("does not claim inbox access for a send-only mailbox connection", async () => {
    mocks.listMailboxConnections.mockResolvedValue([
      {
        id: "mailbox_send_only",
        userId: "user_mail",
        status: "connected",
        authMode: "oauth",
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/gmail.send"],
      },
    ]);

    const response = await getMailbox("/capability", staffToken());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      capability: {
        mailboxConnected: true,
        inboxSyncConnected: false,
        inboxSyncProvider: null,
      },
    });
  });

  it("replays inbound messages already imported by the scheduled mailbox sync", async () => {
    mocks.listPersistedMailboxMessages.mockResolvedValue([
      {
        mailboxAccount: "agent@example.com",
        mailboxConnectionId: "mailbox_conn_1",
        provider: "gmail",
        externalMessageId: "persisted_reply_1",
        from: "underwriter@carrier.example",
        to: ["agent@example.com"],
        subject: "Re: application",
        body: "We can quote this account.",
        direction: "inbound",
      },
    ]);

    const response = await postMailbox("/replay", { limit: 100 }, staffToken());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      messages: [{ externalMessageId: "persisted_reply_1", direction: "inbound" }],
    });
    expect(mocks.listPersistedMailboxMessages).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
      limit: 100,
    });
  });

  it("requires a signed session before sending email", async () => {
    const response = await postMailbox("/send", validSendPayload());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      reason: "no_session",
      error: "no_session",
    });
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

  it("falls back to the configured transactional provider when the staff mailbox is not connected", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_staff_1",
      provider: "sendgrid",
      status: "sent",
      configured: true,
    });

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        provider: "transactional",
        status: "sent",
        externalMessageId: "sendgrid_staff_1",
      },
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: ["client@example.com"],
      cc: [],
      bcc: [],
      from: "Abe Fakhoury <verified@quotexinsurance.com>",
      subject: "Hello from Quotex",
      text: "Hello client.",
      html: "<p>Hello client.</p>",
      replyTo: "abe@example.com",
      headers: undefined,
      attachments: validSendPayload().attachments,
      categories: ["mailbox-fallback", "user-portal"],
    });
  });

  it("routes carrier replies through the secure inbound relay", async () => {
    mocks.createCarrierReplyRoute.mockResolvedValue("reply+opaque-token@reply.quotexinsurance.com");
    mocks.sendMailboxEmail.mockResolvedValue({
      provider: "google",
      status: "sent",
      externalMessageId: "gmail_carrier_1",
    });
    const replyContext = {
      communicationId: "comm_carrier_1",
      threadId: "thread_carrier_1",
      customerId: "customer_1",
      carrierContactId: "carrier_contact_1",
      carrierSubmissionId: "submission_1",
    };

    const response = await postMailbox(
      "/send",
      { ...validSendPayload(), to: ["underwriter@carrier.example"], replyContext },
      staffToken()
    );

    expect(response.status).toBe(200);
    expect(mocks.createCarrierReplyRoute).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
      mailboxAccount: "abe@example.com",
      context: replyContext,
      relayActive: true,
    });
    expect(mocks.recordCarrierReplyRouteUnavailable).not.toHaveBeenCalled();
    expect(mocks.sendMailboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["underwriter@carrier.example"],
        replyTo: "reply+opaque-token@reply.quotexinsurance.com",
      })
    );
  });

  it("routes replies to the staff mailbox when the inbound relay DNS is not live", async () => {
    mocks.carrierReplyRelayReadiness.mockResolvedValue({
      configured: true,
      domain: "reply.quotexinsurance.com",
      webhookSecretConfigured: true,
      active: false,
      reason: "mx_not_routed",
      checkedAt: "2026-07-20T00:00:00.000Z",
    });
    mocks.sendMailboxEmail.mockResolvedValue({
      provider: "google",
      status: "sent",
      externalMessageId: "gmail_carrier_2",
    });
    const replyContext = {
      communicationId: "comm_carrier_2",
      customerId: "customer_1",
      carrierSubmissionId: "submission_2",
    };

    const response = await postMailbox(
      "/send",
      { ...validSendPayload(), to: ["underwriter@carrier.example"], replyContext },
      staffToken()
    );

    expect(response.status).toBe(200);
    expect(mocks.createCarrierReplyRoute).toHaveBeenCalledWith(
      expect.objectContaining({ relayActive: false })
    );
    expect(mocks.recordCarrierReplyRouteUnavailable).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
      mailboxAccount: "abe@example.com",
      context: replyContext,
      readiness: expect.objectContaining({ active: false, reason: "mx_not_routed" }),
    });
    expect(mocks.sendMailboxEmail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "abe@example.com" })
    );
  });

  it("derives the transactional sender from the authenticated staff record", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_staff_identity",
      provider: "sendgrid",
      status: "sent",
      configured: true,
    });

    const response = await postMailbox(
      "/send",
      { ...validSendPayload(), senderName: "Spoofed Name", replyTo: "attacker@example.com" },
      staffToken()
    );

    expect(response.status).toBe(200);
    expect(mocks.userFindFirst).toHaveBeenCalledWith({
      where: { id: "user_mail", tenantId: "tenant_mail", status: "active" },
      select: { name: true, email: true },
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Abe Fakhoury <verified@quotexinsurance.com>",
        replyTo: "abe@example.com",
      })
    );
  });

  it("does not retry transactionally when mailbox delivery is uncertain", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("Mailbox request timed out after submission."));
    mocks.isMailboxFallbackSafeError.mockReturnValue(false);

    const response = await postMailbox("/send", validSendPayload(), staffToken());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "mailbox_delivery_unconfirmed",
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

  it("returns a readable failure only when both mailbox and transactional delivery fail", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected mailbox was found for this staff account."));
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_failed_1",
      provider: "sendgrid",
      status: "failed",
      configured: true,
      error: "Provider unavailable.",
    });

    const response = await postMailbox("/send", validSendPayload(), staffToken());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: "mailbox_send_failed",
      message: "Provider unavailable.",
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
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
        expectedAddress: "contact@palmcoast.example",
        to: ["client@example.com"],
      })
    );
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sends an agency campaign through the transactional provider when its mailbox is not connected", async () => {
    mocks.sendMailboxEmail.mockRejectedValue(new Error("No connected agency marketing mailbox was found."));
    mocks.sendEmail.mockResolvedValue({
      id: "sendgrid_campaign_1",
      provider: "sendgrid",
      status: "sent",
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
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Palm Coast Private Client <verified@quotexinsurance.com>",
        replyTo: "contact@palmcoast.example",
        categories: ["agency-marketing", "campaign"],
      })
    );
    expect(mocks.agencyFindFirst).toHaveBeenCalledWith({
      where: { id: "tenant_mail", active: true },
      select: { name: true, contactEmail: true },
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

  it("checks only the provider threads recorded on sent carrier emails", async () => {
    mocks.syncMailboxReplyMessages.mockResolvedValue({
      connectionId: "mailbox_conn_1",
      mailboxAccount: "agent@example.com",
      provider: "gmail",
      targetsChecked: 1,
      messages: [
        {
          mailboxAccount: "agent@example.com",
          mailboxConnectionId: "mailbox_conn_1",
          provider: "gmail",
          externalMessageId: "gmail_reply_1",
          externalThreadId: "gmail_thread_1",
          from: "underwriter@carrier.example",
          to: ["agent@example.com"],
          subject: "Re: Commercial application",
          body: "We can quote this account.",
          direction: "inbound",
        },
      ],
      importSummary: { imported: 1, updated: 0, deduped: 0, failed: 0 },
    });

    const response = await postMailbox(
      "/sync/replies",
      {
        connectionId: "mailbox_conn_1",
        targets: [{
          externalThreadId: "gmail_thread_1",
          rfc822MessageId: "<sent-carrier-1@example.com>",
          sentAt: "2026-07-20T12:00:00.000Z",
        }],
      },
      staffToken()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      result: {
        targetsChecked: 1,
        messages: [{ externalMessageId: "gmail_reply_1", direction: "inbound" }],
      },
    });
    expect(mocks.syncMailboxReplyMessages).toHaveBeenCalledWith({
      tenantId: "tenant_mail",
      userId: "user_mail",
      connectionId: "mailbox_conn_1",
      targets: [{
        externalThreadId: "gmail_thread_1",
        rfc822MessageId: "<sent-carrier-1@example.com>",
        sentAt: "2026-07-20T12:00:00.000Z",
      }],
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
    senderName: "Abe Fakhoury",
    to: ["client@example.com"],
    cc: [],
    bcc: [],
    subject: "Hello from Quotex",
    html: "<p>Hello client.</p>",
    text: "Hello client.",
    replyTo: "abe@example.com",
    attachments: [
      {
        fileName: "quote.pdf",
        fileType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    ],
  };
}
