import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  auditFindFirst: vi.fn(),
  communicationFindFirst: vi.fn(),
  communicationCreate: vi.fn(),
  transactionAuditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: mocks.auditCreate,
      findFirst: mocks.auditFindFirst,
    },
    communication: { findFirst: mocks.communicationFindFirst },
    $transaction: mocks.transaction,
  },
}));

import {
  carrierReplyRelayReadiness,
  createCarrierReplyRoute,
  ingestCarrierReply,
  recordCarrierReplyRouteUnavailable,
  recordCarrierReplyIngress,
  verifyInboundWebhookSecret,
} from "../services/carrierReplyRelay.js";

beforeEach(() => {
  vi.stubEnv("INBOUND_REPLY_DOMAIN", "reply.quotexinsurance.com");
  vi.stubEnv("SENDGRID_INBOUND_WEBHOOK_SECRET", "0123456789abcdef0123456789abcdef");
  mocks.auditCreate.mockReset().mockResolvedValue({});
  mocks.auditFindFirst.mockReset();
  mocks.communicationFindFirst.mockReset().mockResolvedValue(null);
  mocks.communicationCreate.mockReset().mockResolvedValue({});
  mocks.transactionAuditCreate.mockReset().mockResolvedValue({});
  mocks.transaction.mockReset().mockImplementation(async (callback) =>
    callback({
      communication: { create: mocks.communicationCreate },
      auditLog: { create: mocks.transactionAuditCreate },
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("carrier reply relay", () => {
  it("creates an opaque reply route without exposing tenant or submission ids", async () => {
    const replyAddress = await createCarrierReplyRoute({
      tenantId: "tenant-1",
      userId: "user-1",
      mailboxAccount: "agent@example.com",
      context: {
        communicationId: "communication-1",
        customerId: "customer-1",
        carrierSubmissionId: "submission-1",
      },
      relayActive: true,
    });

    expect(replyAddress).toMatch(/^reply\+[A-Za-z0-9_-]{20,40}@reply\.quotexinsurance\.com$/);
    expect(replyAddress).not.toContain("tenant-1");
    expect(replyAddress).not.toContain("submission-1");
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        actorId: "user-1",
        action: "mailbox.reply_route.created",
        entityType: "mailbox_reply_route",
        metadata: expect.objectContaining({
          communicationId: "communication-1",
          customerId: "customer-1",
          carrierSubmissionId: "submission-1",
          replyAddress,
        }),
      }),
    });
  });

  it("uses the inbound relay only when DNS routes the reply domain to SendGrid", async () => {
    const active = await carrierReplyRelayReadiness({
      resolver: vi.fn().mockResolvedValue([{ exchange: "mx.sendgrid.net.", priority: 10 }]),
      bypassCache: true,
    });
    const inactive = await carrierReplyRelayReadiness({
      resolver: vi.fn().mockResolvedValue([{ exchange: "mail.example.com", priority: 10 }]),
      bypassCache: true,
    });

    expect(active).toMatchObject({ active: true, reason: "active" });
    expect(inactive).toMatchObject({ active: false, reason: "mx_not_routed" });
  });

  it("does not create a dead reply route when relay DNS is inactive", async () => {
    const replyAddress = await createCarrierReplyRoute({
      tenantId: "tenant-1",
      userId: "user-1",
      mailboxAccount: "agent@example.com",
      context: { communicationId: "communication-1" },
      relayActive: false,
    });

    expect(replyAddress).toBeNull();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("records why a carrier reply route could not be armed", async () => {
    await recordCarrierReplyRouteUnavailable({
      tenantId: "tenant-1",
      userId: "user-1",
      mailboxAccount: "agent@example.com",
      context: {
        communicationId: "communication-1",
        customerId: "customer-1",
        carrierSubmissionId: "submission-1",
      },
      readiness: {
        configured: true,
        domain: "reply.quotexinsurance.com",
        active: false,
        reason: "mx_not_routed",
        checkedAt: "2026-07-20T00:00:00.000Z",
      },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        actorId: "user-1",
        action: "mailbox.reply_route.unavailable",
        entityType: "mailbox_reply_route",
        entityId: "communication-1",
        metadata: expect.objectContaining({
          communicationId: "communication-1",
          carrierSubmissionId: "submission-1",
          mailboxAccount: "agent@example.com",
          domain: "reply.quotexinsurance.com",
          reason: "mx_not_routed",
        }),
      }),
    });
  });

  it("records ignored webhook deliveries without storing message contents", async () => {
    await recordCarrierReplyIngress({
      payload: {
        from: "Underwriter <underwriter@carrier.example>",
        to: ["unknown@reply.quotexinsurance.com"],
        subject: "Sensitive subject",
        text: "Sensitive message body",
      },
      result: { status: "ignored", reason: "reply_route_not_found" },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "mailbox.inbound.webhook_ignored",
        tenantId: null,
        metadata: expect.objectContaining({
          status: "ignored",
          reason: "reply_route_not_found",
          fromDomain: "carrier.example",
          subjectPresent: true,
        }),
      }),
    });
    expect(JSON.stringify(mocks.auditCreate.mock.calls[0])).not.toContain("Sensitive message body");
    expect(JSON.stringify(mocks.auditCreate.mock.calls[0])).not.toContain("Sensitive subject");
  });

  it("links a provider reply to the exact tenant, user, customer, and submission", async () => {
    mocks.auditFindFirst.mockResolvedValue({
      tenantId: "tenant-1",
      metadata: {
        communicationId: "communication-1",
        threadId: "thread-1",
        customerId: "customer-1",
        carrierContactId: "carrier-contact-1",
        carrierSubmissionId: "submission-1",
        userId: "user-1",
        mailboxAccount: "agent@example.com",
        provider: "gmail",
        replyAddress: "reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });

    const result = await ingestCarrierReply({
      from: "Underwriter <underwriter@carrier.example>",
      to: ["reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com"],
      subject: "Re: Commercial application",
      text: "We can quote this account.",
      headers: [
        "Message-ID: <carrier-reply-1@carrier.example>",
        "In-Reply-To: <original-1@quotexinsurance.com>",
        "References: <root-1@quotexinsurance.com> <original-1@quotexinsurance.com>",
      ].join("\r\n"),
    });

    expect(result).toMatchObject({ status: "linked", tenantId: "tenant-1", userId: "user-1" });
    expect(mocks.communicationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        customerId: "customer-1",
        carrierContactId: "carrier-contact-1",
        direction: "inbound",
        replyToId: "communication-1",
        threadId: "thread-1",
        messageIdHeader: "<carrier-reply-1@carrier.example>",
        mailbox: expect.objectContaining({ origin: "inbound_relay", userId: "user-1" }),
        resolution: expect.objectContaining({ carrierSubmissionId: "submission-1" }),
      }),
    });
  });

  it("deduplicates provider retries by Message-ID", async () => {
    mocks.auditFindFirst.mockResolvedValue({
      tenantId: "tenant-1",
      metadata: {
        communicationId: "communication-1",
        userId: "user-1",
        mailboxAccount: "agent@example.com",
        provider: "gmail",
        replyAddress: "reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    mocks.communicationFindFirst.mockResolvedValue({ id: "communication-existing" });

    const result = await ingestCarrierReply({
      from: "underwriter@carrier.example",
      to: ["reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com"],
      text: "Duplicate delivery",
      headers: "Message-ID: <carrier-reply-duplicate@carrier.example>",
    });

    expect(result).toEqual({
      status: "deduped",
      communicationId: "communication-existing",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("compares the inbound webhook secret exactly", () => {
    expect(verifyInboundWebhookSecret("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(verifyInboundWebhookSecret("0123456789abcdef0123456789abcdeg")).toBe(false);
    expect(verifyInboundWebhookSecret("short")).toBe(false);
  });
});
