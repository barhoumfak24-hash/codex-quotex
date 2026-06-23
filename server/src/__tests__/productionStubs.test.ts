import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDepositPaymentIntent,
  updateAgencySubscription,
  verifyWebhook,
} from "../services/stripe.js";
import { presignDownload, presignUpload } from "../services/storage.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production service stubs", () => {
  it("keeps Stripe stubs available in development demos", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await expect(
      createDepositPaymentIntent({
        amount: 100,
        currency: "usd",
        customerEmail: "client@example.com",
        metadata: {},
      })
    ).resolves.toMatchObject({ clientSecret: "stub_secret" });
    await expect(
      updateAgencySubscription({
        agencyId: "agency_1",
        tier: "minimum",
        seatCount: 1,
      })
    ).resolves.toMatchObject({ stripeSubscriptionId: "sub_stub" });
    await expect(verifyWebhook(Buffer.from("{}"), "sig")).resolves.toMatchObject({
      type: "stub.event",
    });
  });

  it("fails closed instead of returning fake Stripe success in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      createDepositPaymentIntent({
        amount: 100,
        currency: "usd",
        customerEmail: "client@example.com",
        metadata: {},
      })
    ).rejects.toThrow("stripe_service_not_configured");
    await expect(
      updateAgencySubscription({
        agencyId: "agency_1",
        tier: "minimum",
        seatCount: 1,
      })
    ).rejects.toThrow("stripe_service_not_configured");
    await expect(verifyWebhook(Buffer.from("{}"), "sig")).rejects.toThrow(
      "stripe_service_not_configured"
    );
  });

  it("fails closed instead of returning fake storage URLs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      presignUpload({
        tenantId: "agency_1",
        fileName: "policy.pdf",
        contentType: "application/pdf",
      })
    ).rejects.toThrow("document_storage_not_configured");
    await expect(presignDownload("agency_1/policy.pdf")).rejects.toThrow(
      "document_storage_not_configured"
    );
  });
});
