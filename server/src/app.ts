// =====================================================================
// Quotex Insurance backend app.
// Exported separately so the same Express app can run locally and as a
// Vercel Serverless Function.
// =====================================================================

import "./env.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { initServerErrorTracking, sentryErrorMiddleware } from "./errorTracking.js";
import { assertValidServerEnv, frontendOrigins, isProduction } from "./env.js";
import { enforceTenantIsolation, requireAuth, requireRole } from "./middleware/auth.js";
import {
  apiLimiter,
  appLimiter,
  authLimiter,
  diagnosticsLimiter,
  publicWorkflowLimiter,
  stateSyncLimiter,
  strictApiLimiter,
  webhookLimiter,
} from "./middleware/rateLimits.js";
import { aiRoutes } from "./routes/ai.js";
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { carriersRoutes } from "./routes/carriers.js";
import { claimsRoutes } from "./routes/claims.js";
import { communicationsRoutes } from "./routes/communications.js";
import { customersRoutes } from "./routes/customers.js";
import { documentsRoutes } from "./routes/documents.js";
import { mailboxOAuthCallbackRoutes, mailboxesRoutes } from "./routes/mailboxes.js";
import { marketingRoutes } from "./routes/marketing.js";
import { masterRoutes } from "./routes/master.js";
import { notesRoutes } from "./routes/notes.js";
import { paymentsRoutes } from "./routes/payments.js";
import { policiesRoutes } from "./routes/policies.js";
import { prospectsRoutes } from "./routes/prospects.js";
import { quotesRoutes } from "./routes/quotes.js";
import { renewalsRoutes } from "./routes/renewals.js";
import { signingPacketsRoutes } from "./routes/signingPackets.js";
import { stateBlobRoutes } from "./routes/stateBlobs.js";
import { stateRoutes } from "./routes/state.js";
import { statusRoutes } from "./routes/status.js";
import { stripeRoutes } from "./routes/stripe.js";
import { systemRoutes } from "./routes/system.js";
import { tenantsRoutes } from "./routes/tenants.js";
import { websiteRoutes } from "./routes/website.js";
import { runDisasterRecoveryCheck } from "./services/disasterRecovery.js";
import { pollDueMailboxConnections } from "./services/mailboxSync.js";
import { databaseHealth, prisma } from "./services/prisma.js";

type RawBodyRequest = {
  rawBody?: Buffer;
};

initServerErrorTracking();
assertValidServerEnv();

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet());
app.use((req, res, next) => {
  const incomingRequestId = req.header("x-request-id");
  const requestId = incomingRequestId && incomingRequestId.length <= 100 ? incomingRequestId : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

const allowedFrontendOrigins = frontendOrigins();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProduction() && allowedFrontendOrigins.length === 0) return callback(null, true);
      if (allowedFrontendOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("cors_origin_not_allowed"));
    },
    credentials: true,
  })
);
app.use(
  "/api/state-blobs",
  publicWorkflowLimiter,
  express.json({
    limit: "20mb",
    verify(req, _res, buffer) {
      (req as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  }),
  stateBlobRoutes
);
app.use(
  express.json({
    limit: "2mb",
    verify(req, _res, buffer) {
      (req as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  })
);

app.use(appLimiter);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/health/database", async (req, res) => {
  if (!canReadDiagnostics(req)) return res.status(404).json({ error: "not_found" });
  try {
    const health = await databaseHealth();
    res.status(health.ok ? 200 : 503).json(health);
  } catch {
    res.status(503).json({
      ok: false,
      configured: true,
      provider: "supabase-postgres",
      checkedAt: new Date().toISOString(),
    });
  }
});

app.get("/health/master-auth", diagnosticsLimiter, async (req, res) => {
  if (!canReadDiagnostics(req)) return res.status(404).json({ error: "not_found" });
  try {
    const masters = await prisma.user.findMany({
      where: { role: "master_admin" },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        passwordHash: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      masterCount: masters.length,
      activeMasterCount: masters.filter((user) => user.status === "active").length,
      masters: masters.map((user) => ({
        id: user.id,
        email: maskEmail(user.email),
        name: user.name,
        status: user.status,
        hasPasswordHash: Boolean(user.passwordHash),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
    });
  } catch {
    res.status(503).json({
      ok: false,
      error: "master_auth_diagnostic_failed",
      checkedAt: new Date().toISOString(),
    });
  }
});

app.get("/cron/disaster-recovery", diagnosticsLimiter, async (req, res, next) => {
  try {
    if (!canRunCron(req)) return res.status(401).json({ error: "unauthorized" });
    const report = await runDisasterRecoveryCheck({ source: "vercel-cron", persist: true });
    res.status(report.ok ? 200 : 503).json(report);
  } catch (error) {
    next(error);
  }
});

app.get("/cron/mailbox-sync", diagnosticsLimiter, async (req, res, next) => {
  try {
    if (!canRunCron(req)) return res.status(401).json({ error: "unauthorized" });
    const report = await pollDueMailboxConnections({ maxConnections: 25, maxResults: 25 });
    res.status(report.failed > 0 && report.checked === report.failed ? 503 : 200).json({
      ok: report.failed === 0,
      source: "vercel-cron",
      checkedAt: new Date().toISOString(),
      ...report,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/mailboxes/poll", diagnosticsLimiter, async (req, res, next) => {
  try {
    if (!canRunCron(req)) return res.status(401).json({ error: "unauthorized" });
    const report = await pollDueMailboxConnections({ maxConnections: 25, maxResults: 25 });
    res.status(report.failed > 0 && report.checked === report.failed ? 503 : 200).json({
      ok: report.failed === 0,
      source: "vercel-cron",
      checkedAt: new Date().toISOString(),
      ...report,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", apiLimiter);
app.use(
  "/api/auth",
  (req, res, next) => {
    if (req.method === "GET" && req.path === "/session") return next();
    return authLimiter(req, res, next);
  },
  authRoutes
);
app.use("/api/communications", publicWorkflowLimiter, communicationsRoutes);
app.use("/api/signing-packets", publicWorkflowLimiter, signingPacketsRoutes);
app.use("/api/state", stateSyncLimiter, stateRoutes);
app.use("/api/website", publicWorkflowLimiter, websiteRoutes);
app.use("/api/stripe", webhookLimiter, stripeRoutes);
app.use("/api/mailboxes/oauth", authLimiter, mailboxOAuthCallbackRoutes);

app.use("/api/tenants", requireAuth, enforceTenantIsolation, tenantsRoutes);
app.use("/api/mailboxes", requireAuth, enforceTenantIsolation, strictApiLimiter, mailboxesRoutes);
app.use("/api/customers", requireAuth, enforceTenantIsolation, customersRoutes);
app.use("/api/quotes", requireAuth, enforceTenantIsolation, strictApiLimiter, quotesRoutes);
app.use("/api/ai", requireAuth, enforceTenantIsolation, strictApiLimiter, aiRoutes);
app.use("/api/prospects", requireAuth, enforceTenantIsolation, prospectsRoutes);
app.use("/api/assets", requireAuth, enforceTenantIsolation, assetsRoutes);
app.use("/api/policies", requireAuth, enforceTenantIsolation, policiesRoutes);
app.use("/api/payments", requireAuth, enforceTenantIsolation, strictApiLimiter, paymentsRoutes);
app.use("/api/documents", requireAuth, enforceTenantIsolation, documentsRoutes);
app.use("/api/carriers", requireAuth, enforceTenantIsolation, carriersRoutes);
app.use("/api/claims", requireAuth, enforceTenantIsolation, claimsRoutes);
app.use("/api/marketing", requireAuth, enforceTenantIsolation, strictApiLimiter, marketingRoutes);
app.use("/api/renewals", requireAuth, enforceTenantIsolation, renewalsRoutes);
app.use("/api/status", requireAuth, enforceTenantIsolation, statusRoutes);
app.use("/api/notes", requireAuth, enforceTenantIsolation, notesRoutes);
app.use("/api/master", requireAuth, enforceTenantIsolation, requireRole("platform_owner", "platform_admin", "master_admin"), masterRoutes);
app.use("/api/system", requireAuth, enforceTenantIsolation, diagnosticsLimiter, systemRoutes);
app.use(sentryErrorMiddleware);

export default app;

function canReadDiagnostics(req: express.Request): boolean {
  if (!isProduction()) return true;
  const expected = process.env.DIAG_TOKEN?.trim();
  if (!expected) return false;
  const header = req.header("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
  return bearer === expected || queryToken === expected;
}

function canRunCron(req: express.Request): boolean {
  const acceptedSecrets = [process.env.CRON_SECRET?.trim(), process.env.DIAG_TOKEN?.trim()].filter(
    (value): value is string => Boolean(value)
  );
  if (!isProduction() && acceptedSecrets.length === 0) return true;

  const header = req.header("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return false;

  return acceptedSecrets.some((secret) => constantTimeEquals(bearer, secret));
}

function constantTimeEquals(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "(invalid email)";
  const visiblePrefix = name.slice(0, Math.min(2, name.length));
  return `${visiblePrefix}${"*".repeat(Math.max(3, name.length - visiblePrefix.length))}@${domain}`;
}
