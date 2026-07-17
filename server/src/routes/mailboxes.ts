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
import { listMailboxDiagnostics, listMailboxSyncStatus, syncMailboxMessages } from "../services/mailboxSync.js";
import { emailDeliveryConfiguration } from "../services/email.js";

export const mailboxesRoutes = Router();
export const mailboxOAuthCallbackRoutes = Router();

const providerSchema = z.enum(["google", "microsoft"]);
const startSchema = z.object({
  redirectAfter: z.string().optional(),
  ownerType: z.enum(["staff", "agency_marketing"]).optional(),
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
  senderMode: z.enum(["staff", "agency_marketing"]).optional(),
  senderName: z.string().trim().min(1).max(160).optional(),
  to: z.array(emailSchema).min(1).max(50),
  cc: z.array(emailSchema).max(50).optional(),
  bcc: z.array(emailSchema).max(50).optional(),
  subject: z.string().max(998).optional(),
  text: z.string().max(250_000).optional(),
  html: z.string().max(500_000).optional(),
  replyTo: emailSchema.optional(),
  replyToMessageIdHeader: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(50).optional(),
  externalThreadId: z.string().max(500).optional(),
  attachments: z.array(attachmentSchema).max(25).optional(),
});
const syncSchema = z.object({
  connectionId: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
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

mailboxesRoutes.get("/capability", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const connections = await listMailboxConnections({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
    });
    const transactional = emailDeliveryConfiguration();
    res.json({
      ok: true,
      capability: {
        mailboxConnected: connections.some((connection) => connection.status === "connected"),
        transactionalConfigured: transactional.configured,
        transactionalProvider: transactional.provider,
        missingEnvironmentVariables: transactional.missingEnvironmentVariables,
        acceptedConfigurations: transactional.acceptedConfigurations,
      },
    });
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
    const ownerType = parsed.data.ownerType ?? "staff";
    if (
      ownerType === "agency_marketing" &&
      !["agency_owner", "agency_admin", "manager"].includes(req.auth.role)
    ) {
      return res.status(403).json({ ok: false, error: "manager_required" });
    }

    const result = await createMailboxOAuthStart({
      provider,
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      redirectAfter: parsed.data.redirectAfter,
      ownerType,
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

    const ownerType = parsed.data.senderMode === "agency_marketing" ? "agency_marketing" : "staff";
    try {
      const result = await sendMailboxEmail({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        ownerType,
        ...parsed.data,
      });
      return res.json({ ok: true, result });
    } catch (mailboxError) {
      return res.status(409).json({
        ok: false,
        error: "mailbox_connection_required",
        message:
          ownerType === "agency_marketing"
            ? "Connect the agency main mailbox in Agency setup before sending campaigns."
            : "Connect your Google or Microsoft mailbox in Account settings before sending email.",
        reason: mailboxError instanceof Error ? mailboxError.message : "Mailbox delivery was unavailable.",
      });
    }
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

mailboxesRoutes.post("/sync", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const parsed = syncSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const result = await syncMailboxMessages({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      connectionId: parsed.data.connectionId,
      maxResults: parsed.data.maxResults,
    });
    res.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error) {
      return res.status(502).json({
        ok: false,
        error: "mailbox_sync_failed",
        message: error.message,
      });
    }
    next(error);
  }
});

mailboxesRoutes.get("/sync/status", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const status = await listMailboxSyncStatus({
      tenantId: req.auth.tenantId,
      limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
    });
    res.json({ ok: true, status });
  } catch (error) {
    next(error);
  }
});

mailboxesRoutes.get("/diagnostics", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const diagnostics = await listMailboxDiagnostics({
      tenantId: req.auth.tenantId,
      userId: req.query.mine === "true" ? req.auth.userId : undefined,
    });
    res.json({ ok: true, diagnostics });
  } catch (error) {
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
    res.redirect(
      mailboxRedirectUrl(
        `${result.redirectAfter}${separator}mailbox=connected&provider=${providerResult.data}&owner=${result.connection.ownerType}`
      )
    );
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
