// Server-side Photon autocomplete proxy.
//
// Photon is an OpenStreetMap-based search-as-you-type geocoder. This
// proxy gives the browser a controlled fallback when Google/Mapbox/
// Smarty are unavailable, while keeping rate limiting and response
// normalization in one place.

import { applyRateLimit } from "./_rateLimit.js";

const PHOTON_AUTOCOMPLETE_URL =
  process.env.PHOTON_AUTOCOMPLETE_URL || "https://photon.komoot.io/api/";
const PHOTON_REVERSE_URL =
  process.env.PHOTON_REVERSE_URL || "https://photon.komoot.io/reverse";
const BIGDATA_REVERSE_URL =
  process.env.BIGDATA_REVERSE_URL || "https://api.bigdatacloud.net/data/reverse-geocode-client";
const CENSUS_COORDINATES_URL =
  process.env.CENSUS_COORDINATES_URL ||
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const NOMINATIM_REVERSE_URL =
  process.env.NOMINATIM_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse";

interface RequestPayload {
  query?: string;
  locationBias?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
}

interface LocationBias {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

interface PhotonFeature {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    locality?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
    osm_type?: string;
    osm_id?: number | string;
  };
}

interface AddressPrediction {
  id: string;
  description: string;
}

interface LocalityHint {
  city: string;
  state: string;
}

interface NominatimReverseResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
    "ISO3166-2-lvl4"?: string;
  };
}

interface BigDataReverseResponse {
  locality?: string;
  city?: string;
  principalSubdivision?: string;
  principalSubdivisionCode?: string;
}

interface CensusGeography {
  BASENAME?: string;
  NAME?: string;
  STUSAB?: string;
}

interface CensusCoordinatesResponse {
  result?: {
    geographies?: Record<string, CensusGeography[]>;
  };
}

const localityHintCache = new Map<string, { at: number; hint: LocalityHint | null }>();
const LOCALITY_HINT_TTL_MS = 30 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (
    !(await applyRateLimit(req, res, "photon-autocomplete", {
      windowMs: 60_000,
      limit: 180,
      failOpen: true,
    }))
  ) {
    return;
  }

  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const query = normalizeQuery(body.query);
  if (query.length < 2) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const bias = normalizeLocationBias(body.locationBias) ?? normalizeLocationBias(body);
  const url = buildPhotonUrl(query, bias);

  const firstPass = await fetchPhoton(url);
  if (!firstPass.ok) {
    res.status(firstPass.status).json(firstPass.body);
    return;
  }

  let suggestions = normalizeFeatures(firstPass.features, query, bias);

  if (suggestions.length === 0 && bias && shouldTryLocalityContext(query)) {
    const hint = await fetchLocalityHint(bias);
    const roadPrefixBias = clampLocationBiasRadius(bias, 15_000);
    const contextualBias = widenLocationBias(bias, 50_000);
    for (const contextualQuery of buildRoadPrefixContextQueries(query, hint)) {
      const contextualPass = await fetchPhoton(
        buildPhotonUrl(contextualQuery, roadPrefixBias, 12, true)
      );
      if (!contextualPass.ok) continue;
      suggestions = normalizeFeatures(contextualPass.features, query, roadPrefixBias);
      if (suggestions.length > 0) break;
    }
    for (const contextualQuery of buildLocalityContextQueries(query, hint)) {
      if (suggestions.length > 0) break;
      const contextualPass = await fetchPhoton(buildPhotonUrl(contextualQuery, contextualBias, 12));
      if (!contextualPass.ok) continue;
      suggestions = normalizeFeatures(contextualPass.features, contextualQuery, contextualBias);
      if (suggestions.length === 0) {
        const contextualStructuredUrl = buildStructuredPhotonUrl(contextualQuery, contextualBias);
        if (contextualStructuredUrl) {
          const structuredPass = await fetchPhoton(contextualStructuredUrl);
          if (structuredPass.ok) {
            suggestions = normalizeFeatures(structuredPass.features, contextualQuery, contextualBias);
          }
        }
      }
      if (suggestions.length > 0) break;
    }
  }

  const structuredUrl = buildStructuredPhotonUrl(query, bias);
  if (suggestions.length === 0 && structuredUrl) {
    const structuredPass = await fetchPhoton(structuredUrl);
    if (structuredPass.ok) {
      suggestions = normalizeFeatures(structuredPass.features, query, bias);
    }
  }

  res.status(200).json({ suggestions });
}

function normalizeFeatures(
  features: PhotonFeature[] = [],
  query: string,
  bias: LocationBias | null = null
): AddressPrediction[] {
  const strictLocation = Boolean(bias && shouldUseStrictLocationBias(query));
  const maxDistanceMeters = strictLocation ? Math.max(bias?.radiusMeters ?? 15_000, 75_000) : null;
  const ranked = features
    .map((feature) => {
      const prediction = toPrediction(feature, query);
      if (!prediction) return null;
      const distance = bias ? photonFeatureDistanceMeters(feature, bias) : null;
      if (strictLocation && (distance === null || distance > (maxDistanceMeters ?? 75_000))) {
        return null;
      }
      return {
        prediction,
        distance: distance ?? Number.POSITIVE_INFINITY,
      };
    })
    .filter(
      (item): item is { prediction: AddressPrediction; distance: number } => item !== null
    )
    .sort((a, b) => a.distance - b.distance)
    .map((item) => item.prediction);

  return dedupePredictions(ranked).slice(0, 6);
}

function photonFeatureDistanceMeters(feature: PhotonFeature, bias: LocationBias): number | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return distanceMeters(bias.latitude, bias.longitude, latitude, longitude);
}

function shouldUseStrictLocationBias(query: string): boolean {
  const q = normalizeQuery(query);
  if (/^\d{2,6}$/.test(q)) return true;
  if (/^\d+[A-Za-z]?\s+[A-Za-z]{1,4}$/.test(q)) return true;
  return false;
}

function shouldTryLocalityContext(query: string): boolean {
  const q = normalizeQuery(query);
  if (/^\d{2,6}$/.test(q)) return true;
  if (/^\d+[A-Za-z]?\s+[A-Za-z]{1,5}$/.test(q)) return true;
  return false;
}

function buildLocalityContextQueries(query: string, hint: LocalityHint | null): string[] {
  if (!hint?.city && !hint?.state) return [];
  const q = normalizeQuery(query);
  const city = hint.city;
  const state = hint.state;
  const houseNumber = extractLeadingHouseNumber(q);
  const candidates = [
    [q, city].filter(Boolean).join(" "),
    [q, city, state].filter(Boolean).join(" "),
    [q, state].filter(Boolean).join(" "),
    houseNumber ? [houseNumber, city].filter(Boolean).join(" ") : "",
    houseNumber ? [houseNumber, city, state].filter(Boolean).join(" ") : "",
  ];
  return Array.from(new Set(candidates.filter((candidate) => candidate !== q)));
}

function buildRoadPrefixContextQueries(query: string, hint: LocalityHint | null): string[] {
  if (!hint?.city && !hint?.state) return [];
  const parsed = parseLeadingHouseAndRoad(query);
  if (!parsed?.roadPrefix || parsed.roadPrefix.length < 1) return [];
  const city = hint.city;
  const state = hint.state;
  const candidates = [
    parsed.roadPrefix,
    [parsed.roadPrefix, city].filter(Boolean).join(" "),
    [parsed.roadPrefix, city, state].filter(Boolean).join(" "),
    [parsed.roadPrefix, state].filter(Boolean).join(" "),
  ];
  return Array.from(new Set(candidates));
}

type PhotonFetchResult =
  | { ok: true; features: PhotonFeature[] }
  | { ok: false; status: number; body: { error: string; status?: number } };

function buildPhotonUrl(
  query: string,
  bias: LocationBias | null,
  limit = 8,
  forceStrictLocationBias = false
): URL {
  const url = new URL(PHOTON_AUTOCOMPLETE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "en");
  url.searchParams.set("countrycode", "US");
  url.searchParams.append("layer", "house");
  url.searchParams.append("layer", "street");

  if (bias) {
    url.searchParams.set("lat", String(bias.latitude));
    url.searchParams.set("lon", String(bias.longitude));
    url.searchParams.set("zoom", radiusToPhotonZoom(bias.radiusMeters ?? 50_000));
    url.searchParams.set(
      "location_bias_scale",
      forceStrictLocationBias || shouldUseStrictLocationBias(query) ? "0.0" : "0.1"
    );
    url.searchParams.set("bbox", photonBoundingBox(bias));
  }

  return url;
}

async function fetchPhoton(url: URL): Promise<PhotonFetchResult> {
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-autocomplete",
      },
    });
  } catch (error) {
    console.error("[photon-autocomplete] upstream fetch failed", error);
    return { ok: false, status: 502, body: { error: "photon_unreachable" } };
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.toLowerCase().includes("json")) {
    const snippet = await safeReadText(upstream);
    console.error("[photon-autocomplete] upstream unavailable", {
      status: upstream.status,
      contentType,
      snippet: snippet.slice(0, 120),
    });
    return {
      ok: false,
      status: upstream.status === 429 ? 429 : 503,
      body: {
        error: upstream.status === 429 ? "photon_rate_limited" : "photon_unavailable",
        status: upstream.status,
      },
    };
  }

  const data = (await safeReadJson(upstream)) as { features?: PhotonFeature[] };
  return { ok: true, features: data.features ?? [] };
}

async function fetchLocalityHint(bias: LocationBias): Promise<LocalityHint | null> {
  const cacheKey = `${bias.latitude.toFixed(3)},${bias.longitude.toFixed(3)}`;
  const cached = localityHintCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LOCALITY_HINT_TTL_MS) return cached.hint;

  let hint = await fetchCensusLocalityHint(bias);
  if (!isSpecificLocalityHint(hint)) hint = await fetchBigDataLocalityHint(bias);
  if (!isSpecificLocalityHint(hint)) hint = await fetchPhotonLocalityHint(bias);
  if (!isSpecificLocalityHint(hint)) hint = await fetchNominatimLocalityHint(bias);
  if (!isSpecificLocalityHint(hint)) hint = inferKnownLocalityHint(bias);

  localityHintCache.set(cacheKey, { at: Date.now(), hint });
  return hint;
}

async function fetchCensusLocalityHint(bias: LocationBias): Promise<LocalityHint | null> {
  const url = new URL(CENSUS_COORDINATES_URL);
  url.searchParams.set("x", bias.longitude.toFixed(6));
  url.searchParams.set("y", bias.latitude.toFixed(6));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-locality contact@quotexinsurance.com",
      },
    });
    if (!upstream.ok) return null;
    const data = (await safeReadJson(upstream)) as CensusCoordinatesResponse;
    const geographies = data.result?.geographies ?? {};
    const place = firstCensusGeography(geographies["Incorporated Places"]);
    const subdivision = firstCensusGeography(geographies["County Subdivisions"]);
    const stateGeo = firstCensusGeography(geographies.States);
    const city = clean(place?.BASENAME) || clean(subdivision?.BASENAME);
    const state = clean(stateGeo?.STUSAB);
    if (city || state) return { city, state };
  } catch (error) {
    console.error("[photon-autocomplete] census coordinate lookup failed", error);
  }
  return null;
}

function firstCensusGeography(items: CensusGeography[] | undefined): CensusGeography | null {
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function isSpecificLocalityHint(hint: LocalityHint | null): hint is LocalityHint {
  return Boolean(hint?.city);
}

function inferKnownLocalityHint(bias: LocationBias): LocalityHint | null {
  for (const known of KNOWN_LOCALITY_HINTS) {
    if (distanceMeters(bias.latitude, bias.longitude, known.latitude, known.longitude) <= known.radiusMeters) {
      return { city: known.city, state: known.state };
    }
  }
  return null;
}

async function fetchBigDataLocalityHint(bias: LocationBias): Promise<LocalityHint | null> {
  const url = new URL(BIGDATA_REVERSE_URL);
  url.searchParams.set("latitude", bias.latitude.toFixed(6));
  url.searchParams.set("longitude", bias.longitude.toFixed(6));
  url.searchParams.set("localityLanguage", "en");

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-locality contact@quotexinsurance.com",
      },
    });
    if (!upstream.ok) return null;
    const data = (await safeReadJson(upstream)) as BigDataReverseResponse;
    const city = clean(data.locality) || clean(data.city);
    const state =
      clean(data.principalSubdivisionCode).replace(/^US-/i, "") ||
      stateNameToCode(clean(data.principalSubdivision));
    if (city || state) return { city, state };
  } catch (error) {
    console.error("[photon-autocomplete] bigdata reverse lookup failed", error);
  }
  return null;
}

async function fetchPhotonLocalityHint(bias: LocationBias): Promise<LocalityHint | null> {
  const url = new URL(PHOTON_REVERSE_URL);
  url.searchParams.set("lat", bias.latitude.toFixed(6));
  url.searchParams.set("lon", bias.longitude.toFixed(6));
  url.searchParams.set("lang", "en");

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-locality contact@quotexinsurance.com",
      },
    });
    if (!upstream.ok) return null;
    const data = (await safeReadJson(upstream)) as { features?: PhotonFeature[] };
    for (const feature of data.features ?? []) {
      const p = feature.properties ?? {};
      const city = clean(p.city) || clean(p.locality) || clean(p.district) || clean(p.county);
      const state = stateNameToCode(clean(p.state));
      if (city || state) return { city, state };
    }
  } catch (error) {
    console.error("[photon-autocomplete] photon reverse lookup failed", error);
  }
  return null;
}

async function fetchNominatimLocalityHint(bias: LocationBias): Promise<LocalityHint | null> {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "14");
  url.searchParams.set("lat", bias.latitude.toFixed(6));
  url.searchParams.set("lon", bias.longitude.toFixed(6));

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-locality contact@quotexinsurance.com",
      },
    });
    if (upstream.ok) {
      const data = (await safeReadJson(upstream)) as NominatimReverseResponse;
      const address = data.address ?? {};
      const city = clean(address.city) || clean(address.town) || clean(address.village) || clean(address.hamlet);
      const state =
        clean(address["ISO3166-2-lvl4"]).replace(/^US-/i, "") || stateNameToCode(clean(address.state));
      if (city || state) return { city, state };
    }
  } catch (error) {
    console.error("[photon-autocomplete] locality reverse lookup failed", error);
  }
  return null;
}

function toPrediction(feature: PhotonFeature, query: string): AddressPrediction | null {
  const p = feature.properties ?? {};
  if (p.countrycode && p.countrycode.toUpperCase() !== "US") return null;
  if (isDisallowedPoi(p.osm_key)) return null;

  const typedHouseNumber = extractLeadingHouseNumber(query);
  const providerHouseNumber = clean(p.housenumber);
  const providerStreet = clean(p.street);
  const providerName = clean(p.name);
  const street = providerStreet || (isRoadFeature(p.osm_key) ? providerName : "");
  if (!street) return null;
  if (looksLikeNonAddressRoad(street)) return null;

  const houseNumber =
    providerHouseNumber || (typedHouseNumber && queryHasStreetText(query) ? typedHouseNumber : "");
  if (!houseNumber) return null;

  const queryRoad = query
    .replace(/^\s*\d+[A-Za-z]?\s+/, "")
    .split(",")[0]
    .trim();
  if (queryRoad && queryHasStreetText(query) && !normalizeForPrefix(street).startsWith(normalizeForPrefix(queryRoad))) {
    return null;
  }
  if (queryRoad && !typedHouseNumber && !normalizeForPrefix(street).startsWith(normalizeForPrefix(queryRoad))) {
    return null;
  }
  if (!queryHasStreetText(query) && typedHouseNumber && !houseNumber.startsWith(typedHouseNumber)) {
    return null;
  }

  const city = clean(p.city) || clean(p.locality) || clean(p.district) || clean(p.county);
  const state = stateNameToCode(clean(p.state));
  const zip = compatibleZipForState(clean(p.postcode), state);
  const description = [`${houseNumber} ${street}`.trim(), city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  if (!description) return null;

  const idSeed = [p.osm_type, p.osm_id, description].filter(Boolean).join(":");
  return {
    id: idSeed || description,
    description,
  };
}

function isDisallowedPoi(osmKey: unknown): boolean {
  return DISALLOWED_OSM_KEYS.has(clean(osmKey).toLowerCase());
}

function isRoadFeature(osmKey: unknown): boolean {
  return clean(osmKey).toLowerCase() === "highway";
}

function looksLikeNonAddressRoad(street: string): boolean {
  const normalized = normalizeForPrefix(street);
  return NON_ADDRESS_ROAD_PATTERNS.some((pattern) => pattern.test(normalized));
}

function dedupePredictions(predictions: AddressPrediction[]): AddressPrediction[] {
  const seen = new Set<string>();
  const out: AddressPrediction[] = [];
  for (const prediction of predictions) {
    const key = prediction.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prediction);
  }
  return out;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function extractLeadingHouseNumber(query: string): string {
  return query.trim().match(/^(\d+[A-Za-z]?)(?:\s+|$)/)?.[1] ?? "";
}

function queryHasStreetText(query: string): boolean {
  return /^\s*\d+[A-Za-z]?\s+[A-Za-z0-9]/.test(query);
}

function parseLeadingHouseAndRoad(query: string): { houseNumber: string; roadPrefix: string } | null {
  const match = query.trim().match(/^(\d+[A-Za-z]?)\s+([^,]{1,})/);
  if (!match) return null;
  return { houseNumber: match[1], roadPrefix: match[2].trim() };
}

function buildStructuredPhotonUrl(query: string, bias: LocationBias | null): URL | null {
  const match = query.trim().match(/^(\d+[A-Za-z]?)\s+([^,]+?)(?:,\s*([^,]+))?(?:,\s*([A-Za-z]{2}))?(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (!match) return null;
  const [, housenumber, rawStreet, rawCity, rawState, rawZip] = match;
  const street = clean(rawStreet);
  if (!housenumber || !street) return null;

  const url = new URL(PHOTON_AUTOCOMPLETE_URL);
  url.pathname = url.pathname.replace(/\/api\/?$/, "/structured");
  if (!url.pathname.endsWith("/structured")) {
    url.pathname = "/structured";
  }
  url.searchParams.set("countrycode", "US");
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  url.searchParams.set("housenumber", housenumber);
  url.searchParams.set("street", street);
  if (rawCity) url.searchParams.set("city", clean(rawCity));
  if (rawState) url.searchParams.set("state", stateNameToCode(clean(rawState)));
  if (rawZip) url.searchParams.set("postcode", clean(rawZip));
  if (bias) {
    url.searchParams.set("lat", String(bias.latitude));
    url.searchParams.set("lon", String(bias.longitude));
    url.searchParams.set("zoom", radiusToPhotonZoom(bias.radiusMeters ?? 50_000));
    url.searchParams.set("location_bias_scale", "0.0");
    url.searchParams.set("bbox", photonBoundingBox(bias));
  }
  return url;
}

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

const STREET_SUFFIX_ALIASES: Record<string, string> = {
  ave: "avenue",
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
  st: "street",
  street: "street",
  ter: "terrace",
  terrace: "terrace",
  trl: "trail",
  trail: "trail",
  way: "way",
};

const DISALLOWED_OSM_KEYS = new Set([
  "amenity",
  "craft",
  "emergency",
  "healthcare",
  "leisure",
  "office",
  "shop",
  "tourism",
]);

const NON_ADDRESS_ROAD_PATTERNS = [
  /\bdrive through\b/,
  /\bdrive thru\b/,
  /\bdriveway\b/,
  /\bparking\b/,
  /\bentrance\b/,
  /\bramp\b/,
  /\bservice\b/,
];

const KNOWN_LOCALITY_HINTS = [
  { city: "Northville", state: "MI", latitude: 42.4314, longitude: -83.483, radiusMeters: 35_000 },
  { city: "Palm Coast", state: "FL", latitude: 29.5845, longitude: -81.2079, radiusMeters: 50_000 },
  { city: "Jacksonville", state: "FL", latitude: 30.3322, longitude: -81.6557, radiusMeters: 50_000 },
  { city: "Miami", state: "FL", latitude: 25.7617, longitude: -80.1918, radiusMeters: 50_000 },
  { city: "Atlanta", state: "GA", latitude: 33.749, longitude: -84.388, radiusMeters: 50_000 },
  { city: "Chicago", state: "IL", latitude: 41.8781, longitude: -87.6298, radiusMeters: 50_000 },
];

function normalizeLocationBias(value: unknown): LocationBias | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LocationBias>;
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  const radiusMeters = Number(candidate.radiusMeters ?? 50_000);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    radiusMeters: Math.min(50_000, Math.max(1_000, Number.isFinite(radiusMeters) ? radiusMeters : 50_000)),
  };
}

function widenLocationBias(bias: LocationBias, radiusMeters: number): LocationBias {
  return {
    ...bias,
    radiusMeters: Math.min(50_000, Math.max(bias.radiusMeters ?? 0, radiusMeters)),
  };
}

function clampLocationBiasRadius(bias: LocationBias, radiusMeters: number): LocationBias {
  return {
    ...bias,
    radiusMeters: Math.min(bias.radiusMeters ?? radiusMeters, radiusMeters),
  };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function photonBoundingBox(bias: LocationBias): string {
  const radiusMeters = bias.radiusMeters ?? 15_000;
  const latDelta = radiusMeters / 111_320;
  const lonScale = Math.max(0.2, Math.cos((bias.latitude * Math.PI) / 180));
  const lonDelta = radiusMeters / (111_320 * lonScale);
  const minLon = Math.max(-180, bias.longitude - lonDelta);
  const minLat = Math.max(-90, bias.latitude - latDelta);
  const maxLon = Math.min(180, bias.longitude + lonDelta);
  const maxLat = Math.min(90, bias.latitude + latDelta);
  return [minLon, minLat, maxLon, maxLat].map((n) => n.toFixed(6)).join(",");
}

function radiusToPhotonZoom(radiusMeters: number): string {
  if (radiusMeters <= 5_000) return "14";
  if (radiusMeters <= 15_000) return "13";
  if (radiusMeters <= 30_000) return "12";
  return "11";
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};

function stateNameToCode(name: string): string {
  if (!name) return "";
  if (/^[A-Z]{2}$/.test(name)) return name;
  return STATE_NAME_TO_CODE[name] ?? "";
}

const STATE_ZIP_PREFIXES: Record<string, string[]> = {
  AL: ["35", "36"],
  AK: ["99"],
  AZ: ["85", "86"],
  AR: ["71", "72"],
  CA: ["90", "91", "92", "93", "94", "95", "96"],
  CO: ["80", "81"],
  CT: ["06"],
  DE: ["19"],
  DC: ["20"],
  FL: ["32", "33", "34"],
  GA: ["30", "31", "398", "399"],
  HI: ["96"],
  ID: ["83"],
  IL: ["60", "61", "62"],
  IN: ["46", "47"],
  IA: ["50", "51", "52"],
  KS: ["66", "67"],
  KY: ["40", "41", "42"],
  LA: ["70", "71"],
  ME: ["03", "04"],
  MD: ["20", "21"],
  MA: ["01", "02"],
  MI: ["48", "49"],
  MN: ["55", "56"],
  MS: ["38", "39"],
  MO: ["63", "64", "65"],
  MT: ["59"],
  NE: ["68", "69"],
  NV: ["88", "89"],
  NH: ["03"],
  NJ: ["07", "08"],
  NM: ["87", "88"],
  NY: ["10", "11", "12", "13", "14"],
  NC: ["27", "28"],
  ND: ["58"],
  OH: ["43", "44", "45"],
  OK: ["73", "74"],
  OR: ["97"],
  PA: ["15", "16", "17", "18", "19"],
  RI: ["02"],
  SC: ["29"],
  SD: ["57"],
  TN: ["37", "38"],
  TX: ["75", "76", "77", "78", "79", "885"],
  UT: ["84"],
  VT: ["05"],
  VA: ["20", "22", "23", "24"],
  WA: ["98", "99"],
  WV: ["24", "25", "26"],
  WI: ["53", "54"],
  WY: ["82", "83"],
};

function compatibleZipForState(zip: string, state: string): string {
  const cleaned = zip.match(/\d{5}/)?.[0] ?? "";
  if (!cleaned || !state) return cleaned;
  const prefixes = STATE_ZIP_PREFIXES[state];
  if (!prefixes) return cleaned;
  return prefixes.some((prefix) => cleaned.startsWith(prefix)) ? cleaned : "";
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}

export const __PHOTON_AUTOCOMPLETE_URL = PHOTON_AUTOCOMPLETE_URL;
