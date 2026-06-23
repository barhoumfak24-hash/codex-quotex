import { createHash } from "node:crypto";
import type { CompleteArgs } from "./provider.js";

export interface ServerAiUsageEvent {
  id: string;
  feature: string;
  payloadHash: string;
  payloadBytes: number;
  status: "cache_hit" | "deduped" | "success" | "blocked" | "error";
  cached: boolean;
  deduped: boolean;
  estimatedUnitCost: number;
  startedAt: string;
  durationMs: number;
  reason?: string;
}

export class ServerAiGovernorError extends Error {
  constructor(
    readonly code: "payload_too_large" | "quota_exceeded",
    message: string
  ) {
    super(message);
    this.name = "ServerAiGovernorError";
  }
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const DEFAULT_MAX_PAYLOAD_BYTES = 2_000_000;
const DEFAULT_MAX_PER_MINUTE = 120;
const DEFAULT_CACHE_TTL_MS = 60_000;
const MAX_EVENTS = 1_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const quotaWindow: number[] = [];
const events: ServerAiUsageEvent[] = [];
let eventCounter = 0;

export async function runServerAiJob<T>(args: CompleteArgs, runner: () => Promise<T>): Promise<T> {
  const startedAtMs = Date.now();
  const feature = args.schemaName ?? "unknown_ai_task";
  const payloadHash = hashArgs(args);
  const payloadBytes = estimatePayloadBytes(args);
  const cacheKey = `${feature}:${payloadHash}`;
  const cacheTtlMs = cacheTtlFor(feature);

  if (payloadBytes > configuredMaxPayloadBytes()) {
    recordEvent({
      feature,
      payloadHash,
      payloadBytes,
      status: "blocked",
      startedAtMs,
      reason: "payload_too_large",
    });
    throw new ServerAiGovernorError(
      "payload_too_large",
      `AI payload for ${feature} is ${payloadBytes} bytes, above the configured limit.`
    );
  }

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    recordEvent({ feature, payloadHash, payloadBytes, status: "cache_hit", startedAtMs });
    return cached.value as T;
  }
  if (cached) cache.delete(cacheKey);

  if (inFlight.has(cacheKey)) {
    recordEvent({ feature, payloadHash, payloadBytes, status: "deduped", startedAtMs });
    return (await inFlight.get(cacheKey)) as T;
  }

  if (!reserveServerQuota()) {
    recordEvent({
      feature,
      payloadHash,
      payloadBytes,
      status: "blocked",
      startedAtMs,
      reason: "quota_exceeded",
    });
    throw new ServerAiGovernorError(
      "quota_exceeded",
      "Server AI quota exceeded. Retry after the current minute window resets."
    );
  }

  const promise = (async () => {
    try {
      const value = await runner();
      if (cacheTtlMs > 0 && value !== null && value !== undefined) {
        cache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
      }
      recordEvent({ feature, payloadHash, payloadBytes, status: "success", startedAtMs });
      return value;
    } catch (error) {
      recordEvent({
        feature,
        payloadHash,
        payloadBytes,
        status: error instanceof ServerAiGovernorError ? "blocked" : "error",
        startedAtMs,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

export function getServerAiUsageEvents(): ServerAiUsageEvent[] {
  return [...events];
}

export function resetServerAiGovernor() {
  cache.clear();
  inFlight.clear();
  quotaWindow.splice(0);
  events.splice(0);
  eventCounter = 0;
}

function configuredMaxPayloadBytes(): number {
  const value = Number(process.env.AI_MAX_PAYLOAD_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_PAYLOAD_BYTES;
}

function configuredMaxPerMinute(): number {
  const value = Number(process.env.AI_MAX_REQUESTS_PER_MINUTE);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_PER_MINUTE;
}

function cacheTtlFor(feature: string): number {
  const configured = Number(process.env.AI_CACHE_TTL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  if (/portal_assistant/i.test(feature)) return 20_000;
  if (/extract|parse|pamphlet|campaign|premium|carrier/i.test(feature)) return 5 * 60_000;
  return DEFAULT_CACHE_TTL_MS;
}

function reserveServerQuota(): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  for (let index = quotaWindow.length - 1; index >= 0; index -= 1) {
    if (quotaWindow[index] < windowStart) quotaWindow.splice(index, 1);
  }
  if (quotaWindow.length >= configuredMaxPerMinute()) return false;
  quotaWindow.push(now);
  return true;
}

function recordEvent(input: {
  feature: string;
  payloadHash: string;
  payloadBytes: number;
  status: ServerAiUsageEvent["status"];
  startedAtMs: number;
  reason?: string;
}) {
  const estimatedUnitCost =
    input.status === "success" ? Math.max(1, Math.ceil(input.payloadBytes / 100_000)) : 0;
  events.push({
    id: `srv_ai_evt_${++eventCounter}`,
    feature: input.feature,
    payloadHash: input.payloadHash,
    payloadBytes: input.payloadBytes,
    status: input.status,
    cached: input.status === "cache_hit",
    deduped: input.status === "deduped",
    estimatedUnitCost,
    startedAt: new Date(input.startedAtMs).toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
    reason: input.reason,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function hashArgs(args: CompleteArgs): string {
  const normalized = JSON.stringify({
    system: args.system,
    user: args.user,
    attachments: args.attachments?.map((attachment) => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      dataHash: createHash("sha256").update(attachment.dataUrl).digest("hex"),
    })),
    schemaName: args.schemaName,
    schema: args.schema,
    model: args.model,
    quality: args.quality,
    maxOutputTokens: args.maxOutputTokens,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

function estimatePayloadBytes(args: CompleteArgs): number {
  let total = Buffer.byteLength(args.system) + Buffer.byteLength(args.user);
  total += args.attachments?.reduce((sum, attachment) => sum + Buffer.byteLength(attachment.dataUrl), 0) ?? 0;
  if (args.schema) total += Buffer.byteLength(JSON.stringify(args.schema));
  return total;
}
