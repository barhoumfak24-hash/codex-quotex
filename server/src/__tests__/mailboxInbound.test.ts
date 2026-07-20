import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingestCarrierReply: vi.fn(),
  recordCarrierReplyIngress: vi.fn(),
  verifyInboundWebhookSecret: vi.fn(),
}));

vi.mock("../services/carrierReplyRelay.js", () => ({
  ingestCarrierReply: mocks.ingestCarrierReply,
  recordCarrierReplyIngress: mocks.recordCarrierReplyIngress,
  verifyInboundWebhookSecret: mocks.verifyInboundWebhookSecret,
}));

beforeEach(() => {
  mocks.ingestCarrierReply.mockReset().mockResolvedValue({
    status: "linked",
    communicationId: "communication-1",
    tenantId: "tenant-1",
    userId: "user-1",
  });
  mocks.recordCarrierReplyIngress.mockReset().mockResolvedValue(undefined);
  mocks.verifyInboundWebhookSecret.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SendGrid inbound parse route", () => {
  it("accepts multipart email, parses attachments, and acknowledges the provider", async () => {
    const form = new FormData();
    form.set("from", "Underwriter <underwriter@carrier.example>");
    form.set("to", "reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com");
    form.set("subject", "Re: Commercial application");
    form.set("text", "We can quote this account.");
    form.set("headers", "Message-ID: <reply-1@carrier.example>");
    form.set(
      "envelope",
      JSON.stringify({
        from: "underwriter@carrier.example",
        to: ["reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com"],
      })
    );
    form.set("attachment1", new Blob(["quote body"], { type: "text/plain" }), "quote.txt");

    const response = await postInbound("/sendgrid/valid-secret", form);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "linked" });
    expect(mocks.ingestCarrierReply).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Underwriter <underwriter@carrier.example>",
        to: ["reply+abcdefghijklmnopqrstuvwx@reply.quotexinsurance.com"],
        subject: "Re: Commercial application",
        text: "We can quote this account.",
        attachments: [
          expect.objectContaining({ fileName: "quote.txt", fileType: "text/plain", sizeBytes: 10 }),
        ],
      })
    );
    expect(mocks.recordCarrierReplyIngress).toHaveBeenCalledWith({
      payload: expect.objectContaining({ subject: "Re: Commercial application" }),
      result: expect.objectContaining({ status: "linked", communicationId: "communication-1" }),
    });
  });

  it("does not reveal whether an invalid webhook route exists", async () => {
    mocks.verifyInboundWebhookSecret.mockReturnValue(false);
    const response = await postInbound("/sendgrid/wrong-secret", new FormData());

    expect(response.status).toBe(404);
    expect(mocks.ingestCarrierReply).not.toHaveBeenCalled();
  });
});

async function postInbound(path: string, body: FormData): Promise<Response> {
  const { mailboxInboundRoutes } = await import("../routes/mailboxInbound.js");
  const app = express();
  app.use("/api/mailboxes/inbound", mailboxInboundRoutes);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    return await fetch(`http://127.0.0.1:${address.port}/api/mailboxes/inbound${path}`, {
      method: "POST",
      body,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
