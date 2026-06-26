interface RateLimitOptions {
  windowMs: number;
  limit: number;
  failOpen?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface HeaderLikeRequest {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

interface StatusLikeResponse {
  setHeader?: (name: string, value: string | number) => void;
  status: (code: number) => { json: (body: unknown) => void };
}

const buckets = new Map<string, RateLimitEntry>();

export async function applyRateLimit(
  req: HeaderLikeRequest,
  res: StatusLikeResponse,
  name: string,
  options: RateLimitOptions
): Promise<boolean> {
  if (productionRuntime() && !sharedRateLimitConfigured()) {
    if (options.failOpen || process.env.RATE_LIMIT_FAIL_OPEN === "true") {
      return applyMemoryRateLimit(req, res, name, options);
    }
    res.status(503).json({ error: "rate_limit_store_required" });
    return false;
  }
  if (sharedRateLimitConfigured()) {
    try {
      return await applySharedRateLimit(req, res, name, options);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[rate-limit] shared store failed", err);
      if (!options.failOpen && process.env.RATE_LIMIT_FAIL_OPEN !== "true") {
        res.status(503).json({ error: "rate_limit_unavailable" });
        return false;
      }
    }
  }
  return applyMemoryRateLimit(req, res, name, options);
}

function applyMemoryRateLimit(
  req: HeaderLikeRequest,
  res: StatusLikeResponse,
  name: string,
  options: RateLimitOptions
): boolean {
  const now = Date.now();
  const key = `${name}:${clientIp(req)}`;
  const current = buckets.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;

  entry.count += 1;
  buckets.set(key, entry);
  cleanupExpiredBuckets(now);

  const remaining = Math.max(0, options.limit - entry.count);
  const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  res.setHeader?.("RateLimit-Limit", options.limit);
  res.setHeader?.("RateLimit-Remaining", remaining);
  res.setHeader?.("RateLimit-Reset", resetSeconds);

  if (entry.count <= options.limit) return true;

  res.setHeader?.("Retry-After", resetSeconds);
  res.status(429).json({ error: "rate_limited", retryAfterSeconds: resetSeconds });
  return false;
}

async function applySharedRateLimit(
  req: HeaderLikeRequest,
  res: StatusLikeResponse,
  name: string,
  options: RateLimitOptions
): Promise<boolean> {
  const now = Date.now();
  const bucketStart = Math.floor(now / options.windowMs) * options.windowMs;
  const resetAt = bucketStart + options.windowMs;
  const resetSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  const key = [
    "quotex",
    "rate-limit",
    sanitizeKeyPart(name),
    sanitizeKeyPart(clientIp(req)),
    bucketStart,
  ].join(":");
  const count = await incrementSharedCounter(key, Math.ceil(options.windowMs / 1000) + 30);
  const remaining = Math.max(0, options.limit - count);
  res.setHeader?.("RateLimit-Limit", options.limit);
  res.setHeader?.("RateLimit-Remaining", remaining);
  res.setHeader?.("RateLimit-Reset", resetSeconds);
  res.setHeader?.("RateLimit-Policy", `${options.limit};w=${Math.ceil(options.windowMs / 1000)}`);

  if (count <= options.limit) return true;

  res.setHeader?.("Retry-After", resetSeconds);
  res.status(429).json({ error: "rate_limited", retryAfterSeconds: resetSeconds });
  return false;
}

async function incrementSharedCounter(key: string, ttlSeconds: number): Promise<number> {
  const endpoint = `${process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "")}/pipeline`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, ttlSeconds],
    ]),
  });

  if (!response.ok) {
    throw new Error(`upstash_rate_limit_failed:${response.status}`);
  }

  const data = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (data[0]?.error) throw new Error(`upstash_rate_limit_failed:${data[0].error}`);
  if (data[1]?.error) throw new Error(`upstash_rate_limit_failed:${data[1].error}`);
  const count = Number(data[0]?.result);
  if (!Number.isFinite(count)) throw new Error("upstash_rate_limit_bad_response");
  return count;
}

function sharedRateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function productionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._-]/g, "_").slice(0, 160) || "unknown";
}

function clientIp(req: HeaderLikeRequest): string {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headerValue(req, "x-real-ip") || req.socket?.remoteAddress || "unknown";
}

function headerValue(req: HeaderLikeRequest, name: string): string {
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function __resetRateLimitForTest() {
  buckets.clear();
}
