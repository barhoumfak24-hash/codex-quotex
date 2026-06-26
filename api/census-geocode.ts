// Server-side U.S. Census Geocoder proxy.
//
// Census is a free, no-key verifier for complete U.S. addresses. It is
// not a per-keystroke autocomplete engine, so the frontend calls this
// only after the input looks complete enough to verify.

import { applyRateLimit } from "./_rateLimit.js";

const CENSUS_ONE_LINE_BASE =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

interface RequestPayload {
  query?: string;
}

interface CensusMatch {
  matchedAddress?: string;
}

interface CensusResponse {
  result?: {
    addressMatches?: CensusMatch[];
  };
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
    !(await applyRateLimit(req, res, "census-geocode", {
      windowMs: 60_000,
      limit: 60,
      failOpen: true,
    }))
  ) {
    return;
  }

  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const query = normalizeQuery(body.query);
  if (query.length < 12) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const url = new URL(CENSUS_ONE_LINE_BASE);
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  let upstream: Response;
  try {
    upstream = await fetch(url.toString());
  } catch (error) {
    console.error("[census-geocode] upstream fetch failed", error);
    res.status(502).json({ error: "census_unreachable" });
    return;
  }

  if (!upstream.ok) {
    console.error("[census-geocode] upstream HTTP", upstream.status);
    res.status(502).json({ error: "census_upstream_error", status: upstream.status });
    return;
  }

  let data: CensusResponse;
  try {
    data = (await upstream.json()) as CensusResponse;
  } catch (error) {
    console.error("[census-geocode] failed to parse Census JSON", error);
    res.status(502).json({ error: "census_bad_response" });
    return;
  }

  const suggestions = (data.result?.addressMatches ?? [])
    .map((match) => match.matchedAddress)
    .filter((address): address is string => Boolean(address))
    .map(toPrediction);

  res.status(200).json({ suggestions });
}

function toPrediction(address: string): AddressPrediction {
  const description = formatCensusMatchedAddress(address);
  return {
    id: description.replace(/\s+/g, "_"),
    description,
  };
}

function formatCensusMatchedAddress(address: string): string {
  const normalized = address.replace(/\s+/g, " ").trim();
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 4) {
    const [street, city, state, zip] = parts;
    const tail = [state.toUpperCase(), zip].filter(Boolean).join(" ");
    return [titleCaseAddress(street), titleCaseAddress(city), tail].filter(Boolean).join(", ");
  }
  return titleCaseAddress(normalized);
}

function titleCaseAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, letter) => `Mc${letter.toUpperCase()}`)
    .replace(/,\s*([A-Z][a-z])(?=,|\s+\d{5})/g, (_m, state) => `, ${state.toUpperCase()}`)
    .replace(/\b(\d{5})(?:-(\d{4}))?\b/g, (_m, zip, plus4) => (plus4 ? `${zip}-${plus4}` : zip));
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}

export const __CENSUS_ONE_LINE_BASE = CENSUS_ONE_LINE_BASE;
