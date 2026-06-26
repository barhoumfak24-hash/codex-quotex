// =====================================================================
// Vercel Serverless Function — POST /api/smarty-validate
//
// Proxies the Smarty US Street API. The browser sends a freeform or
// structured address; we sign the call with SMARTY_AUTH_ID +
// SMARTY_AUTH_TOKEN (read from process.env) and return the validated,
// standardized address plus enrichment metadata (ZIP+4, lat/lon,
// county, time zone).
//
// Why a server function and not a direct browser call: the Auth
// Token is a SECRET credential. Smarty's terms forbid embedding it
// in client code, and the Vite client bundle has no safe way to
// hide it anyway. The browser uses Smarty's separate website key
// for autocomplete (browser-safe with domain whitelist); only this
// endpoint sees the secret key.
//
// Caching: an in-memory LRU keeps repeated identical lookups inside
// one warm function instance to free, conserving the 250-lookup
// monthly tier. Vercel may spin up new instances at any time, so
// the cache is best-effort, not authoritative.
//
// Error handling:
//   400 → bad request payload (missing address field)
//   429 → upstream rate limit (cache the empty result for 60s)
//   500 → unexpected failure (logged, returned without leaking
//         the credential or stack trace)
// =====================================================================

import { applyRateLimit } from "./_rateLimit.js";

const SMARTY_US_STREET_BASE = "https://us-street.api.smarty.com/street-address";

interface SmartyCandidate {
  delivery_line_1?: string;
  delivery_line_2?: string;
  components?: {
    primary_number?: string;
    street_name?: string;
    street_suffix?: string;
    street_predirection?: string;
    street_postdirection?: string;
    secondary_designator?: string;
    secondary_number?: string;
    city_name?: string;
    state_abbreviation?: string;
    zipcode?: string;
    plus4_code?: string;
  };
  metadata?: {
    county_name?: string;
    latitude?: number;
    longitude?: number;
    time_zone?: string;
    utc_offset?: number;
    dst?: boolean;
    record_type?: string;
    rdi?: string; // "Residential" | "Commercial"
    congressional_district?: string;
    elot_sequence?: string;
    coordinate_license?: number;
  };
  analysis?: {
    dpv_match_code?: string; // "Y" deliverable, "S" missing secondary, "D" missing prim#, "N" not deliverable
    dpv_footnotes?: string;
    active?: string;
    vacant?: string;
  };
}

export interface SmartyValidateResponse {
  deliverable: boolean;
  dpvCode: string | null;
  standardized: {
    street: string;
    apt: string;
    city: string;
    state: string;
    zip: string;
    zip4: string;
  };
  lat: number | null;
  lon: number | null;
  county: string | null;
  timezone: string | null;
  rdi: string | null;
  composed: string;
  cached: boolean;
}

interface RequestPayload {
  // Either provide a freeform string OR structured pieces. The
  // function picks whichever is more specific.
  freeform?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  candidates?: number; // 1-10, default 5
}

const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — same address validates the same way for a long time
const RATE_LIMIT_TTL_MS = 60 * 1000;

interface CacheEntry {
  value: SmartyValidateResponse | null;
  expiresAt: number;
}

// Module-scoped LRU — survives across requests on the same warm
// invocation, evaporates when the function cold-starts.
const cache = new Map<string, CacheEntry>();

function cacheKey(p: RequestPayload): string {
  const f = (p.freeform ?? "").trim().toLowerCase();
  if (f) return `f:${f}`;
  return `s:${(p.street ?? "").toLowerCase().trim()}|${(p.city ?? "").toLowerCase().trim()}|${(p.state ?? "").toLowerCase().trim()}|${(p.zip ?? "").toLowerCase().trim()}`;
}

function cacheGet(key: string): SmartyValidateResponse | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cacheSet(key: string, value: SmartyValidateResponse | null, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function parseCandidate(c: SmartyCandidate): SmartyValidateResponse {
  const comp = c.components ?? {};
  const meta = c.metadata ?? {};
  const street = c.delivery_line_1 ?? "";
  const apt = c.delivery_line_2 ?? "";
  const city = comp.city_name ?? "";
  const state = comp.state_abbreviation ?? "";
  const zip = comp.zipcode ?? "";
  const zip4 = comp.plus4_code ?? "";
  const fullZip = zip4 ? `${zip}-${zip4}` : zip;
  const composed = [
    [street, apt].filter(Boolean).join(" "),
    city,
    [state, fullZip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    deliverable: c.analysis?.dpv_match_code === "Y",
    dpvCode: c.analysis?.dpv_match_code ?? null,
    standardized: { street, apt, city, state, zip, zip4 },
    lat: typeof meta.latitude === "number" ? meta.latitude : null,
    lon: typeof meta.longitude === "number" ? meta.longitude : null,
    county: meta.county_name ?? null,
    timezone: meta.time_zone ?? null,
    rdi: meta.rdi ?? null,
    composed,
    cached: false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!(await applyRateLimit(req, res, "smarty-validate", { windowMs: 60_000, limit: 60 }))) return;

  const authId = process.env.SMARTY_AUTH_ID;
  const authToken = process.env.SMARTY_AUTH_TOKEN;
  if (!authId || !authToken) {
    // eslint-disable-next-line no-console
    console.error("[smarty-validate] missing SMARTY_AUTH_ID/SMARTY_AUTH_TOKEN in env");
    res
      .status(500)
      .json({ error: "smarty_not_configured", message: "Address validation is offline." });
    return;
  }

  // Vercel parses JSON bodies automatically when content-type is set.
  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const hasFreeform = typeof body.freeform === "string" && body.freeform.trim().length > 0;
  const hasStructured =
    !!(body.street && (body.city || body.zip)) || !!(body.zip && body.street);
  if (!hasFreeform && !hasStructured) {
    res.status(400).json({ error: "missing_address" });
    return;
  }

  const key = cacheKey(body);
  const cached = cacheGet(key);
  if (cached !== undefined) {
    if (cached === null) {
      res.status(200).json({ result: null, cached: true });
    } else {
      res.status(200).json({ result: { ...cached, cached: true } });
    }
    return;
  }

  const url = new URL(SMARTY_US_STREET_BASE);
  url.searchParams.set("auth-id", authId);
  url.searchParams.set("auth-token", authToken);
  url.searchParams.set("license", "us-core-cloud");
  url.searchParams.set("match", "strict");
  const candidates = Math.max(1, Math.min(10, body.candidates ?? 5));
  url.searchParams.set("candidates", String(candidates));
  if (body.freeform) {
    url.searchParams.set("street", body.freeform.trim());
  } else {
    if (body.street) url.searchParams.set("street", body.street.trim());
    if (body.city) url.searchParams.set("city", body.city.trim());
    if (body.state) url.searchParams.set("state", body.state.trim());
    if (body.zip) url.searchParams.set("zipcode", body.zip.trim());
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[smarty-validate] upstream fetch failed", err);
    res.status(502).json({ error: "smarty_unreachable" });
    return;
  }

  if (upstream.status === 429) {
    // Cache "no result" briefly so the client can back off without
    // pummelling Smarty during a quota burst.
    cacheSet(key, null, RATE_LIMIT_TTL_MS);
    res.status(429).json({ error: "smarty_rate_limited" });
    return;
  }

  if (!upstream.ok) {
    // eslint-disable-next-line no-console
    console.error("[smarty-validate] upstream HTTP", upstream.status);
    res.status(502).json({ error: "smarty_upstream_error", status: upstream.status });
    return;
  }

  let candidatesJson: SmartyCandidate[];
  try {
    candidatesJson = (await upstream.json()) as SmartyCandidate[];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[smarty-validate] failed to parse Smarty JSON", err);
    res.status(502).json({ error: "smarty_bad_response" });
    return;
  }

  if (!Array.isArray(candidatesJson) || candidatesJson.length === 0) {
    cacheSet(key, null, CACHE_TTL_MS);
    res.status(200).json({ result: null });
    return;
  }

  const parsed = parseCandidate(candidatesJson[0]);
  cacheSet(key, parsed, CACHE_TTL_MS);
  res.status(200).json({ result: parsed });
}

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}

// Exported for unit tests — clears the in-memory cache between cases.
export function __resetCacheForTest() {
  cache.clear();
}

// Exported so tests can construct the URL the same way the handler
// does without poking at internals.
export const __SMARTY_US_STREET_BASE = SMARTY_US_STREET_BASE;
