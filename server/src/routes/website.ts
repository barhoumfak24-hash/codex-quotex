import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isProduction } from "../env.js";

export const websiteRoutes = Router();

const websiteProspectSchema = z.object({
  agencyId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  source: z.enum(["contact", "quote_start", "customer_signup"]),
  name: z.string().max(160).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
});

const websiteSyncSchema = z.object({
  agencyId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  eventType: z.enum([
    "customer.updated",
    "policy.updated",
    "document.updated",
    "claim.updated",
    "message.created",
    "questionnaire.updated",
    "signature.updated",
    "payment.updated",
  ]),
  recordId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
});

websiteRoutes.get("/", (_req, res) =>
  res.json({
    resource: "website",
    purpose: "Externally built agency websites connect here without exposing staff/admin APIs.",
    endpoints: [
      {
        method: "GET",
        path: "/config/:agencyId",
        description: "Resolve website connection and portal handoff settings for one agency.",
      },
      {
        method: "POST",
        path: "/prospects",
        description: "Create a tenant-scoped prospect/activity from an external agency website.",
      },
      {
        method: "POST",
        path: "/sync",
        description: "Receive customer-portal updates from the external website and mirror them into the tenant workspace.",
      },
    ],
  })
);

websiteRoutes.get("/config/:agencyId", (req, res) => {
  res.json({
    agencyId: req.params.agencyId,
    contractVersion: 1,
    dataSource: "prisma_agency_public_profile",
    fields: [
      "name",
      "website",
      "customerPortalUrl",
      "quoteStartUrl",
      "contactEmail",
      "phone",
      "address",
      "serviceAreas",
      "portalBaseUrl",
      "websiteAllowedDomains",
      "websitePortalModules",
      "websiteAuthRedirects",
    ],
  });
});

websiteRoutes.post("/prospects", requireWebsiteSignature, (req, res) => {
  const parsed = websiteProspectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_website_prospect",
      details: parsed.error.flatten(),
    });
  }

  res.status(202).json({
    accepted: true,
    contractVersion: 1,
    next: "Production resolves the connection key, writes the lead into Prospect, Communication, StatusEvent, and AuditLog, then notifies the agency workspace.",
  });
});

websiteRoutes.post("/sync", requireWebsiteSignature, (req, res) => {
  const parsed = websiteSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_website_sync",
      details: parsed.error.flatten(),
    });
  }

  res.status(202).json({
    accepted: true,
    contractVersion: 1,
    next: "Production verifies the webhook signature, applies the tenant-scoped customer update, and fans out a customer-safe status event.",
  });
});

export function requireWebsiteSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.WEBSITE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (isProduction()) {
      return res.status(500).json({ error: "website_webhook_secret_not_configured" });
    }
    return next();
  }

  const signature = parseSignature(req.header("x-quotex-signature") ?? req.header("x-signature"));
  if (!signature) return res.status(401).json({ error: "missing_website_signature" });

  const payload = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!constantTimeEqualHex(signature, expected)) {
    return res.status(401).json({ error: "invalid_website_signature" });
  }
  next();
}

function parseSignature(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith("sha256=") ? trimmed.slice("sha256=".length) : trimmed;
  return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function constantTimeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
