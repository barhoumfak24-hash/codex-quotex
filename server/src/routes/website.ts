import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isProduction } from "../env.js";
import { sendEmail } from "../services/email.js";

export const websiteRoutes = Router();

const websiteProspectSchema = z.object({
  agencyId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  source: z.enum(["contact", "quote_start", "customer_signup"]),
  name: z.string().max(160).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
  department: z.enum(["sales", "support"]).optional(),
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

websiteRoutes.post("/prospects", async (req, res) => {
  const parsed = websiteProspectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_website_prospect",
      details: parsed.error.flatten(),
    });
  }

  const lead = parsed.data;
  const recipients = websiteLeadNotificationRecipients(lead.department);
  const subject = websiteLeadSubject(lead);
  const html = websiteLeadHtml(lead);
  const text = websiteLeadText(lead);
  const fallback = websiteLeadFallback(recipients, subject, text);
  const results = await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        from: websiteLeadFrom(lead.department),
        subject,
        html,
        text,
        replyTo: lead.email,
        categories: ["website", "lead", lead.source, lead.department ?? "general"],
      })
    )
  );
  const failed = results.filter((result) => result.status === "failed");

  if (failed.length > 0) {
    return res.status(502).json({
      accepted: false,
      error: "website_lead_email_failed",
      recipients,
      results,
      fallback,
    });
  }

  return res.status(202).json({
    accepted: true,
    contractVersion: 1,
    notification: {
      recipients,
      provider: results[0]?.provider ?? "unconfigured",
      ids: results.map((result) => result.id),
    },
    fallback,
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

function websiteLeadNotificationRecipients(department?: "sales" | "support"): string[] {
  if (department === "support") {
    return parseEmailList(process.env.WEBSITE_SUPPORT_NOTIFY_TO?.trim() || "support@quotexinsurance.com");
  }

  if (department === "sales") {
    return parseEmailList(
      process.env.WEBSITE_SALES_NOTIFY_TO?.trim() ||
        process.env.WEBSITE_LEAD_NOTIFY_TO?.trim() ||
        "contact@quotexinsurance.com"
    );
  }

  const configured =
    process.env.WEBSITE_LEAD_NOTIFY_TO?.trim() ||
    process.env.CONTACT_FORM_NOTIFY_TO?.trim() ||
    "contact@quotexinsurance.com,support@quotexinsurance.com";
  return parseEmailList(configured);
}

function websiteLeadFrom(department?: "sales" | "support") {
  if (department === "support") {
    return (
      process.env.WEBSITE_SUPPORT_EMAIL_FROM?.trim() ||
      "Quotex Insurance Support <support@quotexinsurance.com>"
    );
  }
  if (department === "sales") {
    return (
      process.env.WEBSITE_SALES_EMAIL_FROM?.trim() ||
      "Quotex Insurance <contact@quotexinsurance.com>"
    );
  }
  return process.env.EMAIL_FROM?.trim() || "Quotex Insurance <contact@quotexinsurance.com>";
}

function parseEmailList(configured: string): string[] {
  return Array.from(
    new Set(
      configured
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function websiteLeadSubject(lead: z.infer<typeof websiteProspectSchema>) {
  let sourceLabel = "Website contact";
  if (lead.department === "support") sourceLabel = "Support request";
  else if (lead.department === "sales") sourceLabel = "Sales inquiry";
  else if (lead.source === "quote_start") sourceLabel = "Quote request";
  else if (lead.source === "customer_signup") sourceLabel = "Customer signup";

  const name = lead.name?.trim() || "New prospect";
  return `${sourceLabel}: ${name}`;
}

function websiteLeadHtml(lead: z.infer<typeof websiteProspectSchema>) {
  const rows = [
    ["Source", lead.source],
    ["Department", lead.department],
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Agency ID", lead.agencyId],
    ["Connection ID", lead.connectionId],
  ]
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#6b6256;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(label ?? "")}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#111;">${escapeHtml(value ?? "")}</td>
        </tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;background:#f8f6f1;padding:24px;">
      <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2ded6;border-radius:10px;overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid #eee;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#8a6f2b;font-weight:700;">Quotex Insurance</div>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">New website inquiry</h1>
        </div>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${
          lead.message
            ? `<div style="padding:20px 24px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#6b6256;font-weight:700;">Message</div><div style="white-space:pre-wrap;margin-top:8px;">${escapeHtml(lead.message)}</div></div>`
            : ""
        }
      </div>
    </div>`;
}

function websiteLeadText(lead: z.infer<typeof websiteProspectSchema>) {
  return [
    "New Quotex website inquiry",
    "",
    `Source: ${lead.source}`,
    lead.department ? `Department: ${lead.department}` : "",
    lead.name ? `Name: ${lead.name}` : "",
    lead.email ? `Email: ${lead.email}` : "",
    lead.phone ? `Phone: ${lead.phone}` : "",
    lead.agencyId ? `Agency ID: ${lead.agencyId}` : "",
    lead.connectionId ? `Connection ID: ${lead.connectionId}` : "",
    lead.message ? `\nMessage:\n${lead.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function websiteLeadFallback(recipients: string[], subject: string, body: string) {
  const to = recipients.join(",");
  return {
    to,
    recipients,
    subject,
    body,
    href: `mailto:${recipients.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
