import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  checkoutSessionsCreate: vi.fn(),
  checkoutSessionsRetrieve: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  paymentIntentsCreate: vi.fn(),
  webhooksConstructEvent: vi.fn(),
}));

const stateMock = vi.hoisted(() => ({
  supabaseStateConfigured: vi.fn(),
  readRemoteState: vi.fn(),
  writeRemoteState: vi.fn(),
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: stripeMock.checkoutSessionsCreate,
        retrieve: stripeMock.checkoutSessionsRetrieve,
      },
    },
    paymentIntents: {
      create: stripeMock.paymentIntentsCreate,
    },
    subscriptions: {
      retrieve: stripeMock.subscriptionsRetrieve,
      update: stripeMock.subscriptionsUpdate,
    },
    webhooks: {
      constructEvent: stripeMock.webhooksConstructEvent,
    },
  })),
}));

vi.mock("../services/supabaseState.js", () => ({
  supabaseStateConfigured: stateMock.supabaseStateConfigured,
  readRemoteState: stateMock.readRemoteState,
  writeRemoteState: stateMock.writeRemoteState,
}));

vi.mock("../services/email.js", () => ({
  sendEmail: emailMock.sendEmail,
}));

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_quotex");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_quotex");
  vi.stubEnv("PUBLIC_APP_ORIGIN", "https://quotexinsurance.com");
  for (const fn of Object.values(stripeMock)) fn.mockReset();
  for (const fn of Object.values(stateMock)) fn.mockReset();
  for (const fn of Object.values(emailMock)) fn.mockReset();
  stateMock.supabaseStateConfigured.mockReturnValue(false);
  stateMock.readRemoteState.mockResolvedValue(null);
  stateMock.writeRemoteState.mockImplementation(async (id, snapshot) => ({ id, snapshot }));
  emailMock.sendEmail.mockResolvedValue({
    id: "sendgrid_recurring_invoice",
    status: "sent",
    provider: "sendgrid",
    configured: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Stripe software subscriptions", () => {
  it("creates monthly subscription checkout using the selected term discount and metadata", async () => {
    stripeMock.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_test_term_24",
      url: "https://checkout.stripe.test/session",
    });
    const { createSoftwareSaleCheckoutSession } = await import("../services/stripe.js");

    const result = await createSoftwareSaleCheckoutSession({
      saleId: "sale_term_24",
      signingPacketId: "packet_term_24",
      agencyName: "Term Agency",
      contactName: "Avery Buyer",
      email: "avery@example.com",
      seats: 10,
      websiteAppAddOn: "website_app",
      termMonths: 24,
      source: "master_portal",
    });

    expect(result.quote.estimatedMonthly).toBe(7600);
    expect(stripeMock.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    const payload = stripeMock.checkoutSessionsCreate.mock.calls[0][0];

    expect(payload.mode).toBe("subscription");
    expect(payload.line_items[0].price_data.recurring).toEqual({ interval: "month" });
    expect(payload.line_items[0].price_data.unit_amount).toBe(760000);
    expect(payload.metadata).toMatchObject({
      saleId: "sale_term_24",
      signingPacketId: "packet_term_24",
      termMonths: "24",
      termDiscountPercent: "5",
      monthlyRecurringUsd: "7600",
      recurringInterval: "month",
      termEnforcement: "cancel_at_term_end",
    });
    expect(payload.subscription_data.description).toContain("24-month recurring term");
    expect(payload.subscription_data.metadata).toMatchObject(payload.metadata);
  });

  it("ignores a zero custom price override and falls back to the standard monthly subscription price", async () => {
    stripeMock.checkoutSessionsCreate.mockResolvedValue({
      id: "cs_test_zero_override",
      url: "https://checkout.stripe.test/zero-override",
    });
    const { createSoftwareSaleCheckoutSession } = await import("../services/stripe.js");

    const result = await createSoftwareSaleCheckoutSession({
      saleId: "sale_zero_override",
      signingPacketId: "packet_zero_override",
      agencyName: "Zero Override Agency",
      contactName: "Avery Buyer",
      email: "avery@example.com",
      seats: 10,
      websiteAppAddOn: "none",
      termMonths: 12,
      customMonthlyPriceUsd: 0,
      source: "master_portal",
      allowCustomPrice: true,
    });

    expect(result.quote.estimatedMonthly).toBe(3000);
    const payload = stripeMock.checkoutSessionsCreate.mock.calls[0][0];
    expect(payload.line_items[0].price_data.unit_amount).toBe(300000);
    expect(payload.metadata.monthlyRecurringUsd).toBe("3000");
  });

  it("sets the Stripe subscription to cancel at the selected term end after checkout is verified", async () => {
    const startEpoch = Math.floor(Date.UTC(2026, 0, 31, 12, 0, 0) / 1000);
    const expectedEndEpoch = Math.floor(Date.UTC(2029, 0, 31, 12, 0, 0) / 1000);
    stripeMock.checkoutSessionsRetrieve.mockResolvedValue({
      id: "cs_test_term_36",
      object: "checkout.session",
      created: startEpoch,
      status: "complete",
      payment_status: "paid",
      mode: "subscription",
      customer: "cus_term_36",
      customer_email: "buyer@example.com",
      client_reference_id: "sale_term_36",
      metadata: {
        saleId: "sale_term_36",
        termMonths: "36",
        monthlyRecurringUsd: "9200",
      },
      subscription: "sub_term_36",
    });
    stripeMock.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_term_36",
      object: "subscription",
      start_date: startEpoch,
      cancel_at: null,
      customer: "cus_term_36",
      status: "active",
      metadata: {
        saleId: "sale_term_36",
      },
    });
    stripeMock.subscriptionsUpdate.mockResolvedValue({
      id: "sub_term_36",
      object: "subscription",
      cancel_at: expectedEndEpoch,
    });
    const { retrieveSoftwareSaleCheckoutSession } = await import("../services/stripe.js");

    const summary = await retrieveSoftwareSaleCheckoutSession("cs_test_term_36");

    expect(summary.subscriptionId).toBe("sub_term_36");
    expect(summary.subscriptionTermStartedAt).toBe("2026-01-31T12:00:00.000Z");
    expect(summary.subscriptionTermEndsAt).toBe("2029-01-31T12:00:00.000Z");
    expect(stripeMock.subscriptionsUpdate).toHaveBeenCalledWith("sub_term_36", {
      cancel_at: expectedEndEpoch,
      metadata: expect.objectContaining({
        saleId: "sale_term_36",
        termMonths: "36",
        termStartedAt: "2026-01-31T12:00:00.000Z",
        termEndsAt: "2029-01-31T12:00:00.000Z",
        termEnforcement: "cancel_at_term_end",
      }),
    });
  });

  it("enforces the selected term when Stripe sends a checkout completion webhook", async () => {
    const startEpoch = Math.floor(Date.UTC(2026, 6, 1, 15, 30, 0) / 1000);
    const expectedEndEpoch = Math.floor(Date.UTC(2027, 6, 1, 15, 30, 0) / 1000);
    stripeMock.subscriptionsRetrieve.mockResolvedValue({
      id: "sub_webhook_12",
      object: "subscription",
      start_date: startEpoch,
      cancel_at: null,
      customer: "cus_webhook_12",
      status: "active",
      metadata: {},
    });
    stripeMock.subscriptionsUpdate.mockResolvedValue({
      id: "sub_webhook_12",
      object: "subscription",
      cancel_at: expectedEndEpoch,
    });
    const { handleStripeWebhookEvent } = await import("../services/stripe.js");

    await handleStripeWebhookEvent({
      id: "evt_checkout_completed",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_webhook_12",
          object: "checkout.session",
          created: startEpoch,
          status: "complete",
          payment_status: "paid",
          mode: "subscription",
          customer: "cus_webhook_12",
          client_reference_id: "sale_webhook_12",
          metadata: {
            saleId: "sale_webhook_12",
            termMonths: "12",
          },
          subscription: "sub_webhook_12",
        },
      },
    } as never);

    expect(stripeMock.subscriptionsUpdate).toHaveBeenCalledWith("sub_webhook_12", {
      cancel_at: expectedEndEpoch,
      metadata: expect.objectContaining({
        saleId: "sale_webhook_12",
        termMonths: "12",
        termStartedAt: "2026-07-01T15:30:00.000Z",
        termEndsAt: "2027-07-01T15:30:00.000Z",
        termEnforcement: "cancel_at_term_end",
      }),
    });
  });

  it("emails the customer a monthly recurring invoice after subscription-cycle payments", async () => {
    stateMock.supabaseStateConfigured.mockReturnValue(true);
    stateMock.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      snapshot: {
        softwareSales: [
          {
            id: "sale_recurring_invoice",
            agencyName: "Recurring Agency",
            contactName: "Morgan Billing",
            email: "billing@recurring.example",
            product: "full_platform",
            seats: 25,
            websiteAppAddOn: "website_app",
            estimatedMonthly: 12500,
            status: "paid",
            source: "master_portal",
            paymentMode: "stripe_checkout",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });
    const { handleStripeWebhookEvent } = await import("../services/stripe.js");

    const result = await handleStripeWebhookEvent({
      id: "evt_invoice_cycle",
      object: "event",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_recurring_001",
          object: "invoice",
          billing_reason: "subscription_cycle",
          number: "QTX-2026-08",
          amount_paid: 1250000,
          currency: "usd",
          hosted_invoice_url: "https://pay.stripe.test/invoice",
          invoice_pdf: "https://pay.stripe.test/invoice.pdf",
          customer: "cus_recurring",
          customer_email: "billing@recurring.example",
          subscription: "sub_recurring",
          metadata: { saleId: "sale_recurring_invoice" },
          period_start: Math.floor(Date.UTC(2026, 7, 1) / 1000),
          period_end: Math.floor(Date.UTC(2026, 8, 1) / 1000),
        },
      },
    } as never);

    expect(result).toMatchObject({ handled: true, updated: true });
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "billing@recurring.example",
        subject: "Quotex subscription invoice QTX-2026-08 - Recurring Agency",
        categories: ["software-sale", "recurring-invoice"],
      })
    );
    const emailPayload = emailMock.sendEmail.mock.calls[0][0];
    expect(emailPayload.html).toContain("No signatures, payment authorization, or payment method entry are needed");
    expect(emailPayload.html).not.toContain("Encrypted agency code");
    expect(stateMock.writeRemoteState).toHaveBeenCalledTimes(1);
    const writtenSnapshot = stateMock.writeRemoteState.mock.calls[0][1] as {
      softwareSales: Array<Record<string, unknown>>;
    };
    expect(writtenSnapshot.softwareSales[0]).toMatchObject({
      stripePaymentStatus: "paid",
      stripeSubscriptionId: "sub_recurring",
      stripeCustomerId: "cus_recurring",
      recurringInvoiceEmailLastStripeInvoiceId: "in_recurring_001",
      recurringInvoiceEmailStatus: "sent",
      recurringInvoiceEmailProvider: "sendgrid",
    });
    expect(writtenSnapshot.softwareSales[0].recurringInvoiceEmailHistory).toEqual([
      expect.objectContaining({
        stripeInvoiceId: "in_recurring_001",
        stripeInvoiceNumber: "QTX-2026-08",
        amountPaidUsd: 12500,
        status: "sent",
      }),
    ]);
  });

  it("does not send the recurring invoice email for Stripe's initial subscription invoice", async () => {
    stateMock.supabaseStateConfigured.mockReturnValue(true);
    stateMock.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      snapshot: {
        softwareSales: [
          {
            id: "sale_initial_invoice",
            agencyName: "Initial Agency",
            contactName: "Ivy Buyer",
            email: "ivy@example.com",
            seats: 10,
            estimatedMonthly: 3000,
            status: "paid",
            source: "master_portal",
            paymentMode: "stripe_checkout",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });
    const { handleStripeWebhookEvent } = await import("../services/stripe.js");

    await handleStripeWebhookEvent({
      id: "evt_invoice_initial",
      object: "event",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_initial_001",
          object: "invoice",
          billing_reason: "subscription_create",
          amount_paid: 300000,
          currency: "usd",
          customer: "cus_initial",
          subscription: "sub_initial",
          metadata: { saleId: "sale_initial_invoice" },
        },
      },
    } as never);

    expect(emailMock.sendEmail).not.toHaveBeenCalled();
    expect(stateMock.writeRemoteState).toHaveBeenCalledTimes(1);
    const writtenSnapshot = stateMock.writeRemoteState.mock.calls[0][1] as {
      softwareSales: Array<Record<string, unknown>>;
    };
    expect(writtenSnapshot.softwareSales[0]).toMatchObject({
      stripePaymentStatus: "paid",
      stripeSubscriptionId: "sub_initial",
      stripeCustomerId: "cus_initial",
    });
    expect(writtenSnapshot.softwareSales[0].recurringInvoiceEmailHistory).toBeUndefined();
  });

  it("does not duplicate a recurring invoice email when Stripe retries the same invoice webhook", async () => {
    stateMock.supabaseStateConfigured.mockReturnValue(true);
    stateMock.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      snapshot: {
        softwareSales: [
          {
            id: "sale_recurring_retry",
            agencyName: "Retry Agency",
            contactName: "Riley Billing",
            email: "billing@retry.example",
            seats: 10,
            estimatedMonthly: 3000,
            status: "paid",
            source: "master_portal",
            paymentMode: "stripe_checkout",
            recurringInvoiceEmailHistory: [
              {
                stripeInvoiceId: "in_retry_001",
                amountPaidUsd: 3000,
                currency: "usd",
                status: "sent",
                provider: "sendgrid",
                sentAt: "2026-08-01T00:00:00.000Z",
              },
            ],
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });
    const { handleStripeWebhookEvent } = await import("../services/stripe.js");

    await handleStripeWebhookEvent({
      id: "evt_invoice_retry",
      object: "event",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_retry_001",
          object: "invoice",
          billing_reason: "subscription_cycle",
          amount_paid: 300000,
          currency: "usd",
          customer: "cus_retry",
          subscription: "sub_retry",
          metadata: { saleId: "sale_recurring_retry" },
        },
      },
    } as never);

    expect(emailMock.sendEmail).not.toHaveBeenCalled();
  });
});
