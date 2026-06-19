import { Router } from "express";
import { z } from "zod";
import { sendEmail } from "../services/email.js";
import { sendSms } from "../services/twilio.js";

export const communicationsRoutes = Router();

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
  agencyCode: z.string().min(1),
  seats: z.number().int().positive(),
  estimatedMonthly: z.number().nonnegative(),
  setupFee: z.number().nonnegative().default(0),
  websiteAppAddOnLabel: z.string().optional(),
  websiteAppAddOnMonthly: z.number().nonnegative().optional(),
  termMonths: z.union([z.literal(12), z.literal(24), z.literal(36)]).default(12),
  termDiscountPercent: z.number().nonnegative().default(0),
  termDiscountMonthly: z.number().nonnegative().default(0),
  monthlyBeforeTermDiscount: z.number().nonnegative().optional(),
  signedAgreements: z.array(signedAgreementSchema).default([]),
});

communicationsRoutes.post("/software-sale/signing-email", async (req, res) => {
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

communicationsRoutes.post("/software-sale/signing-sms", async (req, res) => {
  const parsed = signingPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  if (!payload.phone) return res.status(400).json({ ok: false, error: "A phone number is required." });

  const result = await sendSms({
    to: payload.phone,
    body: `Quotex documents for ${payload.agencyName}: ${payload.signingLink} Please review and sign each required document.`,
    metadata: { agencyName: payload.agencyName, kind: "software-sale-esign" },
  });

  return res.status(result.status === "failed" ? 502 : 200).json({ ok: result.status !== "failed", result });
});

communicationsRoutes.post("/software-sale/invoice-email", async (req, res) => {
  const parsed = invoicePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const result = await sendEmail({
    to: payload.email,
    subject: `Quotex invoice and agency code for ${payload.agencyName}`,
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
      <p>Your Quotex software plan documents for <strong>${escapeHtml(payload.agencyName)}</strong> are ready for review. Each document needs its own electronic signature before payment or provisioning can continue.</p>
      <ul>${documentList}</ul>
      ${button(payload.signingLink, "Open secure signing packet")}
      <p style="font-size:13px;color:#666;">If the button does not open, paste this link into your browser:<br>${escapeHtml(payload.signingLink)}</p>
    `
  );
}

function signingEmailText(payload: z.infer<typeof signingPayloadSchema>) {
  const docs = payload.documents.map((document) => `- ${document.title}${document.version ? ` (${document.version})` : ""}`).join("\n");
  return `Hi ${payload.contactName},

Your Quotex software plan documents for ${payload.agencyName} are ready for review. Each document needs its own electronic signature.

${docs}

Open the secure signing packet:
${payload.signingLink}`;
}

function invoiceEmailHtml(payload: z.infer<typeof invoicePayloadSchema>) {
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

  return emailShell(
    "Your Quotex invoice and agency code",
    `
      <p>Hi ${escapeHtml(payload.contactName)},</p>
      <p>Thank you for completing the Quotex monthly software plan for <strong>${escapeHtml(payload.agencyName)}</strong>. Your agency code is below.</p>
      <div style="border:1px solid #d9c37a;background:#fff8dc;border-radius:10px;padding:18px;margin:18px 0;">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#75622b;">Encrypted agency code</div>
        <div style="font-size:28px;font-weight:700;margin-top:6px;color:#111;">${escapeHtml(payload.agencyCode)}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;">
        ${invoiceRow("Invoice record", payload.saleId)}
        ${invoiceRow("Staff users", String(payload.seats))}
        ${invoiceRow("Website / app package", payload.websiteAppAddOnLabel ?? "Software only")}
        ${invoiceRow("Website / app monthly", money(payload.websiteAppAddOnMonthly ?? 0))}
        ${invoiceRow("Term", `${payload.termMonths} months${payload.termDiscountPercent ? `, ${payload.termDiscountPercent}% monthly discount` : ""}`)}
        ${invoiceRow("Term discount", `-${money(payload.termDiscountMonthly)}/mo`)}
        ${invoiceRow("Setup fee", money(payload.setupFee))}
        ${invoiceRow("Monthly total", `${money(payload.estimatedMonthly)}/mo`, true)}
      </table>
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
      <p style="font-size:13px;color:#666;margin-top:22px;">Keep this email for your records. Production payments, legal agreements, and agency-code issuance should be finalized through the connected payment processor and counsel-approved documents.</p>
    `
  );
}

function invoiceEmailText(payload: z.infer<typeof invoicePayloadSchema>) {
  const signedDocuments = payload.signedAgreements.length
    ? payload.signedAgreements
        .map((agreement) => `- ${agreement.title}: ${agreement.signedByName ?? payload.contactName}, ${formatDateTime(agreement.signedAt)}`)
        .join("\n")
    : "- Signed documents pending or recorded outside this invoice.";

  return `Quotex invoice for ${payload.agencyName}

Agency code: ${payload.agencyCode}
Invoice record: ${payload.saleId}
Staff users: ${payload.seats}
Website / app package: ${payload.websiteAppAddOnLabel ?? "Software only"}
Website / app monthly: ${money(payload.websiteAppAddOnMonthly ?? 0)}
Term: ${payload.termMonths} months${payload.termDiscountPercent ? `, ${payload.termDiscountPercent}% monthly discount` : ""}
Term discount: -${money(payload.termDiscountMonthly)}/mo
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
