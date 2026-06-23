import type { NextFunction, Request, RequestHandler, Response } from "express";
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

function limiter(name: string, limit: number, windowMs = 60_000): RequestHandler {
  return async (req, res, next) => {
    if (!useGlobalRateLimitStore()) {
      return applyMemoryRateLimit(req, res, next, name, limit, windowMs);
    }

    try {
      const allowed = await applyPostgresRateLimit(req, res, name, limit, windowMs);
      if (allowed) return next();
      return;
    } catch (error) {
      console.error("[rate-limit] postgres store failed", error);
      if (process.env.RATE_LIMIT_FAIL_OPEN === "true") {
        return applyMemoryRateLimit(req, res, next, name, limit, windowMs);
      }
      return res.status(503).json({ error: "rate_limit_unavailable" });
    }
  };
}

export const appLimiter = limiter("app", envLimit("RATE_LIMIT_APP_PER_MINUTE", 900));
export const apiLimiter = limiter("api", envLimit("RATE_LIMIT_API_PER_MINUTE", 300));
export const authLimiter = limiter("auth", envLimit("RATE_LIMIT_AUTH_PER_MINUTE", 30));
export const publicWorkflowLimiter = limiter("public-workflow", envLimit("RATE_LIMIT_PUBLIC_WORKFLOW_PER_MINUTE", 90));
export const strictApiLimiter = limiter("strict-api", envLimit("RATE_LIMIT_STRICT_API_PER_MINUTE", 20));
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
  windowMs: number
): Promise<boolean> {
  const key = ["quotex", sanitizeKeyPart(name), sanitizeKeyPart(clientIp(req))].join(":");
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
  windowMs: number
) {
  const now = Date.now();
  const key = ["quotex", sanitizeKeyPart(name), sanitizeKeyPart(clientIp(req))].join(":");
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
  res.status(429).json({ error: "rate_limited", retryAfterSeconds: resetSeconds });
  return false;
}

function clientIp(req: Request): string {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headerValue(req, "x-real-ip") || req.ip || req.socket.remoteAddress || "unknown";
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
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
