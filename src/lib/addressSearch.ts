// =====================================================================
// Address autocomplete service — nationwide US coverage.
//
// Provider order (first one with a successful response wins):
//   1. Mapbox Geocoding API     — used when VITE_MAPBOX_TOKEN is set
//   2. Nominatim (OpenStreetMap) — no API key required, used otherwise
//   3. Built-in mock pool        — last-resort fallback if both providers
//                                  fail (offline, blocked, rate-limited)
//
// Both real providers are restricted to US-only results
// (`country=us` / `countrycodes=us`). The Nominatim public endpoint
// supports CORS and is keyless; for production, swap to a dedicated
// Mapbox / Smarty / Google Places token to avoid Nominatim's rate
// limits and respect their fair-use policy.
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

export interface AddressSearchOptions {
  // Defaults to true for legacy demo surfaces. Customer quote intake
  // passes false so the dropdown only shows real provider results.
  allowMockFallback?: boolean;
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

// ---------------------------------------------------------------------
// Strict prefix matching
// ---------------------------------------------------------------------

// Normalize for left-to-right comparison: lowercase, collapse internal
// whitespace runs to a single space, trim ends. We intentionally keep
// punctuation (commas, periods in "St.", dashes) so that everything
// after the first non-prefix character truly fails the match.
function normalizeForPrefix(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesQueryPrefix(description: string, query: string): boolean {
  const d = normalizeForPrefix(description);
  const q = normalizeForPrefix(query);
  if (!q) return true;
  return d.startsWith(q);
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
  console.warn("[addressSearch] provider failed", entry);
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

function getGoogleKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    // Prefer the dedicated Places key. Fall back to the legacy
    // VITE_GOOGLE_MAPS_API_KEY so existing deployments keep working
    // without a redeploy. Either one must have the Places API,
    // Place Details, and Geocoding API enabled in Cloud Console.
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

async function searchGoogle(
  query: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<AddressPrediction[]> {
  const key = getGoogleKey();
  if (!key) return [];
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
    `[addressSearch] ${transport} failed for "${query}"` +
      (hint ? ` — ${hint.code}: ${hint.remediation}` : ""),
    { raw }
  );
}

async function searchGoogleJs(
  query: string,
  sessionToken: string,
  signal?: AbortSignal
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
    response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
      sessionToken: getGoogleJsSessionToken(places, sessionToken),
    });
  } catch (err) {
    logGoogleFailure("google_js", query, err);
    return [];
  }

  // Log raw response at info level for diagnostics — the user
  // explicitly asked for this so REQUEST_DENIED etc. show up in
  // DevTools during testing. Keep it terse so production noise stays
  // manageable.
  // eslint-disable-next-line no-console
  console.info(`[addressSearch] google_js raw response for "${query}"`, response);

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
  const viaJs = await fetchGooglePlaceDetailsViaJs(placeId, sessionToken);
  if (viaJs) return viaJs;
  return fetchGooglePlaceDetailsViaRest(placeId, sessionToken, signal);
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

async function searchMapbox(query: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  const token = getMapboxToken();
  if (!token) return [];
  // types=address restricts results to street-level addresses only;
  // we deliberately exclude place / locality / postcode / poi so the
  // dropdown never shows "McDonald, PA" when the user is searching
  // for "901 McDonald Drive".
  const url = `${MAPBOX_BASE}/${encodeURIComponent(query)}.json?country=us&types=address&autocomplete=true&limit=6&access_token=${encodeURIComponent(
    token
  )}`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
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

async function searchNominatim(query: string, signal?: AbortSignal): Promise<AddressPrediction[]> {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", query);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal,
      headers: { "Accept-Language": "en-US" },
    });
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
  // Drop city / county / region / POI hits — keep only entries with
  // both a house number and a road. Anything we drop is recorded in
  // telemetry so ops can spot a provider regression.
  const streetOnly = list.filter((r) => {
    if (isNominatimStreetLevel(r)) return true;
    recordNonStreetLeak("nominatim", r.display_name ?? "");
    return false;
  });
  return streetOnly
    .map((r) => ({ id: String(r.place_id), description: formatNominatimAddress(r) }))
    .filter((p) => p.description.length > 0);
}

// ---------------------------------------------------------------------
// Mock fallback (last resort — used only when both real providers fail
// or no network is available). This is small and intentionally
// nationwide-flavored.
// ---------------------------------------------------------------------

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
  rawResults: AddressPrediction[];
}
const responseCache = new Map<string, CachedEntry>();

function cacheKey(query: string, providerName: string): string {
  return `${providerName}::${normalizeForPrefix(query)}`;
}

function cacheGet(query: string, providerName: string): AddressPrediction[] | undefined {
  const k = cacheKey(query, providerName);
  const v = responseCache.get(k);
  if (!v) return undefined;
  // LRU bump
  responseCache.delete(k);
  responseCache.set(k, v);
  return v.rawResults;
}

function cacheSet(query: string, providerName: string, raw: AddressPrediction[]) {
  const k = cacheKey(query, providerName);
  if (responseCache.has(k)) responseCache.delete(k);
  responseCache.set(k, { key: k, rawResults: raw });
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
function findUsableCachedEntry(query: string): { providerName: string; raw: AddressPrediction[] } | undefined {
  const normCurrent = normalizeForPrefix(query);
  const entries = [...responseCache.values()].reverse();
  for (const entry of entries) {
    const [providerName, cachedNorm] = entry.key.split("::");
    if (!providerName || cachedNorm === undefined) continue;
    if (cachedNorm.length === 0) continue;
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
  return parts.slice(0, -1).join(" ");
}

// Wraps a provider with cache write + telemetry on success. Returns
// the raw (pre-prefix-filter) results.
type ProviderName = "google_js" | "google" | "smarty" | "mapbox" | "nominatim";

async function runProvider(
  providerName: ProviderName,
  query: string,
  options: { signal?: AbortSignal; googleSessionToken?: string } = {}
): Promise<AddressPrediction[]> {
  const { signal, googleSessionToken } = options;
  let raw: AddressPrediction[];
  if (providerName === "google_js") {
    raw = await searchGoogleJs(query, googleSessionToken ?? newGoogleSessionToken(), signal);
  } else if (providerName === "google") {
    raw = await searchGoogle(query, googleSessionToken ?? newGoogleSessionToken(), signal);
  } else if (providerName === "smarty") {
    raw = await searchSmarty(query, signal);
  } else if (providerName === "mapbox") {
    raw = await searchMapbox(query, signal);
  } else {
    raw = await searchNominatim(query, signal);
  }
  cacheSet(query, providerName, raw);
  if (raw.length > 0) markSuccess(providerName);
  return raw;
}

// Pick the highest-priority provider whose credentials are configured.
// Google Places (New) wins when configured. When picked, the runner
// tries the JS SDK transport first and falls back to REST on SDK
// load failure (CSP, ad-blocker, etc.). Smarty / Mapbox / Nominatim
// are mutually exclusive — only one is used per session.
function pickProvider(): ProviderName {
  if (getGoogleKey()) return "google_js";
  if (getSmartyKey()) return "smarty";
  if (getMapboxToken()) return "mapbox";
  return "nominatim";
}

// Public helper so the UI knows which provider is active (e.g.
// whether to render the Google attribution required by their TOS).
// Collapses both Google transports to "google" since the attribution
// is the same regardless of which one served the response.
export function getActiveProvider(): "google" | "smarty" | "mapbox" | "nominatim" {
  const p = pickProvider();
  if (p === "google_js") return "google";
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
  const cached = findUsableCachedEntry(query);
  if (cached) {
    telemetry.cacheHits += 1;
    return enforcePrefixMatch(cached.providerName, query, cached.raw);
  }

  // 2. Live provider. When Google is configured we try the JS SDK
  //    first; on SDK load failure (CSP, ad-blocker, slow CDN) the
  //    JS provider returns 0 and we silently fall through to the
  //    REST transport so the user still gets predictions.
  let provider = pickProvider();
  let raw = await runProvider(provider, query, { signal, googleSessionToken });
  if (raw.length === 0 && provider === "google_js") {
    provider = "google";
    raw = await runProvider(provider, query, { signal, googleSessionToken });
  }

  // 3. Broader-query retry. Nominatim's search endpoint does
  //    whole-word matching, so "901 McD" returns 0. Drop the last
  //    partial word ("901 McD" → "901") and ask again, then enforce
  //    strict prefix client-side to keep only the user-typed prefix.
  if (raw.length === 0) {
    const broader = stripTrailingPartialWord(query);
    if (broader && broader !== query) {
      telemetry.broaderQueryRetries += 1;
      telemetry.lastBroaderQuery = { original: query, broader };
      raw = await runProvider(provider, broader, { signal, googleSessionToken });
    }
  }

  // 4. Still nothing → fall back to the mock pool so the UI never
  //    goes blank when both real providers fail.
  if (raw.length === 0) {
    if (options.allowMockFallback === false) return [];
    return enforcePrefixMatch("mock", query, buildFallbackPredictions(query));
  }

  // 5. Apply strict prefix matching as the final gate.
  return enforcePrefixMatch(provider, query, raw);
}
