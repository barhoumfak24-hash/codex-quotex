export type AiResourceFeature =
  | "intake_parse"
  | "premium_estimate"
  | "carrier_match"
  | "marketing_message"
  | "email_subject"
  | "message_enhancement"
  | "contact_extraction"
  | "policy_extraction"
  | "asset_enrichment"
  | "property_imagery"
  | "document_mapping"
  | "acord_mapping"
  | "carrier_appetite_parse"
  | "campaign_draft"
  | "marketing_creative"
  | "pamphlet_draft"
  | "portal_assistant"
  | "sort_intent"
  | "unknown";

export type AiResourceEventStatus =
  | "cache_hit"
  | "deduped"
  | "success"
  | "blocked"
  | "error";

export interface AiResourcePolicy {
  cacheTtlMs: number;
  dedupe: boolean;
  estimatedUnitCost: number;
  maxPerMinute: number;
  maxPayloadBytes: number;
}

export interface AiResourceJobInput {
  feature: AiResourceFeature;
  operation: string;
  payload: unknown;
  tenantId?: string;
  userId?: string;
  forceRefresh?: boolean;
  policy?: Partial<AiResourcePolicy>;
}

export interface AiResourceEvent {
  id: string;
  feature: AiResourceFeature;
  operation: string;
  tenantId: string;
  userId?: string;
  payloadHash: string;
  payloadBytes: number;
  status: AiResourceEventStatus;
  cached: boolean;
  deduped: boolean;
  estimatedUnitCost: number;
  startedAt: string;
  durationMs: number;
  reason?: string;
}

export interface AiResourceMetrics {
  events: number;
  blocked: number;
  cacheHits: number;
  deduped: number;
  errors: number;
  estimatedUnitCost: number;
  byFeature: Record<
    AiResourceFeature,
    {
      events: number;
      blocked: number;
      cacheHits: number;
      deduped: number;
      estimatedUnitCost: number;
    }
  >;
}

export class AiResourceGovernorError extends Error {
  constructor(
    readonly code: "payload_too_large" | "quota_exceeded",
    message: string
  ) {
    super(message);
    this.name = "AiResourceGovernorError";
  }
}

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const DEFAULT_POLICY: AiResourcePolicy = {
  cacheTtlMs: 60_000,
  dedupe: true,
  estimatedUnitCost: 1,
  maxPerMinute: 60,
  maxPayloadBytes: 1_800_000,
};

const FEATURE_POLICIES: Partial<Record<AiResourceFeature, Partial<AiResourcePolicy>>> = {
  intake_parse: { cacheTtlMs: 5 * 60_000, estimatedUnitCost: 2 },
  premium_estimate: { cacheTtlMs: 10 * 60_000, estimatedUnitCost: 3 },
  carrier_match: { cacheTtlMs: 10 * 60_000, estimatedUnitCost: 2 },
  marketing_message: { cacheTtlMs: 5 * 60_000, estimatedUnitCost: 1 },
  email_subject: { cacheTtlMs: 5 * 60_000, estimatedUnitCost: 1 },
  message_enhancement: { cacheTtlMs: 2 * 60_000, estimatedUnitCost: 1 },
  contact_extraction: { cacheTtlMs: 15 * 60_000, estimatedUnitCost: 5 },
  policy_extraction: { cacheTtlMs: 15 * 60_000, estimatedUnitCost: 5 },
  asset_enrichment: { cacheTtlMs: 30 * 60_000, estimatedUnitCost: 4 },
  property_imagery: { cacheTtlMs: 24 * 60 * 60_000, estimatedUnitCost: 10, maxPerMinute: 10 },
  document_mapping: { cacheTtlMs: 0, estimatedUnitCost: 10, maxPerMinute: 15 },
  acord_mapping: { cacheTtlMs: 0, estimatedUnitCost: 8, maxPerMinute: 20 },
  carrier_appetite_parse: { cacheTtlMs: 30 * 60_000, estimatedUnitCost: 5 },
  campaign_draft: { cacheTtlMs: 5 * 60_000, estimatedUnitCost: 2 },
  marketing_creative: { cacheTtlMs: 5 * 60_000, estimatedUnitCost: 2 },
  pamphlet_draft: { cacheTtlMs: 10 * 60_000, estimatedUnitCost: 3 },
  portal_assistant: { cacheTtlMs: 20_000, estimatedUnitCost: 1, maxPerMinute: 30 },
  sort_intent: { cacheTtlMs: 10 * 60_000, estimatedUnitCost: 1, maxPerMinute: 120 },
};

const MAX_EVENTS = 500;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const quotaWindows = new Map<string, number[]>();
const events: AiResourceEvent[] = [];

let eventCounter = 0;

export function aiFeatureForPath(path: string): AiResourceFeature {
  const normalized = path.replace(/^\/+/, "");
  switch (normalized) {
    case "ai/parse-intake":
      return "intake_parse";
    case "ai/premium-estimate":
      return "premium_estimate";
    case "ai/carrier-match":
      return "carrier_match";
    case "ai/marketing-message":
      return "marketing_message";
    case "ai/email-subject":
      return "email_subject";
    case "ai/enhance-message":
      return "message_enhancement";
    case "ai/extract-contact":
      return "contact_extraction";
    case "ai/extract-policy":
      return "policy_extraction";
    case "ai/enrich-asset":
      return "asset_enrichment";
    case "ai/property-imagery":
      return "property_imagery";
    case "ai/document-map":
      return "document_mapping";
    case "ai/acord-map":
      return "acord_mapping";
    case "ai/parse-carrier-appetite":
      return "carrier_appetite_parse";
    case "ai/draft-campaign":
      return "campaign_draft";
    case "ai/marketing-creative":
      return "marketing_creative";
    case "ai/draft-pamphlet":
      return "pamphlet_draft";
    case "ai/portal-assistant":
      return "portal_assistant";
    case "ai/sort-intent":
      return "sort_intent";
    default:
      return "unknown";
  }
}

export async function runGovernedAiJob<T>(
  input: AiResourceJobInput,
  runner: () => Promise<T>
): Promise<T> {
  const policy = policyFor(input);
  const startedAtMs = Date.now();
  const payloadText = stableStringify(input.payload);
  const payloadHash = hashString(payloadText);
  const payloadBytes = byteLength(payloadText);
  const tenantId = input.tenantId || tenantFromPayload(input.payload) || "local-demo";
  const cacheKey = `${tenantId}:${input.feature}:${input.operation}:${payloadHash}`;

  if (payloadBytes > policy.maxPayloadBytes) {
    recordEvent(input, policy, {
      tenantId,
      payloadHash,
      payloadBytes,
      status: "blocked",
      startedAtMs,
      reason: "payload_too_large",
    });
    throw new AiResourceGovernorError(
      "payload_too_large",
      `AI payload for ${input.feature} is ${payloadBytes} bytes, above the ${policy.maxPayloadBytes} byte limit.`
    );
  }

  if (!input.forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      recordEvent(input, policy, {
        tenantId,
        payloadHash,
        payloadBytes,
        status: "cache_hit",
        startedAtMs,
      });
      return cached.value as T;
    }
    if (cached) cache.delete(cacheKey);

    if (policy.dedupe && inFlight.has(cacheKey)) {
      recordEvent(input, policy, {
        tenantId,
        payloadHash,
        payloadBytes,
        status: "deduped",
        startedAtMs,
      });
      return (await inFlight.get(cacheKey)) as T;
    }
  }

  if (!reserveQuota(tenantId, input.feature, policy.maxPerMinute)) {
    recordEvent(input, policy, {
      tenantId,
      payloadHash,
      payloadBytes,
      status: "blocked",
      startedAtMs,
      reason: "quota_exceeded",
    });
    throw new AiResourceGovernorError(
      "quota_exceeded",
      `AI quota exceeded for ${input.feature}. Try again after the current minute window resets.`
    );
  }

  const promise = (async () => {
    try {
      const value = await runner();
      if (policy.cacheTtlMs > 0 && value !== null && value !== undefined) {
        cache.set(cacheKey, { value, expiresAt: Date.now() + policy.cacheTtlMs });
      }
      recordEvent(input, policy, {
        tenantId,
        payloadHash,
        payloadBytes,
        status: "success",
        startedAtMs,
      });
      return value;
    } catch (error) {
      recordEvent(input, policy, {
        tenantId,
        payloadHash,
        payloadBytes,
        status: error instanceof AiResourceGovernorError ? "blocked" : "error",
        startedAtMs,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      throw error;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  if (policy.dedupe) inFlight.set(cacheKey, promise);
  return promise;
}

export function getAiResourceEvents(): AiResourceEvent[] {
  return [...events];
}

export function getAiResourceMetrics(): AiResourceMetrics {
  const base: AiResourceMetrics = {
    events: events.length,
    blocked: 0,
    cacheHits: 0,
    deduped: 0,
    errors: 0,
    estimatedUnitCost: 0,
    byFeature: {} as AiResourceMetrics["byFeature"],
  };
  for (const event of events) {
    const row =
      base.byFeature[event.feature] ??
      (base.byFeature[event.feature] = {
        events: 0,
        blocked: 0,
        cacheHits: 0,
        deduped: 0,
        estimatedUnitCost: 0,
      });
    row.events += 1;
    if (event.status === "blocked") {
      base.blocked += 1;
      row.blocked += 1;
    }
    if (event.status === "cache_hit") {
      base.cacheHits += 1;
      row.cacheHits += 1;
    }
    if (event.status === "deduped") {
      base.deduped += 1;
      row.deduped += 1;
    }
    if (event.status === "error") base.errors += 1;
    base.estimatedUnitCost += event.estimatedUnitCost;
    row.estimatedUnitCost += event.estimatedUnitCost;
  }
  return base;
}

export function resetAiResourceGovernor() {
  cache.clear();
  inFlight.clear();
  quotaWindows.clear();
  events.splice(0);
  eventCounter = 0;
}

function policyFor(input: AiResourceJobInput): AiResourcePolicy {
  return {
    ...DEFAULT_POLICY,
    ...(FEATURE_POLICIES[input.feature] ?? {}),
    ...(input.policy ?? {}),
  };
}

function reserveQuota(tenantId: string, feature: AiResourceFeature, maxPerMinute: number): boolean {
  const key = `${tenantId}:${feature}`;
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (quotaWindows.get(key) ?? []).filter((time) => time >= windowStart);
  if (recent.length >= maxPerMinute) {
    quotaWindows.set(key, recent);
    return false;
  }
  recent.push(now);
  quotaWindows.set(key, recent);
  return true;
}

function recordEvent(
  input: AiResourceJobInput,
  policy: AiResourcePolicy,
  details: {
    tenantId: string;
    payloadHash: string;
    payloadBytes: number;
    status: AiResourceEventStatus;
    startedAtMs: number;
    reason?: string;
  }
) {
  const estimatedUnitCost =
    details.status === "cache_hit" || details.status === "deduped" || details.status === "blocked"
      ? 0
      : policy.estimatedUnitCost;
  events.push({
    id: `ai_evt_${++eventCounter}`,
    feature: input.feature,
    operation: input.operation,
    tenantId: details.tenantId,
    userId: input.userId,
    payloadHash: details.payloadHash,
    payloadBytes: details.payloadBytes,
    status: details.status,
    cached: details.status === "cache_hit",
    deduped: details.status === "deduped",
    estimatedUnitCost,
    startedAt: new Date(details.startedAtMs).toISOString(),
    durationMs: Math.max(0, Date.now() - details.startedAtMs),
    reason: details.reason,
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function tenantFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = tenantFromPayload(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const direct = record.tenantId ?? record.agencyId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const value of Object.values(record)) {
    const found = tenantFromPayload(value);
    if (found) return found;
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function byteLength(value: string): number {
  if (typeof Blob !== "undefined") return new Blob([value]).size;
  return value.length;
}
