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
import {
  isMailboxFallbackSafeError,
  saveAgencyMarketingSmtpCredential,
  sendMailboxEmail,
} from "../services/mailboxProvider.js";
import {
  listMailboxDiagnostics,
  listMailboxSyncStatus,
  listPersistedMailboxMessages,
  syncMailboxMessages,
} from "../services/mailboxSync.js";
import { emailDeliveryConfiguration, sendEmail } from "../services/email.js";
import { prisma } from "../services/prisma.js";
import {
  carrierReplyRelayConfiguration,
  createCarrierReplyRoute,
} from "../services/carrierReplyRelay.js";

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
  replyContext: z.object({
    communicationId: z.string().min(1).max(200),
    threadId: z.string().max(500).optional(),
    customerId: z.string().max(200).optional(),
    prospectId: z.string().max(200).optional(),
    carrierContactId: z.string().max(200).optional(),
    carrierSubmissionId: z.string().max(200).optional(),
  }).optional(),
});
const syncSchema = z.object({
  connectionId: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});
const replaySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
const agencyMarketingCredentialSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
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
    const carrierReplyRelay = carrierReplyRelayConfiguration();
    const readableConnections = connections.filter(connectionCanReadInbox);
    res.json({
      ok: true,
      capability: {
        mailboxConnected: connections.some((connection) => connection.status === "connected"),
        inboxSyncConnected: readableConnections.length > 0,
        inboxSyncProvider: readableConnections[0]?.provider ?? null,
        carrierReplyRelayConfigured: carrierReplyRelay.configured,
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

mailboxesRoutes.post("/replay", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const parsed = replaySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    const messages = await listPersistedMailboxMessages({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      limit: parsed.data.limit,
    });
    return res.json({ ok: true, messages });
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

mailboxesRoutes.post("/agency-marketing/credentials", async (req, res) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    if (!["agency_owner", "agency_admin", "manager"].includes(req.auth.role)) {
      return res.status(403).json({ ok: false, error: "manager_required" });
    }
    const parsed = agencyMarketingCredentialSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    const agency = await prisma.agency.findFirst({
      where: { id: req.auth.tenantId, active: true },
      select: { name: true },
    });
    if (!agency) return res.status(404).json({ ok: false, error: "agency_not_found" });

    const connection = await saveAgencyMarketingSmtpCredential({
      tenantId: req.auth.tenantId,
      updatedById: req.auth.userId,
      agencyName: agency.name,
      ...parsed.data,
      provider: "auto",
    });
    return res.json({
      ok: true,
      connection: {
        ...connection,
        tokenVaultRef: connection.tokenVaultRef ? "server-managed" : null,
      },
      passwordConfigured: true,
    });
  } catch (error) {
    return res.status(422).json({
      ok: false,
      error: "agency_marketing_mailbox_rejected",
      message: error instanceof Error ? error.message : "The company mailbox could not be configured.",
    });
  }
});

mailboxesRoutes.post("/send", async (req, res, next) => {
  try {
    if (!req.auth?.tenantId) return res.status(403).json({ ok: false, error: "tenant_required" });
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

    const ownerType = parsed.data.senderMode === "agency_marketing" ? "agency_marketing" : "staff";
    if (
      ownerType === "agency_marketing" &&
      !["agency_owner", "agency_admin", "manager"].includes(req.auth.role)
    ) {
      return res.status(403).json({ ok: false, error: "manager_required" });
    }
    const identity = await resolveTransactionalIdentity({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      ownerType,
    });
    const carrierReplyTo = await createCarrierReplyRoute({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      mailboxAccount: identity.email,
      context: parsed.data.replyContext,
    });
    const effectiveReplyTo = carrierReplyTo ?? identity.email;
    try {
      const result = await sendMailboxEmail({
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
        ownerType,
        expectedAddress: identity.email,
        ...parsed.data,
        senderName: identity.name,
        replyTo: effectiveReplyTo,
      });
      return res.json({ ok: true, result });
    } catch (mailboxError) {
      if (!isMailboxFallbackSafeError(mailboxError)) {
        return res.status(502).json({
          ok: false,
          error: "mailbox_delivery_unconfirmed",
          message: "The mailbox provider did not confirm delivery. Check Sent mail before retrying.",
        });
      }
      const fallback = await sendWithTransactionalFallback(parsed.data, mailboxError, identity, effectiveReplyTo);
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
    const replayed = await listPersistedMailboxMessages({
      tenantId: req.auth.tenantId,
      userId: req.auth.userId,
      limit: 250,
    });
    const byProviderMessage = new Map(
      [...result.messages, ...replayed].map((message) => [
        `${message.mailboxConnectionId}:${message.externalMessageId}`,
        message,
      ])
    );
    res.json({ ok: true, result: { ...result, messages: [...byProviderMessage.values()] } });
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

function connectionCanReadInbox(connection: {
  status?: string;
  authMode?: string;
  provider?: string;
  scopes?: unknown[];
}) {
  if (connection.status !== "connected" || connection.authMode !== "oauth") return false;
  const scopes = (connection.scopes ?? [])
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.toLowerCase());
  return scopes.some((scope) =>
    connection.provider === "google"
      ? scope.includes("gmail.readonly") || scope.includes("gmail.modify")
      : scope === "mail.read" || scope === "mail.readwrite"
  );
}

async function sendWithTransactionalFallback(
  input: z.infer<typeof sendSchema>,
  mailboxError: unknown,
  identity: { name: string; email: string },
  replyTo: string
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
  const subject = input.subject?.trim() || "A message from your insurance agency";
  const text = input.text?.trim() || stripHtml(input.html ?? "");
  const html = input.html?.trim() || plainTextToHtml(text);
  const fallbackReason = mailboxError instanceof Error ? mailboxError.message : "Mailbox provider send failed.";

  const result = await sendEmail({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    from: transactionalFromFor(identity.name),
    subject,
    text,
    html,
    replyTo,
    headers: transactionalThreadHeaders(input),
    attachments: input.attachments,
    categories:
      input.senderMode === "agency_marketing"
        ? ["agency-marketing", "campaign"]
        : ["mailbox-fallback", "user-portal"],
  });
  if (result.status !== "sent") {
    return {
      ok: false,
      error: "mailbox_send_failed",
      message: result.error || "Email delivery is temporarily unavailable.",
      fallback: {
        mailboxReason: fallbackReason,
        provider: result.provider,
        configured: result.configured,
      },
    };
  }

  return {
    ok: true,
    result: {
      provider: "transactional",
      status: "sent",
      externalMessageId: result.id,
      fallbackReason,
    },
  };
}

function transactionalFromFor(senderName: string): string | undefined {
  const configuredFrom = emailDeliveryConfiguration().from;
  if (!configuredFrom) return undefined;
  const address = configuredFrom.match(/<([^>]+)>/)?.[1] ?? configuredFrom;
  const cleanAddress = address.trim();
  if (!emailSchema.safeParse(cleanAddress).success) return undefined;
  const cleanName = senderName.replace(/[\r\n<>]/g, " ").replace(/\s{2,}/g, " ").trim();
  return cleanName ? `${cleanName} <${cleanAddress}>` : configuredFrom;
}

async function resolveTransactionalIdentity(input: {
  tenantId: string;
  userId: string;
  ownerType: "staff" | "agency_marketing";
}): Promise<{ name: string; email: string }> {
  if (input.ownerType === "agency_marketing") {
    const [agency, connectedMailbox] = await Promise.all([
      prisma.agency.findFirst({
        where: { id: input.tenantId, active: true },
        select: { name: true, contactEmail: true },
      }),
      prisma.mailboxConnection.findFirst({
        where: {
          tenantId: input.tenantId,
          ownerType: "agency_marketing",
          status: "connected",
        },
        orderBy: { updatedAt: "desc" },
        select: { address: true, displayName: true },
      }),
    ]);
    const email = connectedMailbox?.address.trim() || agency?.contactEmail.trim() || "";
    if (!agency || !emailSchema.safeParse(email).success) {
      throw new Error("The agency contact email is unavailable.");
    }
    return {
      name: connectedMailbox?.displayName?.trim() || agency.name.trim() || "Insurance agency",
      email,
    };
  }

  const user = await prisma.user.findFirst({
    where: { id: input.userId, tenantId: input.tenantId, status: "active" },
    select: { name: true, email: true },
  });
  if (!user || !emailSchema.safeParse(user.email).success) {
    throw new Error("The signed-in staff email is unavailable.");
  }
  return { name: user.name.trim() || "Agency staff", email: user.email.trim() };
}

function transactionalThreadHeaders(input: z.infer<typeof sendSchema>): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (input.replyToMessageIdHeader?.trim()) headers["In-Reply-To"] = input.replyToMessageIdHeader.trim();
  const references = input.references?.map((value) => value.trim()).filter(Boolean);
  if (references?.length) headers.References = references.join(" ");
  return Object.keys(headers).length ? headers : undefined;
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

function plainTextToHtml(value: string) {
  return escapeHtml(value || "A message from your insurance agency.")
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
