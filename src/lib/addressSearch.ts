// =====================================================================
// Address autocomplete service — nationwide US coverage.
//
// Provider order (first one with a successful response wins):
//   1. Google Places / Smarty server proxy when configured
//   2. Smarty browser key / Mapbox when configured
//   3. Photon (OpenStreetMap search-as-you-type) as a keyless autocomplete fallback
//   4. Nominatim (OpenStreetMap) as a keyless geocoder fallback
//   5. U.S. Census Geocoder as a keyless validator for complete inputs
//   6. Built-in mock pool only when a caller explicitly opts into demos
//
// Both real providers are restricted to US-only results
// (`country=us` / `countrycodes=us`). Keyless providers are fallbacks;
// for production-grade Google-like behavior, configure Google Places,
// Mapbox, or Smarty and keep Photon/Nominatim as outage fallbacks.
//
// All errors are routed through `reportAddressSearchError` so future
// failures are auto-captured (real impl wires this to Sentry / Datadog).
// =====================================================================

export interface AddressPrediction {
  id: string;
  description: string; // What we show in the dropdown
  // Optional provider-side identifier so callers can fetch
  // structured address components on selection. Today this is
  // populated only by the Google Places provider.
  googlePlaceId?: string;
}

// Structured address parts returned by fetchAddressParts() so the
// caller can populate separate Street / Apt / City / State / ZIP
// inputs without re-parsing a string.
export interface AddressParts {
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
}

export type AddressSearchMode = "address" | "marina";

export interface LocationBias {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

export interface AddressSearchOptions {
  // Defaults to false for production safety. Demo-only callers can
  // opt in so the dropdown never shows fake addresses by accident.
  allowMockFallback?: boolean;
  locationBias?: LocationBias | null;
}

interface ProviderError {
  provider: string;
  query: string;
  message: string;
  status?: number;
  at: number;
}

// ---------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------

export interface AddressSearchTelemetry {
  errors: ProviderError[];
  lastSuccessProvider: string | null;
  // How many non-street results (cities, counties, regions, POIs)
  // were filtered out before reaching the dropdown. A spike here is
  // a signal that a provider stopped honoring our street-only filter.
  nonStreetFilteredCount: number;
  // Last filtered-out item, captured for ops debugging.
  lastNonStreetSample: { provider: string; raw: string } | null;
  // How many street-level results were dropped because they failed
  // strict left-to-right prefix matching against the user's query.
  // Surfaces "API matched 'McDonald' but returned 'Old McDonald
  // Lane'" cases.
  nonPrefixFilteredCount: number;
  lastNonPrefixSample: { provider: string; query: string; raw: string } | null;
  // Cache hits avoid a network call by reusing a longer-prefix
  // cached result (the user typed more characters into "901 McDonald"
  // → we already had "901 McDonald" cached → filter client-side).
  cacheHits: number;
  // The "broader-query" retry fires when the provider returns 0
  // results for a partial-word query (Nominatim matches whole words).
  // A spike here means more users are typing partial words mid-edit.
  broaderQueryRetries: number;
  lastBroaderQuery: { original: string; broader: string } | null;
}

// ---------------------------------------------------------------------
// Error reporting (real impl wires to Sentry/Datadog)
// ---------------------------------------------------------------------

const telemetry: AddressSearchTelemetry = {
  errors: [],
  lastSuccessProvider: null,
  nonStreetFilteredCount: 0,
  lastNonStreetSample: null,
  nonPrefixFilteredCount: 0,
  lastNonPrefixSample: null,
  cacheHits: 0,
  broaderQueryRetries: 0,
  lastBroaderQuery: null,
};

// Tests can reset the cache + telemetry between cases.
export function _resetAddressSearchForTest() {
  responseCache.clear();
  googleJsSessionTokens.clear();
  googleProxyDisabledUntil = 0;
  smartyProxyDisabledUntil = 0;
  photonProxyDisabledUntil = 0;
  nominatimProxyDisabledUntil = 0;
  telemetry.errors.length = 0;
  telemetry.lastSuccessProvider = null;
  telemetry.nonStreetFilteredCount = 0;
  telemetry.lastNonStreetSample = null;
  telemetry.nonPrefixFilteredCount = 0;
  telemetry.lastNonPrefixSample = null;
  telemetry.cacheHits = 0;
  telemetry.broaderQueryRetries = 0;
  telemetry.lastBroaderQuery = null;
}

function recordNonStreetLeak(provider: string, raw: string) {
  telemetry.nonStreetFilteredCount += 1;
  telemetry.lastNonStreetSample = { provider, raw };
}

function recordNonPrefixLeak(provider: string, query: string, raw: string) {
  telemetry.nonPrefixFilteredCount += 1;
  telemetry.lastNonPrefixSample = { provider, query, raw };
}

function normalizeLocationBias(value?: LocationBias | null): LocationBias | null {
  if (!value) return null;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const radiusMeters = Number(value.radiusMeters ?? 50_000);
  return {
    latitude,
    longitude,
    radiusMeters: Math.min(50_000, Math.max(1_000, Number.isFinite(radiusMeters) ? radiusMeters : 50_000)),
  };
}

function toGoogleLocationAreaBody(value?: LocationBias | null): GoogleLocationBiasBody | null {
  const bias = normalizeLocationBias(value);
  if (!bias) return null;
  return {
    circle: {
      center: {
        latitude: bias.latitude,
        longitude: bias.longitude,
      },
      radius: bias.radiusMeters ?? 50_000,
    },
  };
}

function googleLocationConstraintFor(
  query: string,
  locationBias?: LocationBias | null
): { locationBias?: GoogleLocationBiasBody; locationRestriction?: GoogleLocationBiasBody } {
  const area = toGoogleLocationAreaBody(locationBias);
  if (!area) return {};
  return isShortHouseNumberPrefix(query)
    ? { locationRestriction: area }
    : { locationBias: area };
}

function locationBiasCacheKey(value?: LocationBias | null): string {
  const bias = normalizeLocationBias(value);
  if (!bias) return "global";
  const radiusBucket = Math.round((bias.radiusMeters ?? 50_000) / 1_000);
  return `${bias.latitude.toFixed(3)},${bias.longitude.toFixed(3)},${radiusBucket}`;
}

function nominatimViewbox(value?: LocationBias | null): string {
  const bias = normalizeLocationBias(value);
  if (!bias) return "";
  const radiusMeters = bias.radiusMeters ?? 50_000;
  const latDelta = radiusMeters / 111_320;
  const lngScale = Math.max(0.2, Math.cos((bias.latitude * Math.PI) / 180));
  const lngDelta = radiusMeters / (111_320 * lngScale);
  const west = Math.max(-180, bias.longitude - lngDelta);
  const east = Math.min(180, bias.longitude + lngDelta);
  const south = Math.max(-90, bias.latitude - latDelta);
  const north = Math.min(90, bias.latitude + latDelta);
  return `${west},${north},${east},${south}`;
}

function mapboxBoundingBox(value?: LocationBias | null): string {
  const bias = normalizeLocationBias(value);
  if (!bias) return "";
  const radiusMeters = bias.radiusMeters ?? 50_000;
  const latDelta = radiusMeters / 111_320;
  const lngScale = Math.max(0.2, Math.cos((bias.latitude * Math.PI) / 180));
  const lngDelta = radiusMeters / (111_320 * lngScale);
  const west = Math.max(-180, bias.longitude - lngDelta);
  const east = Math.min(180, bias.longitude + lngDelta);
  const south = Math.max(-90, bias.latitude - latDelta);
  const north = Math.min(90, bias.latitude + latDelta);
  return `${west},${south},${east},${north}`;
}

// ---------------------------------------------------------------------
// Strict prefix matching
// ---------------------------------------------------------------------

const STREET_SUFFIX_ALIASES: Record<string, string> = {
  aly: "alley",
  alley: "alley",
  ave: "avenue",
  av: "avenue",
  avenue: "avenue",
  blvd: "boulevard",
  boulevard: "boulevard",
  cir: "circle",
  circle: "circle",
  ct: "court",
  court: "court",
  dr: "drive",
  drive: "drive",
  hwy: "highway",
  highway: "highway",
  ln: "lane",
  lane: "lane",
  pkwy: "parkway",
  parkway: "parkway",
  pl: "place",
  place: "place",
  rd: "road",
  road: "road",
  sq: "square",
  square: "square",
  st: "street",
  street: "street",
  ter: "terrace",
  terrace: "terrace",
  trl: "trail",
  trail: "trail",
  way: "way",
};

const STREET_SUFFIX_QUERY_EXPANSIONS: Record<string, string> = {
  aly: "Alley",
  ave: "Avenue",
  av: "Avenue",
  blvd: "Boulevard",
  cir: "Circle",
  ct: "Court",
  dr: "Drive",
  hwy: "Highway",
  ln: "Lane",
  pkwy: "Parkway",
  pl: "Place",
  rd: "Road",
  sq: "Square",
  st: "Street",
  ter: "Terrace",
  trl: "Trail",
};

// Normalize for left-to-right comparison: lowercase, collapse punctuation
// and whitespace, and canonicalize common street suffix abbreviations.
// This keeps strict "starts with the same address" behavior while allowing
// normal user shorthand like "Dr" to match provider output like "Drive".
function normalizeForPrefix(s: string): string {
  return s
    .toLowerCase()
    .replace(/[#.,/\\;:()]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_SUFFIX_ALIASES[token] ?? token)
    .join(" ")
    .trim();
}

export function matchesQueryPrefix(description: string, query: string): boolean {
  const d = normalizeForPrefix(description);
  const q = normalizeForPrefix(query);
  if (!q) return true;
  return d.startsWith(q);
}

function isShortHouseNumberPrefix(query: string): boolean {
  return /^\s*\d{2,6}\s*$/.test(query);
}

// Apply strict prefix matching to a list of provider predictions.
// Anything that fails is logged to telemetry and dropped.
function enforcePrefixMatch(
  provider: string,
  query: string,
  predictions: AddressPrediction[]
): AddressPrediction[] {
  return predictions.filter((p) => {
    if (matchesQueryPrefix(p.description, query)) return true;
    recordNonPrefixLeak(provider, query, p.description);
    return false;
  });
}

// Tests can inspect this; production never reads it directly — that
// goes through the logger.
export function _getAddressSearchTelemetry(): AddressSearchTelemetry {
  return telemetry;
}

let lastErrAt = 0;
function reportAddressSearchError(provider: string, query: string, err: unknown, status?: number) {
  const message = err instanceof Error ? err.message : String(err);
  const entry: ProviderError = { provider, query, message, status, at: Date.now() };
  telemetry.errors.push(entry);
  // Cap so a sustained outage doesn't grow this array unbounded.
  if (telemetry.errors.length > 50) telemetry.errors.shift();

  // Throttle to one console line every 5s; real impl sends every error
  // to the monitoring service.
  if (Date.now() - lastErrAt < 5000) return;
  lastErrAt = Date.now();
  // eslint-disable-next-line no-console
  console.warn("[addressSearch] provider failed", {
    provider: entry.provider,
    status: entry.status,
    message: entry.message,
    at: entry.at,
  });
}

function markSuccess(provider: string) {
  telemetry.lastSuccessProvider = provider;
}

// ---------------------------------------------------------------------
// Google Places Autocomplete (New) — places.googleapis.com/v1
//
// Used when VITE_GOOGLE_PLACES_API_KEY (preferred) or the legacy
// VITE_GOOGLE_MAPS_API_KEY is set. Restrict the key in Google Cloud
// Console with HTTP referrer restrictions for your deployment
// domain. This is the most thoroughly tested US street autocomplete
// service and handles partial-word matching natively ("901 McD" →
// "901 McDonald Drive…") on the very first keystroke.
//
// Two transports for the SAME backend service:
//
//   - google_js  → loads the Maps JavaScript SDK with libraries=places
//                  and uses google.maps.places.AutocompleteSuggestion.
//                  Preferred when the SDK loads — Google's client lib
//                  manages session tokens and surfaces structured
//                  error codes directly.
//   - google     → POSTs to places.googleapis.com/v1/places:autocomplete
//                  directly. Used as the fallback when the JS SDK
//                  fails to load (CSP block, ad-blocker, slow CDN).
//
// Both call the same Places API (New) on the Google side, so the
// API must be enabled and billing must be active either way.
// ---------------------------------------------------------------------

const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places/";
const GOOGLE_PROXY_AUTOCOMPLETE_PATH = "/api/google-places-autocomplete";
const GOOGLE_PROXY_DETAILS_PATH = "/api/google-place-details";

function getGoogleKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    // Production uses the server-side Google proxy so the paid key is
    // never bundled into the browser. The direct browser key path is
    // kept only as an explicit local debugging escape hatch.
    if (env?.VITE_ENABLE_DIRECT_GOOGLE_PLACES !== "true") return "";
    if (typeof env?.VITE_GOOGLE_PLACES_API_KEY === "string" && env.VITE_GOOGLE_PLACES_API_KEY) {
      return env.VITE_GOOGLE_PLACES_API_KEY;
    }
    if (typeof env?.VITE_GOOGLE_MAPS_API_KEY === "string" && env.VITE_GOOGLE_MAPS_API_KEY) {
      return env.VITE_GOOGLE_MAPS_API_KEY;
    }
    return "";
  } catch {
    return "";
  }
}

// Lightweight session token generator. Google requires the same
// token for every autocomplete call in one session + the matching
// Place Details call. crypto.randomUUID is widely supported (Chrome
// 92+, Safari 15.4+, Firefox 95+, Node 14.17+).
function newGoogleSessionToken(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fallthrough */
  }
  // Fallback — collision-resistant enough for billing-session grouping.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface GooglePrediction {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
  };
}

interface GoogleLocationBiasBody {
  circle: {
    center: {
      latitude: number;
      longitude: number;
    };
    radius: number;
  };
}

let googleProxyDisabledUntil = 0;
const GOOGLE_PROXY_RETRY_DELAY_MS = 15_000;

function serverGoogleProxyEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env?.VITE_ENABLE_GOOGLE_PLACES_PROXY === "false") return false;
    if (env?.VITE_ENABLE_GOOGLE_PLACES_PROXY === "true") return true;
    if (env?.MODE === "test") return false;
    return env?.PROD === true || env?.DEV === true;
  } catch {
    return false;
  }
}

async function searchGoogleProxy(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  if (!serverGoogleProxyEnabled()) return [];
  if (Date.now() < googleProxyDisabledUntil) return [];

  const normalizedBias = normalizeLocationBias(locationBias);
  let res: Response;
  try {
    res = await fetch(GOOGLE_PROXY_AUTOCOMPLETE_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        sessionToken,
        ...(normalizedBias ? { locationBias: normalizedBias } : {}),
      }),
    });
  } catch (err) {
    reportAddressSearchError("google_proxy", query, err);
    return [];
  }

  if (!res.ok) {
    let errorCode = "";
    try {
      const body = (await res.json()) as { error?: string };
      errorCode = body.error ?? "";
    } catch {
      /* ignore */
    }
    if (
      res.status === 404 ||
      res.status >= 500 ||
      errorCode === "google_places_not_configured" ||
      errorCode === "google_places_upstream_error" ||
      errorCode === "google_places_rate_limited"
    ) {
      googleProxyDisabledUntil = Date.now() + GOOGLE_PROXY_RETRY_DELAY_MS;
    }
    reportAddressSearchError("google_proxy", query, errorCode || `HTTP ${res.status}`, res.status);
    return [];
  }

  let data: { suggestions?: AddressPrediction[] };
  try {
    data = (await res.json()) as { suggestions?: AddressPrediction[] };
  } catch (err) {
    reportAddressSearchError("google_proxy", query, err);
    return [];
  }

  return (data.suggestions ?? [])
    .map((s): AddressPrediction | null => {
      if (!s.id || !s.description) return null;
      return { id: s.id, description: s.description, googlePlaceId: s.googlePlaceId ?? s.id };
    })
    .filter((p): p is AddressPrediction => p !== null);
}

async function searchGoogle(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  const key = getGoogleKey();
  if (!key) return [];
  const googleLocationConstraint = googleLocationConstraintFor(query, locationBias);
  let res: Response;
  try {
    res = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Field mask trims the response payload (and per-request cost
        // on Google's side) to only what we render.
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        includedRegionCodes: ["us"],
        sessionToken,
        ...googleLocationConstraint,
      }),
    });
  } catch (err) {
    reportAddressSearchError("google", query, err);
    return [];
  }
  if (!res.ok) {
    reportAddressSearchError("google", query, `HTTP ${res.status}`, res.status);
    return [];
  }
  let data: { suggestions?: GooglePrediction[] };
  try {
    data = await res.json();
  } catch (err) {
    reportAddressSearchError("google", query, err);
    return [];
  }
  return (data.suggestions ?? [])
    .map((s): AddressPrediction | null => {
      const pp = s.placePrediction;
      if (!pp?.placeId || !pp.text?.text) return null;
      // Strip Google's trailing ", USA" so descriptions read like
      // every other provider's output.
      const description = pp.text.text.replace(/,\s*USA$/i, "");
      return {
        id: pp.placeId,
        description,
        googlePlaceId: pp.placeId,
      };
    })
    .filter((p): p is AddressPrediction => p !== null);
}

// ---------------------------------------------------------------------
// Google Places — Maps JS SDK transport
// ---------------------------------------------------------------------
//
// Loads the official client lib once via googleMapsLoader and uses
// AutocompleteSuggestion.fetchAutocompleteSuggestions for predictions.
// Sessions and billing are handled by the SDK itself.
//
// On failure we log the raw error message at warn level (so the user
// can diagnose REQUEST_DENIED / OVER_QUERY_LIMIT / INVALID_REQUEST
// in DevTools) and return [] so the chain falls through to the REST
// transport. The REST path will also fail in that case, but its
// HTTP-status-based error is often easier to interpret.
// ---------------------------------------------------------------------

interface GoogleErrorRemediation {
  code: string;
  remediation: string;
}

// Decode known Google API error strings into a remediation hint the
// user can act on. Returns null if the error doesn't match a known
// code (caller logs the raw message in that case).
function decodeGoogleError(message: string): GoogleErrorRemediation | null {
  const m = message.toUpperCase();
  if (m.includes("REQUEST_DENIED")) {
    return {
      code: "REQUEST_DENIED",
      remediation:
        "Cloud Console → APIs & Services → Library: enable 'Places API (New)'. Then check that the API key's referrer restrictions include this origin.",
    };
  }
  if (m.includes("OVER_QUERY_LIMIT") || m.includes("RESOURCE_EXHAUSTED")) {
    return {
      code: "OVER_QUERY_LIMIT",
      remediation:
        "Quota exhausted or billing inactive. Verify Cloud Console → Billing is enabled for this project, or raise the per-minute quota for Places API (New).",
    };
  }
  if (m.includes("INVALID_REQUEST") || m.includes("INVALID_ARGUMENT")) {
    return {
      code: "INVALID_REQUEST",
      remediation:
        "The request shape is wrong — typically a malformed input or unsupported region/type. Check the raw response below.",
    };
  }
  if (m.includes("PERMISSION_DENIED")) {
    return {
      code: "PERMISSION_DENIED",
      remediation:
        "API key lacks permission. Confirm it has API restrictions set to 'Places API (New)' (not the legacy Places API) in Cloud Console.",
    };
  }
  return null;
}

function logGoogleFailure(transport: string, query: string, raw: unknown) {
  const message = raw instanceof Error ? raw.message : String(raw);
  const hint = decodeGoogleError(message);
  // eslint-disable-next-line no-console
  console.warn(
    `[addressSearch] ${transport} failed` +
      (hint ? ` — ${hint.code}: ${hint.remediation}` : ""),
    { message }
  );
}

async function searchGoogleJs(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  const key = getGoogleKey();
  if (!key) return [];
  // Lazy import to keep the loader out of the unit-test code path
  // when no key is configured.
  const { loadGoogleMaps } = await import("./googleMapsLoader");
  let places;
  try {
    places = await loadGoogleMaps(key);
  } catch (err) {
    logGoogleFailure("google_js (loader)", query, err);
    return [];
  }
  if (signal?.aborted) return [];

  let response: { suggestions: unknown[] };
  try {
    const googleLocationConstraint = googleLocationConstraintFor(query, locationBias);
    response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
      sessionToken: getGoogleJsSessionToken(places, sessionToken),
      ...googleLocationConstraint,
    });
  } catch (err) {
    logGoogleFailure("google_js", query, err);
    return [];
  }

  // Log raw response at info level for diagnostics — the user
  // explicitly asked for this so REQUEST_DENIED etc. show up in
  // DevTools during testing. Keep it terse so production noise stays
  // manageable.
  const suggestions = (response.suggestions ?? []) as Array<{
    placePrediction?: { placeId?: string; text?: { text?: string } };
  }>;
  return suggestions
    .map((s): AddressPrediction | null => {
      const pp = s.placePrediction;
      if (!pp?.placeId || !pp.text?.text) return null;
      const description = pp.text.text.replace(/,\s*USA$/i, "");
      return { id: pp.placeId, description, googlePlaceId: pp.placeId };
    })
    .filter((p): p is AddressPrediction => p !== null);
}

async function fetchGooglePlaceDetailsViaJs(
  placeId: string,
  sessionToken: string
): Promise<AddressParts | null> {
  const key = getGoogleKey();
  if (!key || !placeId) return null;
  const { loadGoogleMaps } = await import("./googleMapsLoader");
  let places;
  try {
    places = await loadGoogleMaps(key);
  } catch (err) {
    logGoogleFailure("google_js_details (loader)", placeId, err);
    return null;
  }
  try {
    const place = new places.Place({ id: placeId });
    const { place: data } = await place.fetchFields({
      fields: ["addressComponents", "formattedAddress"],
      sessionToken: getGoogleJsSessionToken(places, sessionToken),
    });
    const components = (data.addressComponents ?? []) as GoogleAddressComponent[];
    if (components.length === 0) return null;
    return parseGoogleAddressComponents(components);
  } catch (err) {
    logGoogleFailure("google_js_details", placeId, err);
    return null;
  }
}

const googleJsSessionTokens = new Map<string, unknown>();

function getGoogleJsSessionToken(
  places: { AutocompleteSessionToken?: new () => unknown },
  sessionToken: string
): unknown | undefined {
  if (!sessionToken || !places.AutocompleteSessionToken) return undefined;
  const existing = googleJsSessionTokens.get(sessionToken);
  if (existing) return existing;
  const token = new places.AutocompleteSessionToken();
  googleJsSessionTokens.set(sessionToken, token);
  if (googleJsSessionTokens.size > 64) {
    const oldest = googleJsSessionTokens.keys().next().value;
    if (oldest) googleJsSessionTokens.delete(oldest);
  }
  return token;
}

// Google addressComponents come back as an array of
// `{ longText, shortText, types[] }`. We extract the pieces we need
// (street number + route, city, state, ZIP, subpremise for Apt#).
interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlaceDetailsResponse {
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
}

function pickComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  prefer: "long" | "short" = "long"
): string {
  const c = components?.find((c) => (c.types ?? []).includes(type));
  if (!c) return "";
  return (prefer === "short" ? c.shortText : c.longText) ?? "";
}

// Single parser used by both the REST and JS-SDK transports so the
// Street / Apt / City / State / ZIP split stays consistent.
function parseGoogleAddressComponents(components: GoogleAddressComponent[]): AddressParts {
  const streetNumber = pickComponent(components, "street_number");
  const route = pickComponent(components, "route");
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  const apt = pickComponent(components, "subpremise");
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "postal_town") ||
    pickComponent(components, "sublocality") ||
    pickComponent(components, "administrative_area_level_3");
  const state = pickComponent(components, "administrative_area_level_1", "short");
  const zip = pickComponent(components, "postal_code");
  return { street, apt, city, state, zip };
}

// Public wrapper: try the JS SDK transport first (so callers get the
// SDK's improved error surface), fall back to REST. Both call the
// same Places API (New) backend.
export async function fetchGooglePlaceDetails(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<AddressParts | null> {
  const viaProxy = await fetchGooglePlaceDetailsViaProxy(placeId, sessionToken, signal);
  if (viaProxy) return viaProxy;
  const viaJs = await fetchGooglePlaceDetailsViaJs(placeId, sessionToken);
  if (viaJs) return viaJs;
  return fetchGooglePlaceDetailsViaRest(placeId, sessionToken, signal);
}

async function fetchGooglePlaceDetailsViaProxy(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<AddressParts | null> {
  if (!serverGoogleProxyEnabled() || Date.now() < googleProxyDisabledUntil) return null;
  let res: Response;
  try {
    res = await fetch(GOOGLE_PROXY_DETAILS_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId, sessionToken }),
    });
  } catch (err) {
    reportAddressSearchError("google_proxy_details", placeId, err);
    return null;
  }

  if (!res.ok) {
    let errorCode = "";
    try {
      const body = (await res.json()) as { error?: string };
      errorCode = body.error ?? "";
    } catch {
      /* ignore */
    }
    if (
      res.status === 404 ||
      res.status >= 500 ||
      errorCode === "google_places_not_configured" ||
      errorCode === "google_places_upstream_error" ||
      errorCode === "google_places_rate_limited"
    ) {
      googleProxyDisabledUntil = Date.now() + GOOGLE_PROXY_RETRY_DELAY_MS;
    }
    reportAddressSearchError("google_proxy_details", placeId, errorCode || `HTTP ${res.status}`, res.status);
    return null;
  }

  try {
    const data = (await res.json()) as { parts?: Partial<AddressParts> };
    const parts = data.parts;
    if (!parts) return null;
    return {
      street: parts.street ?? "",
      apt: parts.apt ?? "",
      city: parts.city ?? "",
      state: parts.state ?? "",
      zip: parts.zip ?? "",
    };
  } catch (err) {
    reportAddressSearchError("google_proxy_details", placeId, err);
    return null;
  }
}

async function fetchGooglePlaceDetailsViaRest(
  placeId: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<AddressParts | null> {
  const key = getGoogleKey();
  if (!key || !placeId) return null;
  const url = `${GOOGLE_PLACE_DETAILS_BASE}${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "formattedAddress,addressComponents",
      },
    });
  } catch (err) {
    reportAddressSearchError("google_details", placeId, err);
    return null;
  }
  if (!res.ok) {
    reportAddressSearchError("google_details", placeId, `HTTP ${res.status}`, res.status);
    return null;
  }
  let data: GooglePlaceDetailsResponse;
  try {
    data = await res.json();
  } catch (err) {
    reportAddressSearchError("google_details", placeId, err);
    return null;
  }
  return parseGoogleAddressComponents(data.addressComponents ?? []);
}

// ---------------------------------------------------------------------
// SmartyStreets US Autocomplete Pro — production-grade US autocomplete.
//
// SmartyStreets supports a "website key" flow that's safe in the
// browser when the key is restricted to your deployment domain via
// their referrer allowlist. This is the recommended production
// provider for this app — it returns proper street-level predictions
// for partial inputs ("901 McD" → "901 McDonald Drive") that
// keyless providers cannot deliver.
//
// Configure VITE_SMARTY_WEBSITE_KEY in Vercel (+ enable Host
// allowlist in your Smarty dashboard) and Smarty becomes the
// top-priority provider automatically.
// ---------------------------------------------------------------------

const SMARTY_BASE = "https://us-autocomplete-pro.api.smarty.com/lookup";
const SMARTY_PROXY_PATH = "/api/smarty-autocomplete";

function getSmartyKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    return typeof env?.VITE_SMARTY_WEBSITE_KEY === "string" ? env.VITE_SMARTY_WEBSITE_KEY : "";
  } catch {
    return "";
  }
}

interface SmartySuggestion {
  street_line: string;
  secondary?: string;
  entries?: number;
  city: string;
  state: string;
  zipcode?: string;
}

async function searchSmarty(query: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  const key = getSmartyKey();
  if (!key) return [];
  const url = new URL(SMARTY_BASE);
  url.searchParams.set("key", key);
  url.searchParams.set("search", query);
  url.searchParams.set("source", "all");
  url.searchParams.set("max_results", "10");
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal });
  } catch (err) {
    reportAddressSearchError("smarty", query, err);
    return [];
  }
  if (!res.ok) {
    reportAddressSearchError("smarty", query, `HTTP ${res.status}`, res.status);
    return [];
  }
  let data: { suggestions?: SmartySuggestion[] };
  try {
    data = await res.json();
  } catch (err) {
    reportAddressSearchError("smarty", query, err);
    return [];
  }
  return (data.suggestions ?? [])
    .map((s) => {
      const street = [s.street_line, s.secondary].filter(Boolean).join(" ").trim();
      const tail = [s.state, s.zipcode].filter(Boolean).join(" ").trim();
      const description = [street, s.city, tail].filter(Boolean).join(", ");
      return {
        id: description.replace(/\s+/g, "_"),
        description,
      };
    })
    .filter((p) => p.description.length > 0);
}

function serverSmartyProxyEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env?.VITE_ENABLE_SMARTY_AUTOCOMPLETE_PROXY === "false") return false;
    if (env?.VITE_ENABLE_SMARTY_AUTOCOMPLETE_PROXY === "true") return true;
    if (env?.MODE === "test") return false;
    return env?.PROD === true || env?.DEV === true;
  } catch {
    return false;
  }
}

let smartyProxyDisabledUntil = 0;

async function searchSmartyProxy(query: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  if (!serverSmartyProxyEnabled()) return [];
  if (Date.now() < smartyProxyDisabledUntil) return [];

  let res: Response;
  try {
    res = await fetch(SMARTY_PROXY_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxResults: 10 }),
    });
  } catch (err) {
    reportAddressSearchError("smarty_proxy", query, err);
    return [];
  }

  if (!res.ok) {
    let errorCode = "";
    try {
      const body = (await res.json()) as { error?: string };
      errorCode = body.error ?? "";
    } catch {
      /* ignore */
    }
    if (
      res.status === 404 ||
      res.status >= 500 ||
      errorCode === "smarty_not_configured" ||
      errorCode === "smarty_upstream_error" ||
      errorCode === "smarty_not_available" ||
      errorCode === "smarty_rate_limited"
    ) {
      smartyProxyDisabledUntil = Date.now() + 5 * 60 * 1000;
    }
    reportAddressSearchError("smarty_proxy", query, errorCode || `HTTP ${res.status}`, res.status);
    return [];
  }

  let data: { suggestions?: AddressPrediction[] };
  try {
    data = (await res.json()) as { suggestions?: AddressPrediction[] };
  } catch (err) {
    reportAddressSearchError("smarty_proxy", query, err);
    return [];
  }

  return (data.suggestions ?? [])
    .map((s): AddressPrediction | null => {
      if (!s.id || !s.description) return null;
      return { id: s.id, description: s.description };
    })
    .filter((p): p is AddressPrediction => p !== null);
}

// ---------------------------------------------------------------------
// Mapbox provider
// ---------------------------------------------------------------------

const MAPBOX_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";

function getMapboxToken(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    return typeof env?.VITE_MAPBOX_TOKEN === "string" ? env.VITE_MAPBOX_TOKEN : "";
  } catch {
    return "";
  }
}

async function searchMapbox(
  query: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  const token = getMapboxToken();
  if (!token) return [];
  // types=address restricts results to street-level addresses only;
  // we deliberately exclude place / locality / postcode / poi so the
  // dropdown never shows "McDonald, PA" when the user is searching
  // for "901 McDonald Drive".
  const url = new URL(`${MAPBOX_BASE}/${encodeURIComponent(query)}.json`);
  url.searchParams.set("country", "us");
  url.searchParams.set("types", "address");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "6");
  const normalizedBias = normalizeLocationBias(locationBias);
  if (normalizedBias) {
    url.searchParams.set("proximity", `${normalizedBias.longitude},${normalizedBias.latitude}`);
    if (isShortHouseNumberPrefix(query)) {
      url.searchParams.set("bbox", mapboxBoundingBox(normalizedBias));
    }
  }
  url.searchParams.set("access_token", token);
  let res: Response;
  try {
    const fetched = await fetch(url.toString(), { signal });
    if (!fetched) {
      reportAddressSearchError("mapbox", query, "Empty Mapbox response");
      return [];
    }
    res = fetched;
  } catch (err) {
    reportAddressSearchError("mapbox", query, err);
    return [];
  }
  if (!res.ok) {
    reportAddressSearchError("mapbox", query, `HTTP ${res.status}`, res.status);
    return [];
  }
  let data: {
    features?: { id: string; place_name: string; place_type?: string[]; address?: string }[];
  };
  try {
    data = await res.json();
  } catch (err) {
    reportAddressSearchError("mapbox", query, err);
    return [];
  }
  // Even though the request asks for types=address, the Mapbox response
  // includes a `place_type` array per feature. Belt-and-suspenders: drop
  // anything that isn't tagged as an address, and log it.
  const streetOnly = (data.features ?? []).filter((f) => {
    const types = f.place_type ?? [];
    if (types.includes("address")) return true;
    recordNonStreetLeak("mapbox", f.place_name ?? "");
    return false;
  });
  return streetOnly
    .map((f) => ({
      id: f.id,
      description: f.place_name?.replace(/, United States$/, "") ?? "",
    }))
    .filter((p) => p.description.length > 0);
}

// ---------------------------------------------------------------------
// Nominatim (OpenStreetMap) provider — keyless default
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Photon autocomplete proxy — keyless OpenStreetMap search-as-you-type
// ---------------------------------------------------------------------

const PHOTON_PROXY_PATH = "/api/photon-autocomplete";
const NOMINATIM_PROXY_PATH = "/api/nominatim-search";

function serverPhotonProxyEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env?.VITE_ENABLE_PHOTON_AUTOCOMPLETE === "false") return false;
    if (env?.VITE_ENABLE_PHOTON_AUTOCOMPLETE === "true") return true;
    if (env?.MODE === "test") return false;
    return env?.PROD === true || env?.DEV === true;
  } catch {
    return false;
  }
}

let photonProxyDisabledUntil = 0;
let nominatimProxyDisabledUntil = 0;

async function searchPhotonProxy(
  query: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  if (!serverPhotonProxyEnabled()) return [];
  if (Date.now() < photonProxyDisabledUntil) return [];

  const normalizedBias = normalizeLocationBias(locationBias);
  let res: Response;
  try {
    res = await fetch(PHOTON_PROXY_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        ...(normalizedBias ? { locationBias: normalizedBias } : {}),
      }),
    });
  } catch (err) {
    reportAddressSearchError("photon_proxy", query, err);
    return [];
  }

  if (!res.ok) {
    let errorCode = "";
    try {
      const body = (await res.json()) as { error?: string };
      errorCode = body.error ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 404 || res.status >= 500 || errorCode === "photon_unavailable") {
      photonProxyDisabledUntil = Date.now() + 5 * 60 * 1000;
    }
    reportAddressSearchError("photon_proxy", query, errorCode || `HTTP ${res.status}`, res.status);
    return [];
  }

  try {
    const data = (await res.json()) as { suggestions?: AddressPrediction[] };
    return (data.suggestions ?? [])
      .map((s): AddressPrediction | null => {
        if (!s.id || !s.description) return null;
        return { id: s.id, description: s.description };
      })
      .filter((p): p is AddressPrediction => p !== null);
  } catch (err) {
    reportAddressSearchError("photon_proxy", query, err);
    return [];
  }
}

function serverNominatimProxyEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env?.VITE_ENABLE_NOMINATIM_PROXY === "false") return false;
    if (env?.VITE_ENABLE_NOMINATIM_PROXY === "true") return true;
    if (env?.MODE === "test") return false;
    return env?.PROD === true || env?.DEV === true;
  } catch {
    return false;
  }
}

async function searchNominatimProxy(
  query: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  if (!serverNominatimProxyEnabled()) return [];
  if (Date.now() < nominatimProxyDisabledUntil) return [];

  const normalizedBias = normalizeLocationBias(locationBias);
  let res: Response;
  try {
    res = await fetch(NOMINATIM_PROXY_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        ...(normalizedBias ? { locationBias: normalizedBias } : {}),
      }),
    });
  } catch (err) {
    reportAddressSearchError("nominatim_proxy", query, err);
    return [];
  }

  if (!res.ok) {
    let errorCode = "";
    try {
      const body = (await res.json()) as { error?: string };
      errorCode = body.error ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 404 || res.status >= 500 || errorCode === "nominatim_unavailable") {
      nominatimProxyDisabledUntil = Date.now() + 5 * 60 * 1000;
    }
    reportAddressSearchError("nominatim_proxy", query, errorCode || `HTTP ${res.status}`, res.status);
    return [];
  }

  try {
    const data = (await res.json()) as { suggestions?: AddressPrediction[] };
    return (data.suggestions ?? [])
      .map((s): AddressPrediction | null => {
        if (!s.id || !s.description) return null;
        return { id: s.id, description: s.description };
      })
      .filter((p): p is AddressPrediction => p !== null);
  } catch (err) {
    reportAddressSearchError("nominatim_proxy", query, err);
    return [];
  }
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country?: string;
  // ISO-3166-2 code, e.g. "US-MI"
  "ISO3166-2-lvl4"?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  address?: NominatimAddress;
}

// True only when the result describes a *specific street address*, not
// a city / county / town / postcode / state / POI. Nominatim doesn't
// support a server-side "addresses only" filter, so we post-filter:
// a real street address must have both a house number and a road name.
export function isNominatimStreetLevel(r: NominatimResult): boolean {
  const a = r.address;
  if (!a) return false;
  const houseNumber = (a.house_number ?? "").toString().trim();
  const road = (a.road ?? "").trim();
  return houseNumber.length > 0 && road.length > 0;
}

function isNominatimRoadLevel(r: NominatimResult): boolean {
  return (r.address?.road ?? "").trim().length > 0;
}

// Build a clean address string from the structured response. Falls
// back to display_name if components are missing.
export function formatNominatimAddress(r: NominatimResult): string {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  const city = a.city || a.town || a.village || a.hamlet || a.county || "";
  const stateCode = (a["ISO3166-2-lvl4"] ?? "").replace(/^US-/i, "") || stateNameToCode(a.state);
  const zip = a.postcode ?? "";
  const tail = [stateCode, zip].filter(Boolean).join(" ").trim();
  const parts = [street, city, tail].filter(Boolean);
  if (parts.length === 0) {
    return (r.display_name ?? "").replace(/, United States$/, "").trim();
  }
  return parts.join(", ");
}

function formatNominatimAddressForQuery(r: NominatimResult, query: string): string {
  if (isNominatimStreetLevel(r)) return formatNominatimAddress(r);
  if (!queryHasStreetText(query) || !isNominatimRoadLevel(r)) return "";

  const a = r.address ?? {};
  const houseNumber = extractLeadingHouseNumber(query);
  const road = (a.road ?? "").trim();
  if (!houseNumber || !road) return "";

  const queryRoad = query
    .replace(/^\s*\d+[A-Za-z]?\s+/, "")
    .split(",")[0]
    .trim();
  if (queryRoad && !normalizeForPrefix(road).startsWith(normalizeForPrefix(queryRoad))) {
    return "";
  }

  const city = a.city || a.town || a.village || a.hamlet || a.county || "";
  const stateCode = (a["ISO3166-2-lvl4"] ?? "").replace(/^US-/i, "") || stateNameToCode(a.state);
  const zip = a.postcode ?? "";
  const tail = [stateCode, zip].filter(Boolean).join(" ").trim();
  return [`${houseNumber} ${road}`.trim(), city, tail].filter(Boolean).join(", ");
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
function stateNameToCode(name?: string): string {
  if (!name) return "";
  return STATE_NAME_TO_CODE[name] ?? "";
}

async function searchNominatim(
  query: string,
  signal?: AbortSignal,
  locationBias?: LocationBias | null
): Promise<AddressPrediction[]> {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", query);
  const viewbox = nominatimViewbox(locationBias);
  if (viewbox) {
    url.searchParams.set("viewbox", viewbox);
    url.searchParams.set("bounded", "0");
  }
  let res: Response;
  try {
    const fetched = await fetch(url.toString(), {
      signal,
      headers: { "Accept-Language": "en-US" },
    });
    if (!fetched) {
      reportAddressSearchError("nominatim", query, "Empty Nominatim response");
      return [];
    }
    res = fetched;
  } catch (err) {
    reportAddressSearchError("nominatim", query, err);
    return [];
  }
  if (!res.ok) {
    reportAddressSearchError("nominatim", query, `HTTP ${res.status}`, res.status);
    return [];
  }
  let data: NominatimResult[];
  try {
    data = (await res.json()) as NominatimResult[];
  } catch (err) {
    reportAddressSearchError("nominatim", query, err);
    return [];
  }
  const list = Array.isArray(data) ? data : [];
  // Drop city / county / region / POI hits. Keep real house-number
  // rows, and as a last-resort keep road-level rows when the user
  // already typed a house number. Nominatim often knows the road and
  // ZIP but not the parcel-level house number; preserving the user's
  // typed number is better than silently returning nothing.
  const streetOnly = list.filter((r) => {
    if (isNominatimStreetLevel(r)) return true;
    if (queryHasStreetText(query) && isNominatimRoadLevel(r)) return true;
    recordNonStreetLeak("nominatim", r.display_name ?? "");
    return false;
  });
  return streetOnly
    .map((r) => ({ id: String(r.place_id), description: formatNominatimAddressForQuery(r, query) }))
    .filter((p) => p.description.length > 0);
}

// ---------------------------------------------------------------------
// U.S. Census Geocoder proxy — keyless verifier for complete addresses
// ---------------------------------------------------------------------

const CENSUS_PROXY_PATH = "/api/census-geocode";

function shouldTryCensusQuery(query: string): boolean {
  const q = query.trim();
  if (q.length < 12) return false;
  if (!/^\d+\s+\S+/.test(q)) return false;
  const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(q);
  const hasState = /(?:,\s*|\s+)(A[LKSZRAEP]|C[AOT]|D[CE]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/i.test(q);
  const hasCitySeparator = q.includes(",");
  const hasStreetAndCity =
    /^(\d+)\s+[^,]{3,},\s*[A-Za-z][A-Za-z .'-]{1,}(?:,|$)/.test(q);
  return hasZip || (hasState && hasCitySeparator) || hasStreetAndCity;
}

async function searchCensusProxy(query: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  if (!shouldTryCensusQuery(query)) return [];

  let res: Response;
  try {
    const fetched = await fetch(CENSUS_PROXY_PATH, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!fetched) {
      reportAddressSearchError("census", query, "Empty Census response");
      return [];
    }
    res = fetched;
  } catch (err) {
    reportAddressSearchError("census", query, err);
    return [];
  }

  if (!res.ok) {
    reportAddressSearchError("census", query, `HTTP ${res.status}`, res.status);
    return [];
  }

  try {
    const data = (await res.json()) as { suggestions?: AddressPrediction[] };
    return (data.suggestions ?? [])
      .map((s): AddressPrediction | null => {
        if (!s.id || !s.description) return null;
        return { id: s.id, description: s.description };
      })
      .filter((p): p is AddressPrediction => p !== null);
  } catch (err) {
    reportAddressSearchError("census", query, err);
    return [];
  }
}

// ---------------------------------------------------------------------
// Mock fallback (last resort — used only when both real providers fail
// or no network is available). This is small and intentionally
// nationwide-flavored.
// ---------------------------------------------------------------------

export async function reverseGeocodeCurrentLocation(
  coords: { latitude: number; longitude: number },
  signal?: AbortSignal
): Promise<AddressPrediction | null> {
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));

  let res: Response;
  try {
    const fetched = await fetch(url.toString(), {
      signal,
      headers: { "Accept-Language": "en-US" },
    });
    if (!fetched) {
      reportAddressSearchError("nominatim_reverse", `${lat},${lon}`, "Empty reverse geocode response");
      return null;
    }
    res = fetched;
  } catch (err) {
    reportAddressSearchError("nominatim_reverse", `${lat},${lon}`, err);
    return null;
  }

  if (!res.ok) {
    reportAddressSearchError("nominatim_reverse", `${lat},${lon}`, `HTTP ${res.status}`, res.status);
    return null;
  }

  try {
    const data = (await res.json()) as NominatimResult;
    if (!isNominatimStreetLevel(data)) {
      recordNonStreetLeak("nominatim_reverse", data.display_name ?? "");
      return null;
    }
    const description = formatNominatimAddress(data);
    return {
      id: `current-location-${lat.toFixed(5)}-${lon.toFixed(5)}`,
      description,
    };
  } catch (err) {
    reportAddressSearchError("nominatim_reverse", `${lat},${lon}`, err);
    return null;
  }
}

const FALLBACK_STREETS = [
  "Main Street", "Oak Avenue", "Maple Drive", "Cedar Lane", "Park Avenue",
  "Washington Boulevard", "Elm Street", "Pine Road", "Highland Drive",
  "Riverside Drive", "Spring Street", "Lincoln Avenue", "Jefferson Street",
  "Madison Avenue", "Cherry Lane", "Hilltop Drive", "Meadow Lane",
];

const FALLBACK_PLACES: [string, string, string][] = [
  ["Boston", "MA", "02108"], ["New York", "NY", "10001"], ["Philadelphia", "PA", "19103"],
  ["Atlanta", "GA", "30303"], ["Miami", "FL", "33101"], ["Tampa", "FL", "33602"],
  ["Charlotte", "NC", "28202"], ["Nashville", "TN", "37203"], ["Chicago", "IL", "60601"],
  ["Detroit", "MI", "48226"], ["Northville", "MI", "48167"], ["Minneapolis", "MN", "55401"],
  ["Saint Louis", "MO", "63101"], ["Kansas City", "MO", "64108"], ["Dallas", "TX", "75201"],
  ["Austin", "TX", "78701"], ["Houston", "TX", "77002"], ["Denver", "CO", "80202"],
  ["Salt Lake City", "UT", "84101"], ["Phoenix", "AZ", "85003"], ["Las Vegas", "NV", "89101"],
  ["Los Angeles", "CA", "90012"], ["San Francisco", "CA", "94102"], ["Seattle", "WA", "98101"],
  ["Portland", "OR", "97204"], ["Washington", "DC", "20001"],
];

function hash(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickNumber(query: string): string {
  const m = query.match(/^\s*(\d+)/);
  if (m) return m[1];
  return String((hash(query) % 9000) + 100);
}

function buildFallbackPredictions(query: string): AddressPrediction[] {
  const num = pickNumber(query);
  const seed = hash(query);
  // Split the query into "leading number" + "rest" so we can prefer
  // streets whose name *starts with* the rest. This is what the live
  // providers do server-side; the mock matches that behavior so the
  // fallback still produces useful suggestions under strict prefix
  // matching.
  const rest = query.replace(/^\s*\d+\s*/, "").trim().toLowerCase();
  const ranked = rest
    ? FALLBACK_STREETS.map((s) => {
        const sl = s.toLowerCase();
        const score = sl.startsWith(rest) ? 2 : sl.includes(rest) ? 1 : 0;
        return { s, score };
      })
        .sort((a, b) => b.score - a.score || a.s.localeCompare(b.s))
        .map((r) => r.s)
    : FALLBACK_STREETS;
  return ranked.slice(0, 6).map((street, i) => {
    const [city, st, zip] = FALLBACK_PLACES[(seed + i) % FALLBACK_PLACES.length];
    return {
      id: `${num}-${street}-${city}`.replace(/\s+/g, "_"),
      description: `${num} ${street}, ${city}, ${st} ${zip}`,
    };
  });
}

// ---------------------------------------------------------------------
// Marina mode (curated — niche, not worth a real geocoder)
// ---------------------------------------------------------------------

const MARINAS: [string, string, string][] = [
  ["Palm Harbor Marina", "Palm Beach", "FL"],
  ["Newport Yacht Club", "Newport", "RI"],
  ["Sag Harbor Yacht Club", "Sag Harbor", "NY"],
  ["Ocean Reef Club Marina", "Key Largo", "FL"],
  ["Bay Harbor Marina", "Naples", "FL"],
  ["Annapolis City Dock", "Annapolis", "MD"],
  ["Charleston Maritime Center", "Charleston", "SC"],
  ["Marina del Rey", "Marina del Rey", "CA"],
  ["Edgartown Yacht Club", "Edgartown", "MA"],
  ["Hilton Head Boathouse", "Hilton Head", "SC"],
  ["Lake Norman Marina", "Cornelius", "NC"],
  ["Lake Tahoe Marina", "South Lake Tahoe", "CA"],
  ["Chicago Yacht Club", "Chicago", "IL"],
  ["Mackinac Island Marina", "Mackinac Island", "MI"],
];

function searchMarinas(query: string): AddressPrediction[] {
  const q = query.toLowerCase().trim();
  const matches = MARINAS.filter(
    ([name, city]) => !q || name.toLowerCase().includes(q) || city.toLowerCase().includes(q)
  );
  const pool = matches.length > 0 ? matches : MARINAS;
  return pool.slice(0, 6).map(([name, city, st]) => ({
    id: `${name}-${city}`.replace(/\s+/g, "_"),
    description: `${name}, ${city}, ${st}`,
  }));
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// LRU cache of raw provider responses (street-only, pre-prefix-filter)
// ---------------------------------------------------------------------
//
// Why: Nominatim does whole-word matching. Typing "901 McD" returns
// zero results because "McD" isn't an indexed word. The fix is a
// two-layer strategy:
//
//   1. Before hitting the network, check the cache for any longer-
//      prefix query whose results contain at least one entry that
//      still prefix-matches what the user has now typed. If so, reuse
//      those results client-side and skip the API hit.
//
//   2. If we still need to hit the API and it returns zero, retry
//      with the trailing partial word stripped ("901 McD" → "901").
//      Then post-filter with strict prefix.
// ---------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 32;
interface CachedEntry {
  key: string;             // normalized cache key
  providerName: string;
  normalizedQuery: string;
  biasKey: string;
  rawResults: AddressPrediction[];
}
const responseCache = new Map<string, CachedEntry>();

function cacheKey(query: string, providerName: string, locationBias?: LocationBias | null): string {
  return `${providerName}::${locationBiasCacheKey(locationBias)}::${normalizeForPrefix(query)}`;
}

function cacheGet(
  query: string,
  providerName: string,
  locationBias?: LocationBias | null
): AddressPrediction[] | undefined {
  const k = cacheKey(query, providerName, locationBias);
  const v = responseCache.get(k);
  if (!v) return undefined;
  // LRU bump
  responseCache.delete(k);
  responseCache.set(k, v);
  return v.rawResults;
}

function cacheSet(
  query: string,
  providerName: string,
  raw: AddressPrediction[],
  locationBias?: LocationBias | null
) {
  const biasKey = locationBiasCacheKey(locationBias);
  const normalizedQuery = normalizeForPrefix(query);
  const k = cacheKey(query, providerName, locationBias);
  if (responseCache.has(k)) responseCache.delete(k);
  responseCache.set(k, { key: k, providerName, normalizedQuery, biasKey, rawResults: raw });
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
}

// Walk the cache MRU → LRU and return the first cached entry whose
// results can still satisfy the current query under strict prefix
// matching. Works in both directions of typing:
//   - forward ("901 Mc" then "901 McD"):  cached is a PREFIX of current
//   - backspace ("901 McDonald" then "901 McDonal"): current is a
//     PREFIX of cached
// Returns the cached raw results (caller does the final prefix
// filter so a single source of truth applies).
function findUsableCachedEntry(
  query: string,
  locationBias?: LocationBias | null
): { providerName: string; raw: AddressPrediction[] } | undefined {
  const normCurrent = normalizeForPrefix(query);
  const currentBiasKey = locationBiasCacheKey(locationBias);
  const entries = [...responseCache.values()].reverse();
  for (const entry of entries) {
    if (entry.biasKey !== currentBiasKey) continue;
    const providerName = entry.providerName;
    const cachedNorm = entry.normalizedQuery;
    if (!providerName || cachedNorm.length === 0) continue;
    // Accept when either direction is a prefix of the other — covers
    // both forward typing and backspaces over the cached query.
    const oneIsPrefix =
      normCurrent.startsWith(cachedNorm) || cachedNorm.startsWith(normCurrent);
    if (!oneIsPrefix) continue;
    // Make sure at least one cached row still satisfies strict prefix
    // matching against the current input — otherwise this cache entry
    // doesn't help us.
    const stillUsable = entry.rawResults.some((p) => matchesQueryPrefix(p.description, query));
    if (stillUsable) {
      return { providerName, raw: entry.rawResults };
    }
  }
  return undefined;
}

// "901 McDonald Dr" → "901 McDonald" (drops the trailing partial word).
// Returns "" if no broader form exists (single word / single number).
function stripTrailingPartialWord(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(" ").replace(/[,\s]+$/g, "").trim();
}

function expandStreetSuffixesForProvider(query: string): string {
  return query.replace(/\b([A-Za-z]{1,8})\.?\b/g, (match, token: string) => {
    return STREET_SUFFIX_QUERY_EXPANSIONS[token.toLowerCase()] ?? match;
  });
}

function extractLeadingHouseNumber(query: string): string {
  return query.trim().match(/^(\d+[A-Za-z]?)(?:\s+|$)/)?.[1] ?? "";
}

function queryHasStreetText(query: string): boolean {
  return /^\s*\d+[A-Za-z]?\s+[A-Za-z0-9]/.test(query);
}

function streetLineBeforeComma(query: string): string {
  const parts = query.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return "";
  const first = parts[0];
  return /^\d+\s+\S+/.test(first) ? first : "";
}

interface ProviderQueryVariant {
  value: string;
  isBroader: boolean;
}

function addProviderQueryVariant(
  variants: ProviderQueryVariant[],
  value: string,
  isBroader: boolean
) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  const duplicate = variants.some(
    (variant) => variant.value.toLowerCase() === normalized.toLowerCase()
  );
  if (duplicate) return;
  variants.push({ value: normalized, isBroader });
}

function buildProviderQueryVariants(query: string): ProviderQueryVariant[] {
  const variants: ProviderQueryVariant[] = [];
  const trimmed = query.replace(/\s+/g, " ").trim();
  addProviderQueryVariant(variants, trimmed, false);
  addProviderQueryVariant(variants, expandStreetSuffixesForProvider(trimmed), false);

  const streetOnly = streetLineBeforeComma(trimmed);
  addProviderQueryVariant(variants, streetOnly, true);
  addProviderQueryVariant(variants, expandStreetSuffixesForProvider(streetOnly), true);

  const broader = stripTrailingPartialWord(trimmed);
  addProviderQueryVariant(variants, broader, true);
  addProviderQueryVariant(variants, expandStreetSuffixesForProvider(broader), true);

  if (streetOnly) {
    const broaderStreetOnly = stripTrailingPartialWord(streetOnly);
    addProviderQueryVariant(variants, broaderStreetOnly, true);
    addProviderQueryVariant(variants, expandStreetSuffixesForProvider(broaderStreetOnly), true);
  }

  return variants.slice(0, 8);
}

// Wraps a provider with cache write + telemetry on success. Returns
// the raw (pre-prefix-filter) results.
type ProviderName =
  | "google_proxy"
  | "google_js"
  | "google"
  | "smarty_proxy"
  | "smarty"
  | "mapbox"
  | "photon_proxy"
  | "nominatim_proxy"
  | "nominatim"
  | "census";

async function runProvider(
  providerName: ProviderName,
  query: string,
  options: { signal?: AbortSignal; googleSessionToken?: string; locationBias?: LocationBias | null } = {}
): Promise<{ raw: AddressPrediction[]; error?: ProviderError }> {
  const { signal, googleSessionToken, locationBias } = options;
  const beforeErrors = telemetry.errors.length;
  let raw: AddressPrediction[];
  if (providerName === "google_proxy") {
    raw = await searchGoogleProxy(
      query,
      googleSessionToken ?? newGoogleSessionToken(),
      signal,
      locationBias
    );
  } else if (providerName === "google_js") {
    raw = await searchGoogleJs(
      query,
      googleSessionToken ?? newGoogleSessionToken(),
      signal,
      locationBias
    );
  } else if (providerName === "google") {
    raw = await searchGoogle(
      query,
      googleSessionToken ?? newGoogleSessionToken(),
      signal,
      locationBias
    );
  } else if (providerName === "smarty_proxy") {
    raw = await searchSmartyProxy(query, signal);
  } else if (providerName === "smarty") {
    raw = await searchSmarty(query, signal);
  } else if (providerName === "mapbox") {
    raw = await searchMapbox(query, signal, locationBias);
  } else if (providerName === "photon_proxy") {
    raw = await searchPhotonProxy(query, signal, locationBias);
  } else if (providerName === "nominatim_proxy") {
    raw = await searchNominatimProxy(query, signal, locationBias);
  } else if (providerName === "census") {
    raw = await searchCensusProxy(query, signal);
  } else {
    raw = await searchNominatim(query, signal, locationBias);
  }
  cacheSet(query, providerName, raw, locationBias);
  if (raw.length > 0) markSuccess(providerName);
  const error =
    telemetry.errors.length > beforeErrors ? telemetry.errors[telemetry.errors.length - 1] : undefined;
  return { raw, error };
}

// Pick the highest-priority provider whose credentials are configured.
// Google Places (New) wins when configured. When picked, the runner
// tries the JS SDK transport first and falls back to REST on SDK
// load failure (CSP, ad-blocker, etc.). Smarty / Mapbox / Nominatim
// are mutually exclusive — only one is used per session.
function pickProvider(): ProviderName {
  if (serverGoogleProxyEnabled()) return "google_proxy";
  if (getGoogleKey()) return "google_js";
  if (serverSmartyProxyEnabled()) return "smarty_proxy";
  if (getSmartyKey()) return "smarty";
  if (getMapboxToken()) return "mapbox";
  if (serverPhotonProxyEnabled()) return "photon_proxy";
  if (serverNominatimProxyEnabled()) return "nominatim_proxy";
  return "nominatim";
}

function providerOrder(query?: string, locationBias?: LocationBias | null): ProviderName[] {
  const order: ProviderName[] = [];
  const shortHouseNumberPrefix = isShortHouseNumberPrefix(query ?? "");
  const explicitLocationBias = Boolean(normalizeLocationBias(locationBias));
  if (shortHouseNumberPrefix && serverPhotonProxyEnabled()) order.push("photon_proxy");
  if (serverGoogleProxyEnabled()) order.push("google_proxy");
  if (getGoogleKey()) order.push("google_js", "google");
  if (!shortHouseNumberPrefix || !explicitLocationBias) {
    if (serverSmartyProxyEnabled()) order.push("smarty_proxy");
    if (getSmartyKey()) order.push("smarty");
  }
  if (getMapboxToken()) order.push("mapbox");
  if (!shortHouseNumberPrefix && serverPhotonProxyEnabled()) order.push("photon_proxy");
  if (query && shouldTryCensusQuery(query)) order.push("census");
  if (serverNominatimProxyEnabled()) order.push("nominatim_proxy");
  order.push("nominatim");
  return Array.from(new Set(order));
}

function shouldTryNextProvider(providerName: ProviderName, error?: ProviderError): boolean {
  if (providerName === "google_js") return true;
  if (error?.status === 401 || error?.status === 403) return false;
  return true;
}

// Public helper so the UI knows which provider is active (e.g.
// whether to render the Google attribution required by their TOS).
// Collapses both Google transports to "google" since the attribution
// is the same regardless of which one served the response.
export function getActiveProvider(): "google" | "smarty" | "mapbox" | "nominatim" {
  const p = pickProvider();
  if (p === "google_proxy") return "google";
  if (p === "google_js") return "google";
  if (p === "smarty_proxy") return "smarty";
  if (p === "photon_proxy") return "nominatim";
  if (p === "nominatim_proxy") return "nominatim";
  if (p === "census") return "nominatim";
  return p;
}

export async function searchAddresses(
  query: string,
  mode: AddressSearchMode = "address",
  signal?: AbortSignal,
  googleSessionToken?: string,
  options: AddressSearchOptions = {}
): Promise<AddressPrediction[]> {
  if (!query.trim()) return [];

  if (mode === "marina") {
    // Niche category — keep the curated list. (Real impl can switch to
    // POI search with a `category=marina` filter.)
    return searchMarinas(query);
  }

  // 1. Cache lookup. If any cached longer-prefix entry can still
  //    answer this query under strict prefix, use it and skip the
  //    network entirely.
  const cached = findUsableCachedEntry(query, options.locationBias);
  if (cached) {
    telemetry.cacheHits += 1;
    return enforcePrefixMatch(cached.providerName, query, cached.raw);
  }

  // 2. Live providers. For real autocomplete providers, let the
  //    provider rank results from the exact text the user typed. For
  //    keyless validators/fallbacks, use conservative variants and
  //    strict filtering so city/county/region noise never leaks into
  //    the dropdown.
  let matched: AddressPrediction[] = [];
  const queryVariants = buildProviderQueryVariants(query);
  providerLoop:
  for (const candidate of providerOrder(query, options.locationBias)) {
    const variants =
      candidate === "google_proxy" ||
      candidate === "google_js" ||
      candidate === "google" ||
      candidate === "smarty_proxy" ||
      candidate === "smarty" ||
      candidate === "photon_proxy" ||
      candidate === "nominatim_proxy"
        ? [{ value: query.replace(/\s+/g, " ").trim(), isBroader: false }]
        : queryVariants;

    for (const variant of variants) {
      if (candidate === "census" && (variant.isBroader || !shouldTryCensusQuery(variant.value))) {
        continue;
      }
      if (variant.isBroader && candidate !== "census") {
        telemetry.broaderQueryRetries += 1;
        telemetry.lastBroaderQuery = { original: query, broader: variant.value };
      }
      const result = await runProvider(candidate, variant.value, {
        signal,
        googleSessionToken,
        locationBias: options.locationBias,
      });
      const raw = result.raw;
      if (raw.length > 0) {
        const trustsProviderRanking =
          candidate === "google_proxy" ||
          candidate === "google_js" ||
          candidate === "google" ||
          candidate === "smarty_proxy" ||
          candidate === "smarty" ||
          candidate === "photon_proxy" ||
          candidate === "nominatim_proxy";
        const filtered = trustsProviderRanking ? raw : enforcePrefixMatch(candidate, query, raw);
        if (filtered.length > 0) {
          matched = filtered;
          break providerLoop;
        }
        if (candidate === "census") break;
      }
      if (result.error) {
        if (!shouldTryNextProvider(candidate, result.error)) break providerLoop;
        break;
      }
    }
  }

  // 3. Still nothing → fall back to the mock pool only for demo
  //    surfaces that explicitly opted in.
  if (matched.length === 0) {
    if (options.allowMockFallback !== true) return [];
    return enforcePrefixMatch("mock", query, buildFallbackPredictions(query));
  }

  // 4. The winning provider/variant already passed strict prefix matching.
  return matched;
}
