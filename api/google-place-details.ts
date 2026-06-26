// Server-side Google Place Details proxy.
//
// Used after a user selects an autocomplete row so the app can fill
// Street / Apt / City / State / ZIP from Google's structured components
// without exposing the API key in the browser.

import { applyRateLimit } from "./_rateLimit.js";

const GOOGLE_PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places/";

interface RequestPayload {
  placeId?: string;
  sessionToken?: string;
}

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlaceDetailsResponse {
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
}

interface AddressParts {
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (
    !(await applyRateLimit(req, res, "google-place-details", {
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
  const placeId = normalizeQuery(body.placeId);
  if (!placeId) {
    res.status(400).json({ error: "missing_place_id" });
    return;
  }

  const url = new URL(`${GOOGLE_PLACE_DETAILS_BASE}${encodeURIComponent(placeId)}`);
  const sessionToken = normalizeQuery(body.sessionToken);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "formattedAddress,addressComponents",
      },
    });
  } catch (error) {
    console.error("[google-place-details] upstream fetch failed", error);
    res.status(502).json({ error: "google_places_unreachable" });
    return;
  }

  if (!upstream.ok) {
    const payload = await safeReadJson(upstream);
    console.error("[google-place-details] upstream HTTP", upstream.status, payload);
    res.status(upstream.status === 429 ? 429 : 502).json({
      error: upstream.status === 429 ? "google_places_rate_limited" : "google_places_upstream_error",
      status: upstream.status,
    });
    return;
  }

  const data = (await safeReadJson(upstream)) as GooglePlaceDetailsResponse;
  res.status(200).json({
    formattedAddress: data.formattedAddress?.replace(/,\s*USA$/i, "").trim() ?? "",
    parts: parseGoogleAddressComponents(data.addressComponents ?? []),
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

function pickComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  prefer: "long" | "short" = "long"
): string {
  const c = components?.find((item) => (item.types ?? []).includes(type));
  if (!c) return "";
  return (prefer === "short" ? c.shortText : c.longText) ?? "";
}

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

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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

export const __GOOGLE_PLACE_DETAILS_BASE = GOOGLE_PLACE_DETAILS_BASE;
