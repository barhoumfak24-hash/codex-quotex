import { Router } from "express";
import { z } from "zod";

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

websiteRoutes.post("/prospects", (req, res) => {
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

websiteRoutes.post("/sync", (req, res) => {
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
