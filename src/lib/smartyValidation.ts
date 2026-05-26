// =====================================================================
// Smarty US Street validation — browser helper.
//
// Calls our own /api/smarty-validate Vercel serverless function,
// which holds the Smarty Auth ID / Auth Token secret. Never embeds
// the secret in the browser bundle.
//
// Used during the property-records lookup flow: before geocoding,
// we run the user's address through Smarty so downstream services
// (FEMA NFHL, NHTSA, etc.) get a verified, standardized address
// plus high-quality lat/lon coordinates that are dramatically more
// accurate than Nominatim's centroid guesses on rural addresses.
//
// Local cache: sessionStorage keyed by the canonical-cased address
// string so the same address typed twice in one tab session doesn't
// double-count against the 250 free monthly Smarty calls.
//
// Failure modes — all return `null`, the caller falls back:
//   - The serverless function isn't deployed (e.g. local dev with
//     `vite` but no `vercel dev`).
//   - Smarty is unreachable (502 from our function).
//   - The address doesn't match any deliverable Smarty record.
//   - Smarty quota exhausted (429 from our function).
// =====================================================================

export interface SmartyValidatedAddress {
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
  rdi: string | null; // "Residential" | "Commercial"
  composed: string;
  cached: boolean;
}

interface RawResponse {
  result: SmartyValidatedAddress | null;
  cached?: boolean;
}

const CACHE_PREFIX = "quotex.smarty.validate.v1::";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  value: SmartyValidatedAddress | null;
  expiresAt: number;
}

function readCache(key: string): SmartyValidatedAddress | null | undefined {
  if (typeof window === "undefined" || !window.sessionStorage) return undefined;
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(CACHE_PREFIX + key);
      return undefined;
    }
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: SmartyValidatedAddress | null) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const entry: CacheEntry = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage quota exceeded — silently drop, the request still works.
  }
}

function normalizeKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

// Validate a freeform US address (e.g. "901 McDonald Drive,
// Northville, MI 48167") against Smarty US Street API via our
// serverless proxy. Returns `null` on any non-success state so the
// caller can fall back to the previous Google-Geocoding-only path.
export async function validateAddress(
  address: string,
  signal?: AbortSignal
): Promise<SmartyValidatedAddress | null> {
  const freeform = address.trim();
  if (!freeform) return null;
  const key = normalizeKey(freeform);

  const cached = readCache(key);
  if (cached !== undefined) {
    // Re-flag as cached so downstream logging stays honest.
    if (cached) return { ...cached, cached: true };
    return null;
  }

  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  let res: Response;
  try {
    res = await fetch("/api/smarty-validate", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ freeform }),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[smartyValidation] fetch failed", err);
    return null;
  }

  if (res.status === 404) {
    // No serverless function deployed — likely local `vite` without
    // `vercel dev`. Don't spam console with errors, just fall back.
    return null;
  }

  if (res.status === 429) {
    // eslint-disable-next-line no-console
    console.warn("[smartyValidation] rate limited by Smarty (429)");
    return null;
  }

  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[smartyValidation] proxy returned HTTP ${res.status}`);
    return null;
  }

  let data: RawResponse;
  try {
    data = (await res.json()) as RawResponse;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[smartyValidation] proxy returned non-JSON", err);
    return null;
  }

  if (!data.result) {
    // Smarty returned zero candidates — the address isn't in their
    // database. Cache the empty result so we don't re-ask on every
    // keystroke (TTL 24h).
    writeCache(key, null);
    if (typeof performance !== "undefined") {
      const ms = Math.round(performance.now() - t0);
      // eslint-disable-next-line no-console
      console.info(`[smartyValidation] no candidates for "${freeform}" (${ms}ms)`);
    }
    return null;
  }

  writeCache(key, data.result);
  if (typeof performance !== "undefined") {
    const ms = Math.round(performance.now() - t0);
    // eslint-disable-next-line no-console
    console.info(
      `[smartyValidation] validated "${freeform}" → DPV ${data.result.dpvCode ?? "?"} (${ms}ms)`,
      data.result
    );
  }
  return data.result;
}

// Exported for tests so a fresh case isn't polluted by a previous
// sessionStorage write.
export function _clearSmartyValidationCache() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  const keys: string[] = [];
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const k = window.sessionStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => window.sessionStorage.removeItem(k));
}