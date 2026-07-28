import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHash } from "node:crypto";
import { prisma, databaseConfigured } from "../services/prisma.js";

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitRow = {
  count: number;
  reset_at: Date;
};

const memoryBuckets = new Map<string, RateLimitEntry>();
const DEFAULT_POSTGRES_RETRY_MS = 30_000;
let postgresRetryAfter = 0;
let postgresFallbackLogged = false;

function limiter(
  name: string,
  limit: number,
  windowMs = 60_000,
  identity?: (req: Request) => string,
  store: "global" | "memory" = "global"
): RequestHandler {
  return async (req, res, next) => {
    if (store === "memory" || !useGlobalRateLimitStore() || Date.now() < postgresRetryAfter) {
      return applyMemoryRateLimit(req, res, next, name, limit, windowMs, identity);
    }

    try {
      const allowed = await applyPostgresRateLimit(req, res, name, limit, windowMs, identity);
      if (postgresFallbackLogged) {
        console.info("[rate-limit] postgres store recovered");
      }
      postgresRetryAfter = 0;
      postgresFallbackLogged = false;
      if (allowed) return next();
      return;
    } catch (error) {
      console.error("[rate-limit] postgres store failed", error);
      postgresRetryAfter = Date.now() + envLimit("RATE_LIMIT_STORE_RETRY_MS", DEFAULT_POSTGRES_RETRY_MS);
      if (!postgresFallbackLogged) {
        console.warn("[rate-limit] using the in-memory fallback while the postgres store recovers");
        postgresFallbackLogged = true;
      }
      return applyMemoryRateLimit(req, res, next, name, limit, windowMs, identity);
    }
  };
}

// These broad, high-volume guards run in every serverless instance. Keeping
// them out of Postgres prevents ordinary traffic from consuming the database
// pool before authenticated routes can run their real queries.
export const appLimiter = limiter("app", envLimit("RATE_LIMIT_APP_PER_MINUTE", 900), 60_000, undefined, "memory");
export const apiLimiter = limiter("api", envLimit("RATE_LIMIT_API_PER_MINUTE", 300), 60_000, undefined, "memory");
export const authLimiter = limiter("auth", envLimit("RATE_LIMIT_AUTH_PER_MINUTE", 30));
export const authIpLimiter = limiter("auth-ip", envLimit("RATE_LIMIT_AUTH_IP_PER_MINUTE", 10));
export const authIdentityLimiter = limiter(
  "auth-identity",
  envLimit("RATE_LIMIT_AUTH_IDENTIFIER_PER_MINUTE", 10),
  60_000,
  authIdentifier
);
export const publicWorkflowLimiter = limiter("public-workflow", envLimit("RATE_LIMIT_PUBLIC_WORKFLOW_PER_MINUTE", 90));
export const stateSyncLimiter = limiter(
  "state-sync",
  envLimit("RATE_LIMIT_STATE_SYNC_PER_MINUTE", 120),
  60_000,
  undefined,
  "memory"
);
export const strictApiLimiter = limiter("strict-api", envLimit("RATE_LIMIT_STRICT_API_PER_MINUTE", 20));
export const mailboxApiLimiter = limiter(
  "mailbox-api",
  envLimit("RATE_LIMIT_MAILBOX_API_PER_MINUTE", 30),
  60_000,
  (req) => {
    const tenantId = req.auth?.tenantId?.trim();
    const userId = req.auth?.userId?.trim();
    return tenantId && userId ? `${tenantId}:${userId}` : "unauthenticated";
  }
);
export const connectApiLimiter = limiter(
  "connect-api",
  envLimit("RATE_LIMIT_CONNECT_API_PER_MINUTE", 120),
  60_000,
  authenticatedIdentity
);
export const connectExtensionLimiter = limiter(
  "connect-extension",
  envLimit("RATE_LIMIT_CONNECT_EXTENSION_PER_MINUTE", 240),
  60_000,
  extensionIdentity
);
export const webhookLimiter = limiter("webhook", envLimit("RATE_LIMIT_WEBHOOK_PER_MINUTE", 120));
export const diagnosticsLimiter = limiter("diagnostics", envLimit("RATE_LIMIT_DIAGNOSTICS_PER_MINUTE", 20));

function useGlobalRateLimitStore(): boolean {
  if (process.env.RATE_LIMIT_STORE === "memory") return false;
  return process.env.NODE_ENV === "production" && databaseConfigured();
}

async function applyPostgresRateLimit(
  req: Request,
  res: Response,
  name: string,
  limit: number,
  windowMs: number,
  identity?: (req: Request) => string
): Promise<boolean> {
  const key = rateLimitKey(req, name, identity);
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const rows = await prisma.$queryRaw<RateLimitRow[]>`
    INSERT INTO public.rate_limit_counters (key, count, reset_at, updated_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}), now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN public.rate_limit_counters.reset_at <= now() THEN 1
        ELSE public.rate_limit_counters.count + 1
      END,
      reset_at = CASE
        WHEN public.rate_limit_counters.reset_at <= now() THEN now() + make_interval(secs => ${windowSeconds})
        ELSE public.rate_limit_counters.reset_at
      END,
      updated_at = now()
    RETURNING count, reset_at
  `;
  const row = rows[0];
  if (!row) throw new Error("rate_limit_counter_missing");
  return writeRateLimitResponse(res, limit, row.count, row.reset_at.getTime());
}

function applyMemoryRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
  name: string,
  limit: number,
  windowMs: number,
  identity?: (req: Request) => string
) {
  const now = Date.now();
  const key = rateLimitKey(req, name, identity);
  const current = memoryBuckets.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;

  entry.count += 1;
  memoryBuckets.set(key, entry);
  cleanupExpiredMemoryBuckets(now);

  if (writeRateLimitResponse(res, limit, entry.count, entry.resetAt)) return next();
}

function writeRateLimitResponse(res: Response, limit: number, count: number, resetAt: number): boolean {
  const resetSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const remaining = Math.max(0, limit - count);
  res.setHeader("RateLimit-Limit", limit);
  res.setHeader("RateLimit-Remaining", remaining);
  res.setHeader("RateLimit-Reset", resetSeconds);
  res.setHeader("RateLimit-Policy", `${limit};w=${resetSeconds}`);

  if (count <= limit) return true;

  res.setHeader("Retry-After", resetSeconds);
  res.status(429).json({ ok: false, reason: "rate_limited", error: "rate_limited", retryAfterSeconds: resetSeconds });
  return false;
}

function clientIp(req: Request): string {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headerValue(req, "x-real-ip") || req.ip || req.socket.remoteAddress || "unknown";
}

function headerValue(req: Request, name: string): string {
  const headers = req.headers ?? {};
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 160) || "unknown";
}

function cleanupExpiredMemoryBuckets(now: number) {
  if (memoryBuckets.size < 1000) return;
  for (const [key, entry] of memoryBuckets) {
    if (entry.resetAt <= now) memoryBuckets.delete(key);
  }
}

function rateLimitKey(req: Request, name: string, identity?: (req: Request) => string): string {
  const parts = ["quotex", sanitizeKeyPart(name)];
  const value = identity?.(req).trim().toLowerCase();
  if (value) parts.push(createHash("sha256").update(value).digest("hex"));
  else parts.push(sanitizeKeyPart(clientIp(req)));
  return parts.join(":");
}

function authIdentifier(req: Request): string {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  for (const key of ["identifier", "email", "businessEmail"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "anonymous";
}

function authenticatedIdentity(req: Request): string {
  const tenantId = req.auth?.tenantId?.trim();
  const userId = req.auth?.userId?.trim();
  return tenantId && userId ? `${tenantId}:${userId}` : "unauthenticated";
}

function extensionIdentity(req: Request): string {
  const authorization = headerValue(req, "authorization").trim();
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "unauthenticated";
}

export function resetRateLimitStateForTests() {
  memoryBuckets.clear();
  postgresRetryAfter = 0;
  postgresFallbackLogged = false;
}
