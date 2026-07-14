import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { readSigningPacket, type SigningPacket } from "../services/signingPackets.js";
import {
  createDepositPaymentIntent,
  createSoftwareSaleCheckoutSession,
  handleStripeWebhookEvent,
  retrieveSoftwareSaleCheckoutSession,
  stripeConfigured,
  verifyWebhook,
} from "../services/stripe.js";

export const stripeRoutes = Router();

const softwareProductSchema = z
  .preprocess(
    (value) => (value === "ai_quoting_workspace" ? "full_platform" : value),
    z.enum(["full_platform"])
  )
  .optional();
const addOnSchema = z.enum(["none", "website", "app", "website_app"]).optional();
const termSchema = z.union([z.literal(12), z.literal(24), z.literal(36)]).optional();

const checkoutSessionSchema = z.object({
  saleId: z.string().trim().max(160).optional(),
  signingPacketId: z.string().trim().max(160).optional(),
  agencyName: z.string().trim().min(1).max(300),
  contactName: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(500).optional(),
  product: softwareProductSchema,
  tier: z.string().trim().max(40).optional(),
  seats: z.number().int().min(1).max(999),
  websiteAppAddOn: addOnSchema,
  termMonths: termSchema,
  customMonthlyPriceUsd: z.number().int().min(0).max(1_000_000).optional(),
  customMonthlyPriceReason: z.string().trim().max(500).optional(),
  successUrl: z.string().trim().url().max(1200).optional(),
  cancelUrl: z.string().trim().url().max(1200).optional(),
});

const depositIntentSchema = z.object({
  amount: z.number().int().positive().max(10_000_000),
  currency: z.string().trim().min(3).max(3).default("usd"),
  customerEmail: z.string().trim().email(),
  metadata: z.record(z.string()).default({}),
});

const packetCheckoutSessionSchema = z.object({
  saleId: z.string().trim().max(160).optional(),
  signingPacketId: z.string().trim().min(1).max(160),
  successUrl: z.string().trim().url().max(1200).optional(),
  cancelUrl: z.string().trim().url().max(1200).optional(),
});

function packetHasSignedRequiredDocuments(packet: SigningPacket) {
  const signatures = Object.values(packet.signatures ?? {});
  return (
    signatures.length > 0 &&
    signatures.every(
      (signature) =>
        signature.authorized === true &&
        typeof signature.signerName === "string" &&
        signature.signerName.trim().length > 0 &&
        typeof signature.signedAt === "string" &&
        signature.signedAt.trim().length > 0
    )
  );
}

stripeRoutes.get("/", (_req, res) => {
  res.json({
    resource: "stripe",
    configured: stripeConfigured(),
    endpoints: [
      { method: "POST", path: "/software-sales/checkout-session" },
      { method: "POST", path: "/software-sales/packet-checkout-session" },
      { method: "POST", path: "/software-sales/master-checkout-session" },
      { method: "GET", path: "/software-sales/checkout-session/:sessionId" },
      { method: "POST", path: "/webhook" },
      { method: "POST", path: "/deposits/intent" },
    ],
  });
});

stripeRoutes.post("/software-sales/checkout-session", async (req, res, next) => {
  try {
    const parsed = checkoutSessionSchema.omit({
      customMonthlyPriceUsd: true,
      customMonthlyPriceReason: true,
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_checkout_session", details: parsed.error.flatten() });
    const result = await createSoftwareSaleCheckoutSession({
      ...parsed.data,
      source: "transaction_site",
      allowCustomPrice: false,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleStripeRouteError(error, res, next);
  }
});

stripeRoutes.post("/software-sales/packet-checkout-session", async (req, res, next) => {
  try {
    const parsed = packetCheckoutSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_packet_checkout_session", details: parsed.error.flatten() });

    const packet = await readSigningPacket(parsed.data.signingPacketId);
    if (!packet) return res.status(404).json({ error: "signing_packet_not_found" });
    if (!packetHasSignedRequiredDocuments(packet)) return res.status(400).json({ error: "signing_packet_not_signed" });
    if (parsed.data.saleId && packet.saleId && parsed.data.saleId !== packet.saleId) {
      return res.status(409).json({ error: "sale_packet_mismatch" });
    }

    const result = await createSoftwareSaleCheckoutSession({
      saleId: packet.saleId ?? parsed.data.saleId,
      signingPacketId: packet.id,
      agencyName: packet.agencyName,
      contactName: packet.contactName,
      email: packet.email,
      phone: packet.phone,
      website: packet.website,
      product: packet.product,
      tier: packet.tier,
      seats: packet.seats,
      websiteAppAddOn: packet.websiteAppAddOn,
      termMonths: packet.termMonths,
      customMonthlyPriceUsd: packet.customMonthlyPriceUsd,
      customMonthlyPriceReason: packet.customMonthlyPriceReason,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      source: "master_portal",
      allowCustomPrice: true,
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleStripeRouteError(error, res, next);
  }
});

stripeRoutes.post(
  "/software-sales/master-checkout-session",
  requireAuth,
  requireRole("platform_owner", "platform_admin", "master_admin"),
  async (req, res, next) => {
    try {
      const parsed = checkoutSessionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_checkout_session", details: parsed.error.flatten() });
      const result = await createSoftwareSaleCheckoutSession({
        ...parsed.data,
        source: "master_portal",
        allowCustomPrice: true,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return handleStripeRouteError(error, res, next);
    }
  }
);

stripeRoutes.get("/software-sales/checkout-session/:sessionId", async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId?.trim();
    if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+/.test(sessionId)) {
      return res.status(400).json({ error: "invalid_checkout_session_id" });
    }
    const session = await retrieveSoftwareSaleCheckoutSession(sessionId);
    return res.json({ ok: true, session });
  } catch (error) {
    return handleStripeRouteError(error, res, next);
  }
});

stripeRoutes.post("/deposits/intent", async (req, res, next) => {
  try {
    const parsed = depositIntentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_deposit_intent", details: parsed.error.flatten() });
    const result = await createDepositPaymentIntent(parsed.data);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleStripeRouteError(error, res, next);
  }
});

stripeRoutes.post("/webhook", async (req, res, next) => {
  try {
    const signature = req.header("stripe-signature")?.trim();
    if (!signature) return res.status(400).json({ error: "missing_stripe_signature" });
    const rawBody = req.rawBody;
    if (!rawBody) return res.status(400).json({ error: "missing_raw_body" });
    const event = await verifyWebhook(rawBody, signature);
    const result = await handleStripeWebhookEvent(event);
    return res.json({ received: true, result });
  } catch (error) {
    return handleStripeRouteError(error, res, next);
  }
});

function handleStripeRouteError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof Error) {
    if (error.message === "stripe_service_not_configured") {
      return res.status(503).json({
        error: "stripe_service_not_configured",
        message: "Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the server.",
      });
    }
    if (error.message === "stripe_webhook_secret_not_configured") {
      return res.status(503).json({
        error: "stripe_webhook_secret_not_configured",
        message: "Stripe webhook verification is not configured.",
      });
    }
    if (error.message === "stripe_checkout_amount_must_be_positive") {
      return res.status(400).json({ error: "stripe_checkout_amount_must_be_positive" });
    }
  }
  return next(error);
}
