import { applyRateLimit } from "./_rateLimit.js";

const NOMINATIM_SEARCH_URL =
  process.env.NOMINATIM_SEARCH_URL || "https://nominatim.openstreetmap.org/search";

interface RequestPayload {
  query?: string;
  locationBias?: unknown;
}

interface LocationBias {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

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
  "ISO3166-2-lvl4"?: string;
}

interface NominatimResult {
  place_id: number;
  display_name?: string;
  address?: NominatimAddress;
}

interface AddressPrediction {
  id: string;
  description: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (
    !(await applyRateLimit(req, res, "nominatim-search", {
      windowMs: 60_000,
      limit: 120,
      failOpen: true,
    }))
  ) {
    return;
  }

  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const query = normalizeQuery(body.query);
  if (query.length < 8 || !queryHasStreetText(query)) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", query);

  const bias = normalizeLocationBias(body.locationBias);
  if (bias) {
    url.searchParams.set("viewbox", viewbox(bias));
    url.searchParams.set("bounded", "0");
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": "QuotexInsurance/1.0 address-geocoder contact@quotexinsurance.com",
      },
    });
  } catch (error) {
    console.error("[nominatim-search] upstream fetch failed", error);
    res.status(502).json({ error: "nominatim_unreachable" });
    return;
  }

  if (!upstream.ok) {
    console.error("[nominatim-search] upstream HTTP", upstream.status);
    res.status(upstream.status === 429 ? 429 : 503).json({
      error: upstream.status === 429 ? "nominatim_rate_limited" : "nominatim_unavailable",
      status: upstream.status,
    });
    return;
  }

  let data: NominatimResult[] = [];
  try {
    data = (await upstream.json()) as NominatimResult[];
  } catch (error) {
    console.error("[nominatim-search] bad JSON", error);
    res.status(502).json({ error: "nominatim_bad_response" });
    return;
  }

  const suggestions = dedupe(
    (Array.isArray(data) ? data : [])
      .map((row) => toPrediction(row, query))
      .filter((item): item is AddressPrediction => item !== null)
  ).slice(0, 6);

  res.status(200).json({ suggestions });
}

function toPrediction(row: NominatimResult, query: string): AddressPrediction | null {
  const description = formatAddress(row, query);
  if (!description) return null;
  return { id: String(row.place_id), description };
}

function formatAddress(row: NominatimResult, query: string): string {
  const address = row.address ?? {};
  const typedHouseNumber = extractLeadingHouseNumber(query);
  const providerHouseNumber = clean(address.house_number);
  const road = clean(address.road);
  if (!road) return "";

  const houseNumber = providerHouseNumber || typedHouseNumber;
  if (!houseNumber) return "";

  const queryRoad = query
    .replace(/^\s*\d+[A-Za-z]?\s+/, "")
    .split(",")[0]
    .trim();
  if (queryRoad && !normalizeForPrefix(road).startsWith(normalizeForPrefix(queryRoad))) {
    return "";
  }

  const city =
    clean(address.city) ||
    clean(address.town) ||
    clean(address.village) ||
    clean(address.hamlet) ||
    clean(address.county);
  const state = clean(address["ISO3166-2-lvl4"]).replace(/^US-/i, "") || stateNameToCode(clean(address.state));
  const zip = clean(address.postcode);
  const tail = [state, zip].filter(Boolean).join(" ");
  return [`${houseNumber} ${road}`.trim(), city, tail].filter(Boolean).join(", ");
}

function dedupe(items: AddressPrediction[]): AddressPrediction[] {
  const seen = new Set<string>();
  const out: AddressPrediction[] = [];
  for (const item of items) {
    const key = item.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function extractLeadingHouseNumber(query: string): string {
  return query.trim().match(/^(\d+[A-Za-z]?)(?:\s+|$)/)?.[1] ?? "";
}

function queryHasStreetText(query: string): boolean {
  return /^\s*\d+[A-Za-z]?\s+[A-Za-z0-9]/.test(query);
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

function normalizeLocationBias(value: unknown): LocationBias | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LocationBias>;
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  const radiusMeters = Number(candidate.radiusMeters ?? 15_000);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    radiusMeters: Math.min(50_000, Math.max(1_000, Number.isFinite(radiusMeters) ? radiusMeters : 15_000)),
  };
}

function viewbox(bias: LocationBias): string {
  const radiusMeters = bias.radiusMeters ?? 15_000;
  const latDelta = radiusMeters / 111_320;
  const lonScale = Math.max(0.2, Math.cos((bias.latitude * Math.PI) / 180));
  const lonDelta = radiusMeters / (111_320 * lonScale);
  const west = Math.max(-180, bias.longitude - lonDelta);
  const east = Math.min(180, bias.longitude + lonDelta);
  const south = Math.max(-90, bias.latitude - latDelta);
  const north = Math.min(90, bias.latitude + latDelta);
  return `${west},${north},${east},${south}`;
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

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}
