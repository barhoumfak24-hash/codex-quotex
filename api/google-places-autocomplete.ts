// Server-side Google Places autocomplete proxy.
//
// The browser should not need a Google API key for address autocomplete.
// This endpoint keeps the key on the server, asks Google Places for US
// street-level predictions, and returns only the small shape the UI needs.

import { applyRateLimit } from "./_rateLimit.js";

const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

interface RequestPayload {
  query?: string;
  sessionToken?: string;
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

interface GooglePrediction {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
  };
}

interface AddressPrediction {
  id: string;
  description: string;
  googlePlaceId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (
    !(await applyRateLimit(req, res, "google-places-autocomplete", {
      windowMs: 60_000,
      limit: 180,
      failOpen: true,
    }))
  ) {
    return;
  }

  const key = googlePlacesKey();
  if (!key) {
    res.status(503).json({ error: "google_places_not_configured" });
    return;
  }

  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const query = normalizeQuery(body.query);
  if (query.length < 2) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const locationBias = normalizeLocationBias(body.locationBias) ?? normalizeLocationBias(body);
  const googleLocationArea = locationBias
    ? {
        circle: {
          center: {
            latitude: locationBias.latitude,
            longitude: locationBias.longitude,
          },
          radius: locationBias.radiusMeters,
        },
      }
    : null;
  const locationConstraintKey = shouldUseLocationRestriction(query)
    ? "locationRestriction"
    : "locationBias";
  let upstream: Response;
  try {
    upstream = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input: query,
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        includedRegionCodes: ["us"],
        sessionToken: normalizeQuery(body.sessionToken) || undefined,
        ...(googleLocationArea ? { [locationConstraintKey]: googleLocationArea } : {}),
      }),
    });
  } catch (error) {
    console.error("[google-places-autocomplete] upstream fetch failed", error);
    res.status(502).json({ error: "google_places_unreachable" });
    return;
  }

  if (!upstream.ok) {
    const payload = await safeReadJson(upstream);
    console.error("[google-places-autocomplete] upstream HTTP", upstream.status, payload);
    res.status(upstream.status === 429 ? 429 : 502).json({
      error: upstream.status === 429 ? "google_places_rate_limited" : "google_places_upstream_error",
      status: upstream.status,
    });
    return;
  }

  const data = (await safeReadJson(upstream)) as { suggestions?: GooglePrediction[] };
  res.status(200).json({
    suggestions: (data.suggestions ?? []).map(toPrediction).filter(Boolean),
  });
}

function googlePlacesKey(): string {
  return (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_GEOCODING_API_KEY ||
    ""
  ).trim();
}

function toPrediction(s: GooglePrediction): AddressPrediction | null {
  const placeId = s.placePrediction?.placeId?.trim();
  const text = s.placePrediction?.text?.text?.replace(/,\s*USA$/i, "").trim();
  if (!placeId || !text) return null;
  return { id: placeId, description: text, googlePlaceId: placeId };
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function shouldUseLocationRestriction(query: string): boolean {
  return /^\d{2,6}$/.test(normalizeQuery(query));
}

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

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}

export const __GOOGLE_AUTOCOMPLETE_URL = GOOGLE_AUTOCOMPLETE_URL;
