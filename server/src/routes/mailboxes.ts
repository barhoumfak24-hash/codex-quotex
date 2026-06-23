import { Router } from "express";
import { z } from "zod";
import { frontendOrigins } from "../env.js";
import {
  completeMailboxOAuth,
  createMailboxOAuthStart,
  listMailboxConnections,
  mailboxOAuthReadiness,
  type MailboxOAuthProvider,
} from "../services/mailboxOAuth.js";
import { sendMailboxEmail } from "../services/mailboxProvider.js";

export const mailboxesRoutes = Router();
export const mailboxOAuthCallbackRoutes = Router();

const providerSchema = z.enum(["google", "microsoft"]);
const startSchema = z.object({
  redirectAfter: z.string().optional(),
});
const emailSchema = z.string().email();
const attachmentSchema = z.object({
  fileName: z.string().min(1).max(260),
  fileType: z.string().max(160).optional(),
  dataUrl: z.string().max(25_000_000).optional(),
  contentBase64: z.string().max(25_000_000).optional(),
});
const sendSchema = z.object({
  connectionId: z.string().optional(),
  to: z.array(emailSchema).min(1).max(50),
  cc: z.array(emailSchema).max(50).optional(),
  bcc: z.array(emailSchema).max(50).optional(),
  subject: z.string().max(998).optional(),
  text: z.string().max(250_000).optional(),
  html: z.string().max(500_000).optional(),
  attachments: z.array(attachmentSchema).max(25).optional(),
});

mailboxesRoutes.get("/oauth/readiness", (_req, res) => {
  res.json({ ok: true, readiness: mailboxOAuthReadiness() });
});

mailboxesRoutes.get("/connections", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const mineOnly = req.query.mine === "true";
    const connections = await listMailboxConnections({
      tenantId: req.auth.tenantId,
      userId: mineOnly ? req.auth.userId : undefined,
    });
    res.json({ ok: true, connections });
  } catch (error) {
    next(error);
  }
});

mailboxesRoutes.post("/oauth/:provider/start", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const provider = parseProvider(req.params.provider);
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const result = await createMailboxOAuthStart({
      provider,
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      redirectAfter: parsed.data.redirectAfter,
    });
    res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    if (error instanceof Error) {
      return res.status(503).json({
        ok: false,
        error: "mailbox_oauth_unavailable",
        message: error.message,
      });
    }
    next(error);
  }
});

mailboxesRoutes.post("/send", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const result = await sendMailboxEmail({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      ...parsed.data,
    });
    res.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(502).json({
        ok: false,
        error: "mailbox_send_failed",
        message: error.message,
      });
    }
    next(error);
  }
});

mailboxOAuthCallbackRoutes.get("/:provider/callback", async (req, res) => {
  const providerResult = providerSchema.safeParse(req.params.provider);
  const fallback = mailboxRedirectUrl("/employee/account-settings?mailbox=error");
  if (!providerResult.success) return res.redirect(fallback);
  if (typeof req.query.error === "string") {
    return res.redirect(mailboxRedirectUrl(`/employee/account-settings?mailbox=error&provider=${providerResult.data}`));
  }
  if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
    return res.redirect(fallback);
  }

  try {
    const result = await completeMailboxOAuth({
      provider: providerResult.data,
      code: req.query.code,
      state: req.query.state,
    });
    const separator = result.redirectAfter.includes("?") ? "&" : "?";
    res.redirect(mailboxRedirectUrl(`${result.redirectAfter}${separator}mailbox=connected&provider=${providerResult.data}`));
  } catch {
    res.redirect(mailboxRedirectUrl(`/employee/account-settings?mailbox=error&provider=${providerResult.data}`));
  }
});

function parseProvider(value: unknown): MailboxOAuthProvider {
  const parsed = providerSchema.safeParse(value);
  if (!parsed.success) throw new Error("Unsupported mailbox provider.");
  return parsed.data;
}

function mailboxRedirectUrl(path: string): string {
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/employee/account-settings";
  const origin = frontendOrigins()[0] ?? "http://localhost:5174";
  return `${origin.replace(/\/+$/, "")}${safePath}`;
}
