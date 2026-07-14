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
import { sendEmail } from "../services/email.js";

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

    try {
      const result = await sendMailboxEmail({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        ...parsed.data,
      });
      return res.json({ ok: true, result });
    } catch (mailboxError) {
      const fallback = await sendWithTransactionalFallback(parsed.data, mailboxError);
      if (fallback.ok) return res.json(fallback);
      return res.status(502).json(fallback);
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

async function sendWithTransactionalFallback(
  input: z.infer<typeof sendSchema>,
  mailboxError: unknown
): Promise<
  | {
      ok: true;
      result: {
        provider: "transactional";
        status: "sent";
        externalMessageId: string;
        fallbackReason: string;
      };
    }
  | { ok: false; error: "mailbox_send_failed"; message: string; fallback?: unknown }
> {
  const subject = input.subject?.trim() || "A message from Quotex Insurance";
  const text = input.text?.trim() || stripHtml(input.html ?? "");
  const html = input.html?.trim() || plainTextToHtml(text);
  const fallbackReason = mailboxError instanceof Error ? mailboxError.message : "Mailbox provider send failed.";

  const results = await Promise.all(
    input.to.map((recipient) =>
      sendEmail({
        to: recipient,
        subject,
        text,
        html,
        replyTo: input.replyTo,
        attachments: input.attachments,
        categories: ["mailbox-fallback", "user-portal"],
      })
    )
  );
  const failed = results.find((result) => result.status !== "sent");
  if (failed) {
    return {
      ok: false,
      error: "mailbox_send_failed",
      message:
        failed.error ||
        `Mailbox send failed (${fallbackReason}) and transactional fallback could not deliver.`,
      fallback: {
        mailboxReason: fallbackReason,
        provider: failed.provider,
        configured: failed.configured,
      },
    };
  }

  return {
    ok: true,
    result: {
      provider: "transactional",
      status: "sent",
      externalMessageId: results.map((result) => result.id).join(","),
      fallbackReason,
    },
  };
}

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

function plainTextToHtml(value: string) {
  return escapeHtml(value || "A message from Quotex Insurance.")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
