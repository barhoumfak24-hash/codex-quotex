import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendEmail } from "../services/email.js";
import { sendSms } from "../services/twilio.js";

export const communicationsRoutes = Router();

const requirePlatformDeliveryAuth = [
  requireAuth,
  requireRole("platform_owner", "platform_admin", "master_admin"),
] as const;

const requiredFormSchema = z.object({
  title: z.string().min(1),
  version: z.string().optional(),
});

const signingPayloadSchema = z.object({
  agencyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  signingLink: z.string().url(),
  documents: z.array(requiredFormSchema).min(1),
});

const signedAgreementSchema = z.object({
  title: z.string().min(1),
  signedAt: z.string().optional(),
  signedByName: z.string().optional(),
  signedByEmail: z.string().optional(),
  version: z.string().optional(),
});

const invoicePayloadSchema = z.object({
  saleId: z.string().min(1),
  agencyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  website: z.string().optional(),
  agencyCode: z.string().min(1),
  seats: z.number().int().positive(),
  estimatedMonthly: z.number().nonnegative(),
  setupFee: z.number().nonnegative().default(0),
  websiteAppAddOnLabel: z.string().optional(),
  websiteAppAddOnMonthly: z.number().nonnegative().optional(),
  paymentMode: z.enum(["stripe_checkout", "manual_invoice"]).optional(),
  source: z.enum(["transaction_site", "master_portal"]).optional(),
  stripeCheckoutSessionId: z.string().optional(),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36)]).default(12),
  termDiscountPercent: z.number().nonnegative().default(0),
  termDiscountMonthly: z.number().nonnegative().default(0),
  monthlyBeforeTermDiscount: z.number().nonnegative().optional(),
  standardEstimatedMonthly: z.number().nonnegative().optional(),
  customMonthlyPriceUsd: z.number().nonnegative().optional(),
  customMonthlyPriceReason: z.string().optional(),
  signedByName: z.string().optional(),
  signedByEmail: z.string().email().optional(),
  signedAt: z.string().optional(),
  signedAgreements: z.array(signedAgreementSchema).default([]),
});

communicationsRoutes.post("/software-sale/signing-email", ...requirePlatformDeliveryAuth, async (req, res) => {
  const parsed = signingPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const result = await sendEmail({
    to: payload.email,
    subject: `Action needed: e-sign Quotex plan documents for ${payload.agencyName}`,
    html: signingEmailHtml(payload),
    text: signingEmailText(payload),
    categories: ["software-sale", "esign"],
  });

  return res.status(result.status === "failed" ? 502 : 200).json({ ok: result.status !== "failed", result });
});

communicationsRoutes.post("/software-sale/signing-sms", ...requirePlatformDeliveryAuth, async (req, res) => {
  const parsed = signingPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  if (!payload.phone) return res.status(400).json({ ok: false, error: "A phone number is required." });

  const result = await sendSms({
    to: payload.phone,
    body: `Quotex documents and payment authorization for ${payload.agencyName}: ${payload.signingLink} Please review, sign, enter payment method, and submit from the secure packet.`,
    metadata: { agencyName: payload.agencyName, kind: "software-sale-esign" },
  });

  return res.status(result.status === "failed" ? 502 : 200).json({ ok: result.status !== "failed", result });
});

communicationsRoutes.post("/software-sale/invoice-email", ...requirePlatformDeliveryAuth, async (req, res) => {
  const parsed = invoicePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const result = await sendEmail({
    to: payload.email,
    from: masterPortalEmailFrom(),
    replyTo: masterPortalReplyTo(),
    subject: `Quotex invoice ${invoiceNumberFor(payload.saleId)} - ${payload.agencyName}`,
    html: invoiceEmailHtml(payload),
    text: invoiceEmailText(payload),
    categories: ["software-sale", "invoice"],
  });

  return res.status(result.status === "failed" ? 502 : 200).json({ ok: result.status !== "failed", result });
});

function signingEmailHtml(payload: z.infer<typeof signingPayloadSchema>) {
  const documentList = payload.documents
    .map(
      (document) =>
        `<li><strong>${escapeHtml(document.title)}</strong>${document.version ? ` <span style="color:#777;">${escapeHtml(document.version)}</span>` : ""}</li>`
    )
    .join("");

  return emailShell(
    "Review and e-sign your Quotex plan documents",
    `
      <p>Hi ${escapeHtml(payload.contactName)},</p>
      <p>Your Quotex software plan documents and payment authorization for <strong>${escapeHtml(payload.agencyName)}</strong> are ready for review. Open the secure packet, sign each required document, enter the payment method, then submit everything from the same page.</p>
      <ul>${documentList}</ul>
      ${button(payload.signingLink, "Open secure packet")}
      <p style="font-size:13px;color:#666;">If the button does not open, paste this link into your browser:<br>${escapeHtml(payload.signingLink)}</p>
    `
  );
}

function signingEmailText(payload: z.infer<typeof signingPayloadSchema>) {
  const docs = payload.documents.map((document) => `- ${document.title}${document.version ? ` (${document.version})` : ""}`).join("\n");
  return `Hi ${payload.contactName},

Your Quotex software plan documents and payment authorization for ${payload.agencyName} are ready for review. Open the secure packet, sign each required document, enter the payment method, then submit everything from the same page.

${docs}

Open the secure packet:
${payload.signingLink}
`;
}

function invoiceEmailHtml(payload: z.infer<typeof invoicePayloadSchema>) {
  const invoiceNumber = invoiceNumberFor(payload.saleId);
  const purchaseSource =
    payload.source === "master_portal" ? "Master portal assisted purchase" : "Secure checkout purchase";
  const paymentMethod =
    payload.paymentMode === "manual_invoice"
      ? "Master-assisted invoice"
      : payload.paymentMode === "stripe_checkout"
      ? "Checkout payment"
      : "Payment recorded";
  const signedRows =
    payload.signedAgreements.length > 0
      ? payload.signedAgreements
          .map(
            (agreement) => `
              <tr>
                <td>${escapeHtml(agreement.title)}</td>
                <td>${escapeHtml(agreement.signedByName ?? payload.contactName)}</td>
                <td>${escapeHtml(formatDateTime(agreement.signedAt))}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="3">Signed documents pending or recorded outside this invoice.</td></tr>`;
  const customPriceRows =
    payload.customMonthlyPriceUsd !== undefined
      ? `
        ${invoiceRow("Standard monthly plan", money(payload.standardEstimatedMonthly ?? payload.estimatedMonthly))}
        ${invoiceRow("Approved monthly price", money(payload.customMonthlyPriceUsd))}
        ${payload.customMonthlyPriceReason ? invoiceRow("Special pricing note", payload.customMonthlyPriceReason) : ""}
      `
      : "";

  return emailShell(
    `Invoice ${invoiceNumber}`,
    `
      <p>Hi ${escapeHtml(payload.contactName)},</p>
      <p>Thank you for completing the Quotex software purchase for <strong>${escapeHtml(payload.agencyName)}</strong>. This invoice confirms the selected plan, signed checkout documents, and the agency access code issued for provisioning.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;background:#faf9f5;border:1px solid #e5dfd0;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:16px;vertical-align:top;width:50%;border-right:1px solid #e5dfd0;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#75622b;font-weight:700;">Bill to</div>
            <div style="margin-top:8px;font-size:16px;font-weight:700;color:#111;">${escapeHtml(payload.agencyName)}</div>
            <div>${escapeHtml(payload.contactName)}</div>
            <div>${escapeHtml(payload.email)}</div>
            ${payload.phone ? `<div>${escapeHtml(payload.phone)}</div>` : ""}
            ${payload.website ? `<div>${escapeHtml(payload.website)}</div>` : ""}
          </td>
          <td style="padding:16px;vertical-align:top;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#75622b;font-weight:700;">Invoice details</div>
            <div style="margin-top:8px;"><strong>Invoice:</strong> ${escapeHtml(invoiceNumber)}</div>
            <div><strong>Purchase:</strong> ${escapeHtml(purchaseSource)}</div>
            <div><strong>Payment:</strong> ${escapeHtml(paymentMethod)}</div>
            <div><strong>Date:</strong> ${escapeHtml(formatDateTime(payload.signedAt))}</div>
            ${payload.stripeCheckoutSessionId ? `<div><strong>Reference:</strong> ${escapeHtml(payload.stripeCheckoutSessionId)}</div>` : ""}
          </td>
        </tr>
      </table>

      <div style="border:1px solid #d9c37a;background:#fff8dc;border-radius:10px;padding:18px;margin:18px 0;">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#75622b;">Encrypted agency code</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px;color:#111;">${escapeHtml(payload.agencyCode)}</div>
        <div style="font-size:13px;color:#75622b;margin-top:8px;">Use this code only for authorized agency staff account setup.</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;">
        ${invoiceRow("Invoice record", payload.saleId)}
        ${invoiceRow("Staff users", String(payload.seats))}
        ${invoiceRow("Website / app package", payload.websiteAppAddOnLabel ?? "Software only")}
        ${invoiceRow("Website / app monthly", money(payload.websiteAppAddOnMonthly ?? 0))}
        ${payload.monthlyBeforeTermDiscount !== undefined ? invoiceRow("Monthly before term discount", money(payload.monthlyBeforeTermDiscount)) : ""}
        ${invoiceRow("Term", `${payload.termMonths} months${payload.termDiscountPercent ? `, ${payload.termDiscountPercent}% monthly discount` : ""}`)}
        ${invoiceRow("Term discount", `-${money(payload.termDiscountMonthly)}/mo`)}
        ${customPriceRows}
        ${invoiceRow("Setup fee", money(payload.setupFee))}
        ${invoiceRow("Monthly total", `${money(payload.estimatedMonthly)}/mo`, true)}
      </table>
      <p style="font-size:13px;color:#666;margin-top:-8px;">Unless otherwise stated in the signed checkout documents, the monthly software subscription renews according to the selected term and payment authorization.</p>
      <h2 style="font-size:18px;margin:24px 0 10px;">Signed checkout documents</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead>
          <tr>
            <th align="left" style="border-bottom:1px solid #ddd;padding:8px;">Document</th>
            <th align="left" style="border-bottom:1px solid #ddd;padding:8px;">Signer</th>
            <th align="left" style="border-bottom:1px solid #ddd;padding:8px;">Timestamp</th>
          </tr>
        </thead>
        <tbody>${signedRows}</tbody>
      </table>
      <p style="font-size:13px;color:#666;margin-top:22px;">Keep this email for your records. If any invoice detail is incorrect, reply directly to this email before provisioning continues.</p>
    `
  );
}

function invoiceEmailText(payload: z.infer<typeof invoicePayloadSchema>) {
  const invoiceNumber = invoiceNumberFor(payload.saleId);
  const signedDocuments = payload.signedAgreements.length
    ? payload.signedAgreements
        .map((agreement) => `- ${agreement.title}: ${agreement.signedByName ?? payload.contactName}, ${formatDateTime(agreement.signedAt)}`)
        .join("\n")
    : "- Signed documents pending or recorded outside this invoice.";

  return `Quotex invoice ${invoiceNumber}

Bill to: ${payload.agencyName}
Contact: ${payload.contactName}
Email: ${payload.email}
${payload.phone ? `Phone: ${payload.phone}\n` : ""}${payload.website ? `Website: ${payload.website}\n` : ""}
Agency code: ${payload.agencyCode}
Invoice record: ${payload.saleId}
Purchase source: ${payload.source === "master_portal" ? "Master portal assisted purchase" : "Secure checkout purchase"}
Payment method: ${payload.paymentMode === "manual_invoice" ? "Master-assisted invoice" : "Checkout payment"}
${payload.stripeCheckoutSessionId ? `Transaction reference: ${payload.stripeCheckoutSessionId}\n` : ""}
Staff users: ${payload.seats}
Website / app package: ${payload.websiteAppAddOnLabel ?? "Software only"}
Website / app monthly: ${money(payload.websiteAppAddOnMonthly ?? 0)}
${payload.monthlyBeforeTermDiscount !== undefined ? `Monthly before term discount: ${money(payload.monthlyBeforeTermDiscount)}\n` : ""}
Term: ${payload.termMonths} months${payload.termDiscountPercent ? `, ${payload.termDiscountPercent}% monthly discount` : ""}
Term discount: -${money(payload.termDiscountMonthly)}/mo
${payload.customMonthlyPriceUsd !== undefined ? `Standard monthly plan: ${money(payload.standardEstimatedMonthly ?? payload.estimatedMonthly)}
Approved monthly price: ${money(payload.customMonthlyPriceUsd)}
${payload.customMonthlyPriceReason ? `Special pricing note: ${payload.customMonthlyPriceReason}\n` : ""}` : ""}
Setup fee: ${money(payload.setupFee)}
Monthly total: ${money(payload.estimatedMonthly)}/mo

Signed checkout documents:
${signedDocuments}`;
}

function emailShell(title: string, body: string) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f5f3ed;font-family:Arial,Helvetica,sans-serif;color:#181713;">
        <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(title)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ed;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e4dfd2;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="background:#0b0a08;color:#fff;padding:24px 28px;">
                    <div style="font-size:22px;font-weight:700;">Quotex Insurance</div>
                    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#d7bd69;margin-top:4px;">Agency operating system</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;font-size:15px;line-height:1.55;">
                    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#111;">${escapeHtml(title)}</h1>
                    ${body}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function button(href: string, label: string) {
  return `
    <p style="margin:24px 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:#9b7627;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">${escapeHtml(label)}</a>
    </p>
  `;
}

function invoiceRow(label: string, value: string, strong = false) {
  return `
    <tr>
      <td style="border-bottom:1px solid #eee;padding:9px 8px;color:#666;">${escapeHtml(label)}</td>
      <td align="right" style="border-bottom:1px solid #eee;padding:9px 8px;${strong ? "font-size:20px;font-weight:700;color:#111;" : "font-weight:600;color:#222;"}">${escapeHtml(value)}</td>
    </tr>
  `;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function invoiceNumberFor(saleId: string) {
  const suffix = saleId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "00000000";
  return `QTX-${suffix}`;
}

function masterPortalEmailFrom() {
  return (
    env("MASTER_PORTAL_EMAIL_FROM") ||
    env("MASTER_PORTAL_EMAIL") ||
    env("EMAIL_FROM") ||
    env("SENDGRID_FROM_EMAIL") ||
    env("RESEND_FROM_EMAIL") ||
    "Quotex Insurance <no-reply@quotexinsurance.com>"
  );
}

function masterPortalReplyTo() {
  return env("MASTER_PORTAL_REPLY_TO") || env("MASTER_PORTAL_EMAIL") || env("EMAIL_REPLY_TO") || undefined;
}

function env(key: string) {
  return process.env[key]?.trim() ?? "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
