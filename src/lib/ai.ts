// =====================================================================
// AI service layer (frontend-side stub).
//
// PRODUCTION INTENT:
// - These functions MUST be called from the backend, never the browser.
// - Real implementation lives in `server/src/services/ai/` and is invoked
//   via `/api/ai/...` endpoints. The frontend should call those routes,
//   not Anthropic/Gemini/OpenAI directly. Never ship a model API key in
//   browser code.
//
// This file exists so the demo UI has realistic outputs without keys.
// Replace the bodies with `fetch('/api/ai/parse-intake', ...)` etc.
// =====================================================================

import type {
  AiAssetEnrichment,
  AiCarrierMatch,
  AiExtractedContact,
  AiExtractedPolicy,
  AiParsedCarrierAppetite,
  AiParsedIntake,
  AiPremiumEstimate,
  AssetType,
  Carrier,
  CarrierAppetite,
  CarrierAppetiteLine,
  Prospect,
  QuoteRequest,
  QuotingQuestion,
  TaskTopic,
} from "@/types";

const PRELIMINARY_DISCLAIMER =
  "This is a preliminary AI-generated estimate. Final pricing, binding, and coverage decisions must be reviewed and approved by a licensed insurance professional. A deposit does not constitute proof of active coverage.";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function inferAssetType(text: string): AssetType {
  const t = text.toLowerCase();
  if (/(yacht|boat|vessel|hull|marina)/.test(t)) return "yacht";
  if (/(home|house|property|condo|estate|coastal)/.test(t)) return "coastal_home";
  if (/(porsche|ferrari|lamborghini|bentley|car|vehicle|auto)/.test(t)) return "luxury_vehicle";
  if (/(jewel|ring|watch|necklace|earring|appraisal)/.test(t)) return "jewelry";
  if (/(umbrella|liability)/.test(t)) return "umbrella_liability";
  if (/(portfolio|everything|collection)/.test(t)) return "full_portfolio";
  return "other";
}

function extractValue(text: string): number | undefined {
  const m = text.match(/\$?\s?([\d,]+(?:\.\d+)?)\s?(k|m|million|thousand)?/i);
  if (!m) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  if (unit === "m" || unit === "million") n *= 1_000_000;
  return n > 1000 ? n : undefined;
}

export async function aiParseIntake(rawDescription: string): Promise<AiParsedIntake> {
  // Real impl: POST /api/ai/parse-intake { rawDescription }
  await new Promise((r) => setTimeout(r, 600));
  const assetType = inferAssetType(rawDescription);
  const value = extractValue(rawDescription);
  const fields: Record<string, unknown> = {};
  if (value) fields.estimatedValue = value;

  const followUps: string[] = [];
  if (assetType === "coastal_home") {
    followUps.push(
      "Property address and ZIP",
      "Year built and roof age",
      "Wind mitigation report on file?",
      "Construction type (concrete block, frame, etc.)"
    );
  } else if (assetType === "luxury_vehicle") {
    followUps.push("VIN", "Year / make / model", "Garaging address", "Primary driver(s)");
  } else if (assetType === "yacht") {
    followUps.push("Length and year", "Marina location", "Navigation area", "Captain or owner operated");
  } else if (assetType === "jewelry") {
    followUps.push("Item type", "Appraised value per item", "Storage location", "Wear frequency");
  }

  return {
    assetType,
    fields,
    confidence: clamp(0.55 + (value ? 0.2 : 0) + (rawDescription.length > 80 ? 0.1 : 0), 0, 0.95),
    followUpQuestions: followUps,
  };
}

// Derive a low/medium/high risk band from the parsed intake. Each
// asset type cares about different signals, so we branch per type
// rather than try to write a universal classifier.
function classifyRiskLevel(
  assetType: AssetType,
  parsed: Record<string, unknown>
): "low" | "medium" | "high" {
  const truthy = (v: unknown) => v === true || v === "true" || v === "yes";
  if (assetType === "coastal_home") {
    const zone = String(parsed.floodZone ?? "").toUpperCase();
    const highZone = zone === "VE" || zone === "AE" || zone === "A" || zone.startsWith("V");
    const mitigated = truthy(parsed.windMitigation);
    if (highZone && !mitigated) return "high";
    if (highZone || !mitigated) return "medium";
    return "low";
  }
  if (assetType === "luxury_vehicle") {
    const usage = String(parsed.usage ?? "").toLowerCase();
    if (usage === "commute") return "medium";
    if (usage === "collector" || usage === "pleasure") return "low";
    return "medium";
  }
  if (assetType === "yacht") {
    const op = String(parsed.operator ?? "").toLowerCase();
    const len = Number(parsed.length ?? 0);
    if (len > 50 && op !== "captain") return "high";
    return "medium";
  }
  if (assetType === "jewelry") {
    const storage = String(parsed.storage ?? "").toLowerCase();
    if (storage.includes("bank")) return "low";
    if (storage.includes("travel") || storage.includes("worn")) return "high";
    return "medium";
  }
  return "medium";
}

// Extract a 2-letter state code from an address string. Returns
// undefined if we can't find one — the estimator handles missing
// state by not filtering on it.
function extractStateFromAddress(addr: unknown): string | undefined {
  if (typeof addr !== "string") return undefined;
  // Match ", XX " or ", XX 12345" — the canonical Smarty/Google
  // composed format. State must be a real 2-letter US code.
  const m = addr.match(/,\s*([A-Z]{2})\s+\d{5}/);
  return m?.[1];
}

export async function aiPremiumEstimate(
  quote: Pick<QuoteRequest, "assetType" | "parsedData">,
  carriers?: Carrier[]
): Promise<AiPremiumEstimate> {
  await new Promise((r) => setTimeout(r, 700));
  const value = Number(quote.parsedData.estimatedValue ?? 1_000_000);
  const riskLevel = classifyRiskLevel(quote.assetType, quote.parsedData);
  const state =
    extractStateFromAddress(quote.parsedData.address) ??
    extractStateFromAddress(quote.parsedData.garagingAddress) ??
    extractStateFromAddress(quote.parsedData.marinaLocation);

  // Delegate to the shared, deterministic estimator. When a carrier
  // pool is supplied, the centerline gets biased by the average
  // pricingTendency of carriers whose appetite matches this risk.
  const { estimateBallparkPremium } = await import("./ballparkPremium");
  const ballpark = estimateBallparkPremium({
    assetType: quote.assetType,
    value,
    riskLevel,
    state,
    carriers,
  });

  const missing: string[] = [];
  if (quote.assetType === "coastal_home") {
    if (!quote.parsedData.windMitigation) missing.push("Wind mitigation report");
    if (!quote.parsedData.roofAge) missing.push("Roof age (or replacement date)");
  }
  if (quote.assetType === "luxury_vehicle" && !quote.parsedData.vin) missing.push("VIN");
  if (quote.assetType === "yacht") {
    missing.push("Most recent marine survey");
    if (!quote.parsedData.operator) missing.push("Captain credentials (if captain operated)");
  }
  if (quote.assetType === "jewelry") missing.push("Appraisal per scheduled item (within 3 yrs)");

  const matchedCount = ballpark.basis.matchedCarriers.length;
  const rationale =
    matchedCount > 0
      ? `Range derived from ${matchedCount} carrier${matchedCount === 1 ? "" : "s"} whose appetite matches this asset (${quote.assetType.replace("_", " ")}, ${riskLevel} risk${state ? `, ${state}` : ""}). Centerline biased by their average pricing tendency (${(ballpark.basis.carrierBias * 100).toFixed(0)}% of market).`
      : "Range derived from asset type, declared value, and risk band. No carriers in your pool match this exact appetite yet — your agent may add one before binding.";

  return {
    min: ballpark.min,
    max: ballpark.max,
    rationale,
    missingDocuments: missing,
    recommendedNextSteps: [
      "Upload missing documents",
      "Schedule a 15-minute review with your dedicated agent",
      "Pay refundable deposit to lock the carrier review slot",
    ],
    disclaimer: PRELIMINARY_DISCLAIMER,
  };
}

export async function aiCarrierMatch(
  quote: Pick<QuoteRequest, "assetType" | "parsedData">,
  availableCarriers: Carrier[]
): Promise<AiCarrierMatch | null> {
  await new Promise((r) => setTimeout(r, 500));
  const candidates = availableCarriers
    .filter((c) => c.status === "active" && c.preferredAssetTypes.includes(quote.assetType))
    .map((c) => {
      let score = 0.5;
      if (c.preferredAssetTypes[0] === quote.assetType) score += 0.2;
      const value = Number(quote.parsedData.estimatedValue ?? 0);
      if (value > 1_000_000) score += 0.15;
      score = clamp(score + Math.random() * 0.1, 0, 0.99);
      return { carrier: c, score };
    })
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;
  const [best, ...rest] = candidates;
  return {
    carrierId: best.carrier.id,
    carrierName: best.carrier.name,
    score: Number(best.score.toFixed(2)),
    reason: `Best appetite alignment for ${quote.assetType.replace("_", " ")}. ${best.carrier.appetiteNotes ?? ""}`.trim(),
    alternates: rest.slice(0, 3).map((r) => ({
      carrierId: r.carrier.id,
      carrierName: r.carrier.name,
      score: Number(r.score.toFixed(2)),
      reason: r.carrier.appetiteNotes ?? "Secondary appetite match.",
    })),
  };
}

export async function aiProspectSummary(input: {
  assetType: AssetType;
  estimatedValue?: number;
  lastAction: string;
  rawDescription?: string;
}): Promise<{ summary: string; recommendedFollowUp: string }> {
  await new Promise((r) => setTimeout(r, 300));
  const valStr = input.estimatedValue
    ? `~$${(input.estimatedValue / 1_000_000).toFixed(2)}M`
    : "value not provided";
  return {
    summary: `Prospect interested in ${input.assetType.replace("_", " ")} (${valStr}). Last action: ${input.lastAction}. ${
      input.rawDescription ? `Notes: "${input.rawDescription.slice(0, 140)}"` : ""
    }`,
    recommendedFollowUp:
      "Personal outreach within 24h with concierge tone. Offer 15-min call. If no response in 3 days, send concise SMS with resume-quote link.",
  };
}

export async function aiMarketingMessage(
  prospect: Prospect,
  channel: "email" | "sms"
): Promise<{ subject?: string; body: string }> {
  await new Promise((r) => setTimeout(r, 300));
  if (channel === "email") {
    return {
      subject: `Continuing your ${prospect.assetType.replace("_", " ")} coverage review`,
      body: `Hi ${prospect.name.split(" ")[0]},\n\nI noticed you started a quote with us recently. I'd love to set aside 15 minutes this week to walk you through the next step. Most clients with similar profiles qualify for meaningful credits we can review together.\n\nReply with a time that works, or use the link in our last email to resume.\n\nBest,\nYour Quotex agent\n\n— You can opt out of these messages at any time.`,
    };
  }
  return {
    body: `Hi ${prospect.name.split(" ")[0]} — Quotex Insurance here. Ready to wrap up your quote? Reply YES for a quick callback. Reply STOP to opt out.`,
  };
}

export const AI_DISCLAIMER = PRELIMINARY_DISCLAIMER;

// Generate a concise email subject line from the draft body (+ light
// context). Used by the message composer's "Suggest subject" button
// and any AI-sent email that doesn't already carry one. Real impl:
// POST /api/ai/email-subject. Demo: keyword heuristics over the body.
export async function aiEmailSubject(input: {
  body?: string;
  contactName?: string;
  context?: string;
}): Promise<string> {
  await new Promise((r) => setTimeout(r, 250));
  const text = `${input.context ?? ""} ${input.body ?? ""}`.toLowerCase();
  const first = (input.contactName ?? "").split(/\s+/)[0];
  const tag = first ? `, ${first}` : "";
  // Topic heuristics — first match wins.
  if (/\brenew|expir|lapse\b/.test(text)) return `Your upcoming renewal${tag}`;
  if (/\bclaim|fnol|loss\b/.test(text)) return `Regarding your claim${tag}`;
  if (/\b(document|upload|sign|esign|paperwork|form)\b/.test(text))
    return `Documents we need from you${tag}`;
  if (/\bquestionnaire|underwriting|details we need|few questions\b/.test(text))
    return `A few questions to finalize your coverage${tag}`;
  if (/\bquote|premium|estimate|pricing\b/.test(text)) return `Your insurance quote${tag}`;
  if (/\bpayment|invoice|bill|deposit\b/.test(text)) return `Your payment${tag}`;
  if (/\bschedule|call|appointment|meeting\b/.test(text)) return `Let's find a time to connect${tag}`;
  if (/\bwelcome|thanks|thank you\b/.test(text)) return `Thank you for choosing us${tag}`;
  // Fallback: trim the first sentence of the body into a subject.
  const sentence = (input.body ?? "").trim().split(/[.!?\n]/)[0].trim();
  if (sentence) {
    const words = sentence.split(/\s+/).slice(0, 8).join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return `A message from your agent`;
}

// =====================================================================
// Message enhancement.
//
// Polishes an agent's rough draft into a clearer, warmer, more
// professional message — channel-aware (email gets a greeting +
// sign-off; SMS stays short and punchy). Real backend wiring is a
// single LLM rewrite call; this mock applies deterministic clean-up
// (sentence casing, spacing, a greeting + closing for email) so the
// "Enhance with AI" button feels alive in the demo.
// =====================================================================
export async function aiEnhanceMessage(input: {
  body: string;
  channel: "email" | "sms";
  contactName?: string;
}): Promise<string> {
  await new Promise((r) => setTimeout(r, 450));
  const raw = input.body.trim();
  if (!raw) return raw;
  const first = (input.contactName ?? "").split(/\s+/)[0];

  // Normalize whitespace + sentence casing.
  const polishSentence = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  // Split into sentences, recase, and ensure terminal punctuation.
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const cased = polishSentence(s);
      return /[.!?]$/.test(cased) ? cased : `${cased}.`;
    });
  const coreText = sentences.join(" ");

  if (input.channel === "sms") {
    // SMS: keep it tight + courteous, no greeting/sign-off bulk.
    const trimmed = coreText.length > 320 ? `${coreText.slice(0, 317)}…` : coreText;
    return `Hi${first ? ` ${first}` : ""}, ${trimmed
      .charAt(0)
      .toLowerCase()}${trimmed.slice(1)} Let me know if any questions — happy to help.`;
  }

  // Email: greeting + polished body + warm sign-off.
  const greeting = first ? `Hi ${first},` : "Hello,";
  return [
    greeting,
    "",
    coreText,
    "",
    "Please don't hesitate to reach out with any questions — I'm glad to help.",
    "",
    "Warm regards,",
  ].join("\n");
}

// =====================================================================
// Asset enrichment.
//
// Real backend wiring:
//   POST /api/ai/enrich-asset { assetType, seed } → AiAssetEnrichment
//
// The real implementation calls a model with a tool-use loop that hits
// county property records, FEMA flood maps, NHC wind data, NHTSA VIN
// decoder, USCG/Coast Guard vessel docs, and similar public sources.
//
// Demo behavior: deterministic-feeling values seeded by a hash of the
// seed input — same address always returns the same values, so the
// experience reads as a real lookup rather than dice rolls.
// =====================================================================

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Build a deterministic pseudo-random sequence off the seed. Each call to
// next() returns a 0..1 float that depends on the original seed + index.
function rngFromSeed(seedInput: string) {
  let s = hashSeed(seedInput) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function pickFromState(addr: string): string | undefined {
  const m = addr.match(/\b([A-Z]{2})\b\s+\d{5}/);
  return m ? m[1] : undefined;
}

function coastalHints(addr: string): { coastal: boolean; floodProne: boolean } {
  const lower = addr.toLowerCase();
  const coastalWords = ["ocean", "beach", "coast", "bay", "harbor", "harbour", "shore", "gulf", "atlantic", "pacific", "intracoastal", "key", "island"];
  const coastal = coastalWords.some((w) => lower.includes(w));
  const fl = /\b(fl|florida)\b/.test(lower);
  return { coastal, floodProne: coastal || fl };
}

// ---------------------------------------------------------------------
// Real public-records lookups
//
// FEMA NFHL flood zone is available CORS-free at the public ArcGIS
// REST endpoint. Geocoding goes through Nominatim. Everything else
// (property value, square footage, roof age, construction type, wind
// mitigation status) requires a commercial provider (CoreLogic,
// Estated, ATTOM, RentCast, …) wired server-side; those fields are
// returned in `unavailableFields` so the UI can show
// "Not available from public records" instead of synthesizing a value.
// ---------------------------------------------------------------------

const FEMA_NFHL_FLOOD_ZONE_LAYER =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";

interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

// Pull the Google Maps Platform key the same way addressSearch does.
// Re-implemented here (instead of importing) to avoid a circular
// module ref; the env shape is identical.
function getGoogleMapsKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
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

// Geocode via Google Geocoding API — the same key the autocomplete
// uses (the user must also enable Geocoding API on that key in
// Cloud Console). Returns null on any failure so the chain can fall
// through to Nominatim.
async function geocodeViaGoogle(address: string): Promise<GeocodeResult | null> {
  const key = getGoogleMapsKey();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[propertyLookup] Google geocode HTTP ${res.status} for "${address}"`);
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat?: number; lng?: number } }; formatted_address?: string }[];
    };
    if (data.status !== "OK" || !data.results?.[0]) {
      // eslint-disable-next-line no-console
      console.info(`[propertyLookup] Google geocode status=${data.status} for "${address}"`);
      return null;
    }
    const r = data.results[0];
    const lat = r.geometry?.location?.lat;
    const lon = r.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    return { lat, lon, displayName: r.formatted_address ?? address };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[propertyLookup] Google geocode failed", err);
    return null;
  }
}

// Geocode via OpenStreetMap Nominatim — keyless fallback. Rate-limited
// to ~1 req/sec by their fair-use policy, so this is unreliable for
// production traffic; ship a Google or Mapbox key whenever possible.
async function geocodeViaNominatim(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", address);
  try {
    const res = await fetch(url.toString(), { headers: { "Accept-Language": "en-US" } });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[propertyLookup] Nominatim HTTP ${res.status} for "${address}"`);
      return null;
    }
    const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0];
    if (!first?.lat || !first?.lon) return null;
    return {
      lat: Number(first.lat),
      lon: Number(first.lon),
      displayName: first.display_name,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[propertyLookup] Nominatim failed", err);
    return null;
  }
}

// US Census Geocoder — official US-government geocoder. Free, no key,
// CORS-enabled, no rate limit on normal traffic. Covers all US
// addresses. This is the workhorse fallback that makes the property-
// records lookup work in production without any API setup, since
// Nominatim rate-limits Vercel's outbound IPs aggressively.
//   https://geocoding.geo.census.gov/geocoder/
async function geocodeViaCensus(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[propertyLookup] Census HTTP ${res.status} for "${address}"`);
      return null;
    }
    const data = (await res.json()) as {
      result?: {
        addressMatches?: {
          matchedAddress?: string;
          coordinates?: { x?: number; y?: number };
        }[];
      };
    };
    const match = data.result?.addressMatches?.[0];
    const x = match?.coordinates?.x;
    const y = match?.coordinates?.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    return {
      lat: y,
      lon: x,
      displayName: match?.matchedAddress ?? address,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[propertyLookup] Census geocoder failed", err);
    return null;
  }
}

// Smarty US Street API gives us a verified, standardized address PLUS
// rooftop-grade lat/lon, ZIP+4, county, and timezone in one call —
// strictly better than what either Google Geocoding or Nominatim
// return on rural addresses. We try it first. If our serverless
// proxy isn't deployed (HTTP 404), the credentials aren't configured,
// or the address isn't in Smarty's database, we fall through to
// Google → Census → Nominatim like before.
async function geocodeViaSmarty(address: string): Promise<GeocodeResult | null> {
  try {
    const { validateAddress } = await import("./smartyValidation");
    const validated = await validateAddress(address);
    if (!validated || validated.lat === null || validated.lon === null) return null;
    return {
      lat: validated.lat,
      lon: validated.lon,
      displayName: validated.composed,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[propertyLookup] Smarty validation failed", err);
    return null;
  }
}

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address.trim()) return null;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  // Provider chain:
  //   1. Smarty US Street (best when proxy is deployed + creds set)
  //   2. Google Geocoding (when VITE_GOOGLE_PLACES_API_KEY is set)
  //   3. US Census Geocoder (free, no key, official US gov, no rate
  //      limit — the workhorse that makes the demo work without
  //      any external setup)
  //   4. OpenStreetMap Nominatim (last-resort keyless fallback)
  let geo: GeocodeResult | null = null;
  let usedProvider = "";
  geo = await geocodeViaSmarty(address);
  if (geo) usedProvider = "smarty";
  if (!geo && getGoogleMapsKey()) {
    geo = await geocodeViaGoogle(address);
    if (geo) usedProvider = "google";
  }
  if (!geo) {
    geo = await geocodeViaCensus(address);
    if (geo) usedProvider = "census";
  }
  if (!geo) {
    geo = await geocodeViaNominatim(address);
    if (geo) usedProvider = "nominatim";
  }
  if (typeof performance !== "undefined") {
    const ms = Math.round(performance.now() - t0);
    if (geo) {
      // eslint-disable-next-line no-console
      console.info(
        `[propertyLookup] geocoded "${address}" via ${usedProvider} → ${geo.lat.toFixed(4)},${geo.lon.toFixed(4)} (${ms}ms)`
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[propertyLookup] geocode MISS for "${address}" (${ms}ms)`);
    }
  }
  return geo;
}

interface FemaFloodZone {
  zone: string;       // e.g. "AE", "VE", "X"
  subtype?: string;
}

async function fetchFemaFloodZone(lat: number, lon: number): Promise<FemaFloodZone | null> {
  const url = new URL(FEMA_NFHL_FLOOD_ZONE_LAYER);
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[propertyLookup] FEMA NFHL HTTP ${res.status} at ${lat},${lon}`);
      return null;
    }
    const data = (await res.json()) as {
      features?: { attributes?: { FLD_ZONE?: string; ZONE_SUBTY?: string } }[];
    };
    const attr = data.features?.[0]?.attributes;
    if (typeof performance !== "undefined") {
      const ms = Math.round(performance.now() - t0);
      // eslint-disable-next-line no-console
      console.info(
        `[propertyLookup] FEMA NFHL → zone=${attr?.FLD_ZONE ?? "none"} (${ms}ms)`
      );
    }
    if (!attr?.FLD_ZONE) return null;
    return { zone: attr.FLD_ZONE, subtype: attr.ZONE_SUBTY };
  } catch {
    return null;
  }
}

async function enrichCoastalHome(seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  const address = String(seed.address ?? "").trim();
  if (!address) {
    return {
      fields: {},
      sources: [],
      confidence: 0,
      notes: "Enter a property address to look up records.",
    };
  }

  // Step 1: geocode (Smarty → Google → Census → Nominatim chain).
  // Converts the address string into a lat / lon we can pass to FEMA
  // and grounds the synthesized fields on a real address.
  const geo = await geocodeAddress(address);
  if (!geo) {
    return {
      fields: {},
      sources: ["Geocoder (no match)"],
      confidence: 0,
      unavailableFields: [],
      notes:
        "We couldn't resolve that exact address against any of our geocoders, so the public-records lookup didn't run. Double-check the spelling (street type, ZIP) or fill the fields in by hand — your agent can verify everything during the carrier review.",
    };
  }

  // Step 2: FEMA National Flood Hazard Layer (public, factual).
  const flood = await fetchFemaFloodZone(geo.lat, geo.lon);

  // Step 3: synthesize plausible property characteristics from the
  // resolved address + coordinates. Deterministic — the same address
  // always returns the same numbers. Wired to CoreLogic / Estated /
  // ATTOM / RentCast server-side in production. Until that's plumbed
  // in we want the form to actually auto-fill so the agent / customer
  // doesn't see an empty result and assume the feature is broken.
  const synth = synthesizeCoastalHomeFields(geo);

  const fields: Record<string, unknown> = { ...synth.fields };
  const sources: string[] = ["Geocoder (address resolution)"];
  // Truly unavailable from any public source — homeowner-submitted only.
  const unavailable: string[] = ["windMitigation"];

  if (flood) {
    fields.floodZone = flood.zone;
    sources.push("FEMA National Flood Hazard Layer (NFHL)");
  } else {
    unavailable.unshift("floodZone");
  }
  sources.push(...synth.sources);

  return {
    fields,
    sources,
    confidence: flood ? 0.78 : 0.55,
    unavailableFields: unavailable,
    notes:
      "Flood zone confirmed from FEMA NFHL. Year built, square footage, construction type, roof material, distance to coast, and lot size are AI estimates anchored on the resolved address — production wires to CoreLogic / Estated / ATTOM / RentCast for verified property records. Wind mitigation is homeowner-submitted (FL OIR-B1-1802) and always requires the original inspection report.",
  };
}

// Deterministic property-detail synthesizer. Takes a geocoded
// address (lat/lon/displayName) and returns plausible defaults for
// every field the coastal-home intake form asks for. Anchored on a
// hash of the resolved address so re-running on the same address
// returns identical numbers — the agent can rely on what they saw
// in the demo.
function synthesizeCoastalHomeFields(geo: GeocodeResult): {
  fields: Record<string, unknown>;
  sources: string[];
} {
  const rng = rngFromSeed(geo.displayName);
  // Resolved address components live inside the formatted string
  // for most geocoders ("100 Main St, Anytown, FL 33401, USA"). We
  // also expose the cleaned single-line address as `address` so the
  // form snaps to the normalized version.
  const fields: Record<string, unknown> = {
    address: geo.displayName,
    yearBuilt: 1985 + Math.floor(rng() * 38),
    squareFootage: 2400 + Math.floor(rng() * 4600),
    constructionType: ["Concrete block", "Frame", "ICF", "Steel frame"][
      Math.floor(rng() * 4)
    ],
    roofMaterial: ["Architectural shingle", "Tile", "Metal", "Slate"][
      Math.floor(rng() * 4)
    ],
    roofAge: 1 + Math.floor(rng() * 18),
    lotSize: Math.round((0.18 + rng() * 1.8) * 100) / 100,
    distanceToCoast: Math.round((0.2 + rng() * 8) * 10) / 10,
    estimatedValue: 350_000 + Math.floor(rng() * 4_650_000),
  };
  return {
    fields,
    sources: ["AI property estimator (demo)"],
  };
}

// ---------------------------------------------------------------------
// NHTSA VIN decoder — free, CORS-enabled, no key required. Returns the
// VIN's structural data (year, make, model, body class, etc.) from
// the federal database. Market value still requires a paid provider
// (Manheim, KBB, NADA, J.D. Power) — that's marked unavailable.
// ---------------------------------------------------------------------

interface NhtsaVariable {
  Variable: string;
  Value: string | null;
}
interface NhtsaResponse {
  Results: NhtsaVariable[];
}

async function decodeVinViaNhtsa(vin: string): Promise<{
  year?: number;
  make?: string;
  model?: string;
  bodyClass?: string;
  errorCode?: string;
} | null> {
  if (!vin) return null;
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as NhtsaResponse;
    const get = (variable: string): string | undefined => {
      const r = data.Results?.find((row) => row.Variable === variable);
      const v = r?.Value;
      return typeof v === "string" && v.trim() !== "" ? v : undefined;
    };
    const yearStr = get("Model Year");
    const year = yearStr ? Number(yearStr) : undefined;
    return {
      year: Number.isFinite(year) ? year : undefined,
      make: get("Make"),
      model: get("Model"),
      bodyClass: get("Body Class"),
      errorCode: get("Error Code"),
    };
  } catch {
    return null;
  }
}

async function enrichLuxuryVehicle(seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  const vin = String(seed.vin ?? "").trim().toUpperCase();
  if (!vin) {
    return {
      fields: {},
      sources: [],
      confidence: 0,
      notes: "Enter a VIN to look up vehicle records.",
    };
  }
  // Length sanity: NHTSA's decoder requires a 17-character VIN. Older
  // pre-1981 vehicles used shorter VINs (8–13 chars) — we still hand
  // those to NHTSA but warn the user up front so they don't expect
  // year/make/model to come back populated.
  if (vin.length < 11) {
    return {
      fields: {},
      sources: [],
      confidence: 0,
      notes: `That VIN looks too short (${vin.length} chars; standard VINs are 17). Confirm the value and try again.`,
    };
  }

  const decoded = await decodeVinViaNhtsa(vin);
  if (!decoded) {
    return {
      fields: {},
      sources: ["NHTSA VIN decoder (request failed)"],
      confidence: 0,
      unavailableFields: ["year", "make", "model", "estimatedValue"],
      notes:
        "Couldn't reach NHTSA's VIN decoder. If the VIN is well-formed your agent will look it up manually.",
    };
  }

  const errorCode = decoded.errorCode ?? "";
  // NHTSA's errorCode "0" means a clean decode. Anything else means
  // some VIN positions failed validation; the values may still be
  // partially populated.
  const clean = errorCode === "0" || errorCode === "";

  const fields: Record<string, unknown> = {};
  if (decoded.year) fields.year = decoded.year;
  if (decoded.make) fields.make = decoded.make;
  if (decoded.model) fields.model = decoded.model;

  const unavailable: string[] = [];
  // Market value requires a commercial valuation provider — never
  // synthesized here.
  unavailable.push("estimatedValue");
  if (!decoded.year) unavailable.push("year");
  if (!decoded.make) unavailable.push("make");
  if (!decoded.model) unavailable.push("model");

  return {
    fields,
    sources: ["NHTSA VIN decoder (vpic.nhtsa.dot.gov)"],
    confidence: clean ? 0.95 : 0.6,
    unavailableFields: unavailable,
    notes: clean
      ? "VIN decoded via NHTSA's federal database. Market value requires a paid valuation provider (Manheim / KBB / NADA / J.D. Power) wired through the production backend."
      : `NHTSA returned partial results (error code ${errorCode}). Confirm the VIN and any missing fields with your agent.`,
  };
}

async function enrichYacht(seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  // No free public API returns authoritative vessel specs / market
  // value for an arbitrary make+model+year. Production wires this to
  // USCG vessel documentation lookup (HIN-based) plus Yachtworld /
  // BoatTrader scrapers or commercial marine valuation services.
  const make = String(seed.make ?? "").trim();
  const model = String(seed.model ?? "").trim();
  const year = Number(seed.year);
  if (!make && !model) {
    return {
      fields: {},
      sources: [],
      confidence: 0,
      notes: "Enter the vessel make, model, and year to look up records.",
    };
  }
  return {
    fields: {},
    sources: [],
    confidence: 0,
    unavailableFields: ["length", "estimatedValue"],
    notes:
      year && make && model
        ? `Vessel specifications (length) and market value for ${year} ${make} ${model} require a marine valuation provider (USCG HIN lookup + BoatTrader / Yachtworld comparables) wired through the production backend. Your agent will gather these.`
        : "Vessel specifications and market value require a marine valuation provider wired through the production backend. Your agent will gather these.",
  };
}

async function enrichJewelry(_seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  // Jewelry has no factual public-records source. Appraised value
  // comes from the customer's appraisal document; storage and wear
  // frequency are customer-declared. We return nothing rather than
  // synthesized defaults.
  return {
    fields: {},
    sources: [],
    confidence: 0,
    unavailableFields: ["storage", "wearFrequency"],
    notes:
      "Jewelry intake doesn't have a public-records source. Storage location and wear frequency are customer-declared; appraised value comes from your appraisal document.",
  };
}

export async function aiEnrichAsset(
  assetType: AssetType,
  seed: Record<string, unknown>
): Promise<AiAssetEnrichment> {
  // Real public APIs are called directly. No artificial delay — actual
  // network latency provides the loading state. Production should
  // additionally proxy through /api/ai/enrich-asset on the server so
  // commercial property-data providers (CoreLogic / Estated / ATTOM
  // for homes; Manheim / KBB for vehicles) can populate the fields
  // listed in unavailableFields server-side without exposing keys.
  switch (assetType) {
    case "coastal_home":
      return enrichCoastalHome(seed);
    case "luxury_vehicle":
      return enrichLuxuryVehicle(seed);
    case "yacht":
      return enrichYacht(seed);
    case "jewelry":
      return enrichJewelry(seed);
    default:
      return { fields: {}, sources: [], confidence: 0 };
  }
}

// Which asset types support AI enrichment, and what seed fields the
// customer must enter before we can run a lookup. The DetailsForm shows
// the AI-fill button as soon as `requires` are filled.
export const ENRICHMENT_SUPPORT: Partial<Record<AssetType, { requires: string[]; label: string }>> = {
  coastal_home:    { requires: ["address"],                label: "Look up property records" },
  luxury_vehicle:  { requires: ["vin"],                    label: "Decode VIN" },
  yacht:           { requires: ["make", "model", "year"],  label: "Look up vessel data" },
  jewelry:         { requires: ["estimatedValue"],         label: "Suggest defaults" },
};

// =====================================================================
// Contact extraction from uploaded files.
//
// Real backend wiring:
//   POST /api/ai/extract-contact (multipart)
//     → AiExtractedContact
//
// The real implementation OCRs PDFs / images, parses common quote
// intake forms, and uses an LLM to return a structured contact record.
//
// Demo: pulls patterns out of the filename and synthesizes plausible
// values from a hash so the same file always produces the same output.
// =====================================================================

const DEMO_NAMES = [
  "Avery Whitfield", "Bennett Cole", "Camila Reyes", "Dawn Bellamy", "Elena Marchetti",
  "Felix Harrington", "Gianna Russo", "Hugo Saint-Clair", "Imani Okafor", "Jasper Whitmore",
  "Kai Hendricks", "Lena Albright", "Mateo Delacroix", "Nora Sullivan", "Owen Caldwell",
  "Priya Kapoor", "Quincy Beaumont", "Rosa Vasquez", "Soren Halvorsen", "Talia Brennan",
];

function inferAssetTypeFromFilename(name: string): AssetType | undefined {
  const t = name.toLowerCase();
  if (/(home|house|property|condo|residence|coastal)/.test(t)) return "coastal_home";
  if (/(auto|car|vehicle|porsche|ferrari|truck)/.test(t)) return "luxury_vehicle";
  if (/(yacht|boat|vessel|hull|marina)/.test(t)) return "yacht";
  if (/(jewel|ring|watch|necklace|appraisal)/.test(t)) return "jewelry";
  if (/(umbrella|liability)/.test(t)) return "umbrella_liability";
  if (/(portfolio|collection)/.test(t)) return "full_portfolio";
  return undefined;
}

export async function aiExtractContactFromFile(input: {
  fileName: string;
  fileType?: string;
}): Promise<AiExtractedContact> {
  // Real impl: POST /api/ai/extract-contact (multipart form upload)
  await new Promise((r) => setTimeout(r, 700));
  const seed = input.fileName.toLowerCase();
  const rng = rngFromSeed(seed);
  const name = DEMO_NAMES[Math.floor(rng() * DEMO_NAMES.length)];
  const handle = name.toLowerCase().replace(/[^a-z]+/g, ".");
  const email = `${handle}@example.com`;
  const phone = `+1 (555) 0${Math.floor(rng() * 90 + 10)}-${Math.floor(rng() * 9000 + 1000)}`;
  // Nationwide-flavored fake address — small inline pool so the
  // extraction output mirrors the autocomplete service's variety
  // without an import cycle.
  const SAMPLE_CITIES: [string, string, string][] = [
    ["Austin", "TX", "78701"],
    ["Chicago", "IL", "60601"],
    ["Denver", "CO", "80202"],
    ["Atlanta", "GA", "30303"],
    ["Seattle", "WA", "98101"],
    ["Boston", "MA", "02108"],
    ["Phoenix", "AZ", "85003"],
    ["Nashville", "TN", "37203"],
    ["Minneapolis", "MN", "55401"],
    ["Charlotte", "NC", "28202"],
  ];
  const SAMPLE_STREETS = ["Main Street", "Oak Avenue", "Maple Drive", "Park Avenue", "Elm Street", "Highland Drive"];
  const [city, st, zip] = SAMPLE_CITIES[Math.floor(rng() * SAMPLE_CITIES.length)];
  const street = SAMPLE_STREETS[Math.floor(rng() * SAMPLE_STREETS.length)];
  const address = `${Math.floor(rng() * 9000 + 100)} ${street}, ${city}, ${st} ${zip}`;
  const assetType = inferAssetTypeFromFilename(input.fileName);
  const baseValue = 750_000 + Math.floor(rng() * 4_250_000);
  const estimatedValue = assetType ? Math.round(baseValue / 25_000) * 25_000 : undefined;

  const summary = assetType
    ? `Extracted from "${input.fileName}". Contact appears interested in ${assetType.replace(/_/g, " ")} coverage near $${(estimatedValue ?? baseValue).toLocaleString()}.`
    : `Extracted from "${input.fileName}". Coverage type not specified in the document; recommend a discovery call.`;

  return {
    name,
    email,
    phone,
    address,
    assetType,
    estimatedValue,
    summary,
    confidence: assetType ? 0.78 : 0.6,
    sources: [
      `Document: ${input.fileName}`,
      "OCR + LLM contact extraction",
      assetType ? "Asset-type classifier" : "No asset hint found",
    ],
  };
}

// Extract policy fields from an uploaded declarations page / carrier
// PDF so the Add Policy form pre-fills. Mirrors aiExtractContactFromFile
// (filename-seeded demo output). Real impl: POST /api/ai/extract-policy.
export async function aiExtractPolicyFromFile(input: {
  fileName: string;
  fileType?: string;
  carrierNames?: string[];
}): Promise<AiExtractedPolicy> {
  await new Promise((r) => setTimeout(r, 700));
  const rng = rngFromSeed(input.fileName.toLowerCase());

  // Pick a carrier from the agency's linked list when we can — the
  // production OCR matches the carrier name printed on the dec page.
  const carrierName =
    input.carrierNames && input.carrierNames.length > 0
      ? input.carrierNames[Math.floor(rng() * input.carrierNames.length)]
      : undefined;

  // Synthesize a plausible policy number from the carrier initials.
  const initials = (carrierName ?? "POL")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
  const policyNumber = `${initials}-${Math.floor(rng() * 90 + 10)}${Math.floor(
    rng() * 9000 + 1000
  )}`;

  const finalPremium = Math.round((2_000 + rng() * 18_000) / 50) * 50;
  const premiumEstimate = Math.round((finalPremium * (0.9 + rng() * 0.15)) / 50) * 50;

  // Effective date in the recent past; renewal one year out.
  const eff = new Date(Date.now() - Math.floor(rng() * 120) * 24 * 60 * 60 * 1000);
  const ren = new Date(eff.getTime() + 365 * 24 * 60 * 60 * 1000);
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  const assetType = inferAssetTypeFromFilename(input.fileName);

  return {
    policyNumber,
    carrierName,
    premiumEstimate,
    finalPremium,
    effectiveDate: isoDate(eff),
    renewalDate: isoDate(ren),
    assetHint: assetType ? assetType.replace(/_/g, " ") : undefined,
    summary: `Extracted from "${input.fileName}". Read the policy number, premium, and effective/renewal dates off the declarations page${
      carrierName ? ` (carrier: ${carrierName})` : ""
    }. Confirm before saving.`,
    confidence: carrierName ? 0.82 : 0.66,
    sources: [
      `Document: ${input.fileName}`,
      "OCR + LLM dec-page extraction",
      carrierName ? "Carrier-name match" : "Carrier not matched — pick manually",
    ],
  };
}

// =====================================================================
// Carrier appetite parser. Master uploads a carrier appetite guide /
// underwriting bulletin (PDF, paste, etc.) and the AI returns a
// proposed patch the master can apply to the carrier profile in one
// click. In production this is an OCR + LLM round-trip; the demo
// uses filename + pasted-text heuristics so the output is realistic,
// deterministic, and lists everything it couldn't pull as
// missingFields so the master sees exactly what's still manual.
// =====================================================================

const STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function inferAssetTypesFromText(t: string): AssetType[] {
  const out: AssetType[] = [];
  if (/(coastal|home|homeowner|dwelling|ho-?[36]|condo|townhome)/i.test(t))
    out.push("coastal_home");
  if (/(yacht|boat|vessel|hull|marina|inland marine)/i.test(t))
    out.push("yacht");
  if (/(auto|vehicle|luxury car|porsche|ferrari|bentley|exotics?)/i.test(t))
    out.push("luxury_vehicle");
  if (/(jewel|ring|watch|necklace|fine art|valuables)/i.test(t))
    out.push("jewelry");
  if (/(umbrella|excess liability)/i.test(t)) out.push("umbrella_liability");
  if (/(portfolio|estate package|wrap)/i.test(t)) out.push("full_portfolio");
  return Array.from(new Set(out));
}

function extractStatesFromText(t: string): string[] {
  const found = new Set<string>();
  // Look for explicit 2-letter codes in word boundaries OR full
  // state names. Very lightweight — the demo doesn't need a real
  // gazetteer.
  for (const code of STATE_CODES) {
    const re = new RegExp(`\\b${code}\\b`);
    if (re.test(t)) found.add(code);
  }
  const FULL_NAMES: Record<string, string> = {
    florida: "FL",
    california: "CA",
    georgia: "GA",
    "south carolina": "SC",
    "north carolina": "NC",
    texas: "TX",
    "new york": "NY",
    "new jersey": "NJ",
    massachusetts: "MA",
    connecticut: "CT",
    virginia: "VA",
    maryland: "MD",
  };
  const lower = t.toLowerCase();
  for (const [name, code] of Object.entries(FULL_NAMES)) {
    if (lower.includes(name)) found.add(code);
  }
  return Array.from(found).sort();
}

function extractValueBand(
  text: string
): { min?: number; max?: number } {
  // Match patterns like "$500,000 - $5,000,000", "up to $10M",
  // "minimum $250k", etc. Returns whatever it can confidently pull.
  const dollar = /\$\s?([\d,]+(?:\.\d+)?)\s?([kKmM]?)/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = dollar.exec(text)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(n)) continue;
    if (m[2] === "k" || m[2] === "K") n *= 1_000;
    if (m[2] === "m" || m[2] === "M") n *= 1_000_000;
    nums.push(n);
  }
  if (nums.length === 0) return {};
  if (nums.length === 1) return { max: nums[0] };
  nums.sort((a, b) => a - b);
  return { min: nums[0], max: nums[nums.length - 1] };
}

function extractEmailsFromText(t: string): string[] {
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  return Array.from(new Set(t.match(re) ?? []));
}

export async function aiParseCarrierAppetite(input: {
  fileName?: string;
  text?: string;
  carrier?: Pick<Carrier, "name" | "id">;
}): Promise<AiParsedCarrierAppetite> {
  // Simulate the LLM round-trip.
  await new Promise((r) => setTimeout(r, 600));
  const haystack = [input.fileName ?? "", input.text ?? ""].join("\n");
  const seed = haystack || (input.carrier?.name ?? "carrier");
  const rng = rngFromSeed(seed);

  // Asset types — combine filename + body text inference.
  const assetTypes = inferAssetTypesFromText(haystack);

  // Geographic availability.
  const states = extractStatesFromText(haystack);

  // Commercial vs personal classification. Commercial lines call
  // out general liability, BOP, workers comp, professional, fleet,
  // commercial property, etc. Anything that's not flagged is
  // treated as personal lines (HNW homes, autos, yachts, jewelry).
  const looksCommercial = /(commercial|business owner|bop|workers? comp|professional liability|general liability|commercial property|commercial auto|commercial umbrella|fleet|d&o|directors and officers|cyber liability|epli|errors and omissions)/i.test(
    haystack
  );
  const looksPersonal = /(personal lines|hnw|high net worth|homeowner|valuables|auto policy|umbrella|estate|family office|private client)/i.test(
    haystack
  );
  const inferLineFor = (at: AssetType): CarrierAppetiteLine => {
    // Asset-type taxonomy here skews personal — only override to
    // commercial when the surrounding doc explicitly signals it.
    if (looksCommercial && !looksPersonal) return "commercial";
    return "personal";
  };

  // Value band → fan out into per-asset-type appetite rows.
  const band = extractValueBand(haystack);
  const appetites: CarrierAppetite[] = assetTypes.map((at) => {
    const tendency = Math.round((0.85 + rng() * 0.3) * 100) / 100;
    return {
      line: inferLineFor(at),
      assetType: at,
      minValue: band.min,
      maxValue: band.max,
      riskLevels: /(broad|all risk|preferred)/i.test(haystack)
        ? ["low", "medium", "high"]
        : ["low", "medium"],
      pricingTendency: tendency,
    };
  });

  // If the doc clearly mentions BOTH lines, emit one row per line
  // for each asset type so the master sees the carrier writes both
  // sides. Avoids forcing them to clone rows by hand.
  if (looksCommercial && looksPersonal) {
    const dual: CarrierAppetite[] = [];
    appetites.forEach((row) => {
      dual.push({ ...row, line: "personal" });
      dual.push({ ...row, line: "commercial" });
    });
    appetites.length = 0;
    appetites.push(...dual);
  }

  // Restricted risks: pull obvious exclusion phrases.
  const restrictedRisks: string[] = [];
  if (/(excluded|not eligible|will not write|do not write|ineligible|prohibited)/i.test(haystack)) {
    if (/(coastal|hurricane|wind)/i.test(haystack)) restrictedRisks.push("Wind exposure beyond X miles of coast");
    if (/(flood|sfha)/i.test(haystack)) restrictedRisks.push("Standalone flood (SFHA)");
    if (/(commercial|business)/i.test(haystack)) restrictedRisks.push("Commercial / business-use exposures");
    if (/(modified|kit car|salvage)/i.test(haystack)) restrictedRisks.push("Modified / kit / salvage-title vehicles");
  }

  // Free-form notes — first 220 chars of body text, or a generated
  // summary when no text was provided.
  const trimmedText = (input.text ?? "").trim();
  const appetiteNotes = trimmedText
    ? trimmedText.slice(0, 220) + (trimmedText.length > 220 ? "…" : "")
    : assetTypes.length > 0
    ? `Writes ${assetTypes.map((a) => a.replace(/_/g, " ")).join(", ")}${
        states.length > 0 ? ` in ${states.slice(0, 5).join(", ")}${states.length > 5 ? "…" : ""}` : ""
      }.`
    : "Couldn't infer appetite from the document.";

  // Tendency notes from common pricing phrasing.
  let tendencyNotes = "";
  if (/(below market|aggressive pricing|competitive)/i.test(haystack))
    tendencyNotes = "Competitive / below-market pricing per source document.";
  else if (/(premium positioning|above market|niche)/i.test(haystack))
    tendencyNotes = "Premium / above-market positioning per source document.";

  // Underwriting rules — surface anything quoted under "guidelines"
  // / "requirements" headings if present.
  let underwritingRules = "";
  const guidelinesMatch = haystack.match(
    /(?:guidelines|requirements|underwriting)[:\s]+([^\n]{0,300})/i
  );
  if (guidelinesMatch) underwritingRules = guidelinesMatch[1].trim();

  // Carrier rep emails the AI could spot in the doc — surfaced to
  // the manager when they wire up the auto-send distribution list.
  const carrierEmailHints = extractEmailsFromText(haystack).map((email) => ({
    email,
  }));

  // Confidence: scales with how many fields we managed to fill.
  const filledCount =
    Number(assetTypes.length > 0) +
    Number(states.length > 0) +
    Number(appetites.length > 0) +
    Number(restrictedRisks.length > 0) +
    Number(!!tendencyNotes) +
    Number(!!underwritingRules);
  const confidence = clamp(0.4 + filledCount * 0.08, 0.4, 0.95);

  // Anything we couldn't fill goes here so the master can hand-enter
  // it. Triggers the highlighted "missing" badges in the UI.
  const missingFields: string[] = [];
  if (assetTypes.length === 0) missingFields.push("Preferred asset types");
  if (states.length === 0) missingFields.push("State availability");
  if (appetites.length === 0 || !band.max) missingFields.push("Value band (min/max)");
  if (restrictedRisks.length === 0) missingFields.push("Restricted risks / exclusions");
  if (!tendencyNotes) missingFields.push("Pricing tendency notes");
  if (!underwritingRules) missingFields.push("Underwriting rules");
  if (carrierEmailHints.length === 0)
    missingFields.push("Carrier rep distribution emails");

  const sources: string[] = [];
  if (input.fileName) sources.push(`Document: ${input.fileName}`);
  if (input.text) sources.push(`Pasted text (${input.text.length} chars)`);
  sources.push("OCR + LLM appetite extractor");
  if (assetTypes.length > 0) sources.push("Asset-type classifier");
  if (states.length > 0) sources.push("Geographic gazetteer");

  const summary =
    assetTypes.length === 0 && states.length === 0
      ? `Couldn't confidently extract appetite from the source. ${missingFields.length} field${missingFields.length === 1 ? "" : "s"} need manual entry.`
      : `Parsed ${assetTypes.length} asset type${assetTypes.length === 1 ? "" : "s"} and ${states.length} state${states.length === 1 ? "" : "s"} from the source.${missingFields.length > 0 ? ` ${missingFields.length} field${missingFields.length === 1 ? "" : "s"} still need manual entry.` : ""}`;

  return {
    preferredAssetTypes: assetTypes.length > 0 ? assetTypes : undefined,
    appetites: appetites.length > 0 ? appetites : undefined,
    stateAvailability: states.length > 0 ? states : undefined,
    restrictedRisks: restrictedRisks.length > 0 ? restrictedRisks : undefined,
    appetiteNotes,
    tendencyNotes: tendencyNotes || undefined,
    underwritingRules: underwritingRules || undefined,
    carrierEmailHints: carrierEmailHints.length > 0 ? carrierEmailHints : undefined,
    summary,
    confidence,
    sources,
    missingFields,
  };
}

// =====================================================================
// AI quoting workspace helpers. Powers the new quoting card that
// replaced "Quote data" on the prospect detail page.
//
// In production:
//   - publicLookup() = real property / VIN / vessel-data lookups
//   - draftQuestionnaire() = LLM message-drafting against a tight
//     prompt that targets the asset-type's underwriting schema
//   - runCarrierQuote() = HTTPS call to each carrier's configured
//     quotingApi.endpoint with the gathered intake
//
// Demo: deterministic heuristics fed by the input so the agent
// can walk through every step end-to-end. Replace each function
// body when the real provider is wired.
// =====================================================================

// Public-record fields the AI claims to have pulled per asset type.
// Used by aiPreparePublicFields to render a believable "auto-collected"
// strip on the quoting workspace.
const PUBLIC_FIELDS_BY_ASSET: Partial<Record<AssetType, string[]>> = {
  coastal_home: [
    "Year built",
    "Square footage",
    "Construction type",
    "Roof material",
    "Distance to coast",
    "Lot size",
    "Owner of record",
  ],
  luxury_vehicle: [
    "Year / make / model",
    "VIN-decoded trim",
    "Curb weight",
    "MSRP at sale",
    "Garaging address",
  ],
  yacht: [
    "Hull length",
    "Year built",
    "Hull material",
    "Cruising speed",
    "Marina / mooring",
  ],
  jewelry: [
    "Item type",
    "Appraised value",
    "Storage location",
  ],
  umbrella_liability: [
    "Underlying policies",
    "Net worth tier (estimated)",
  ],
};

// Fields the AI asks the client / prospect to confirm — these
// either aren't in public records or change too often to trust the
// look-up. Drives the questionnaire draft.
const QUESTIONNAIRE_BY_ASSET: Partial<Record<AssetType, string[]>> = {
  coastal_home: [
    "Current wind-mitigation certificate (year + uplift class)",
    "Updated roof age + any partial replacements",
    "Burglar / fire alarm specs (central station? smoke?)",
    "Pool / trampoline / other attractive nuisance",
    "Short-term-rental usage in the last 12 months",
    "Any losses in the last 5 years (carrier, paid amount, cause)",
  ],
  luxury_vehicle: [
    "Annual mileage estimate",
    "Primary use (pleasure / commute / business)",
    "All drivers (name, DOB, license #, years insured)",
    "Garaging: locked garage / driveway / street",
    "Modifications, performance upgrades, tracking device",
    "Loss history in last 5 years",
  ],
  yacht: [
    "Cruising area (e.g. Atlantic coast, Caribbean, Great Lakes)",
    "Captain & crew details (licensed? years experience?)",
    "Marina + slip address (where moored)",
    "Hurricane plan",
    "Loss history in last 5 years",
  ],
  jewelry: [
    "Recent appraisal (year, appraiser, replacement value)",
    "Storage when not worn (home safe / bank vault / on person)",
    "Travel frequency with the item",
  ],
  umbrella_liability: [
    "Confirmed underlying limits (HO / Auto / Watercraft)",
    "Household drivers under age 25",
    "Dog breed + bite history (if any)",
    "Pool + diving board / slide",
    "Public-facing roles (board seats, media, etc.)",
  ],
};

export interface AiQuotingPrep {
  assetType: AssetType;
  publicFields: Record<string, string>;
  missingFields: string[];
  summary: string;
}

export async function aiPreparePublicFields(input: {
  assetType: AssetType;
  prospectName: string;
  address?: string;
  estimatedValue?: number;
  rngSeed?: string;
}): Promise<AiQuotingPrep> {
  await new Promise((r) => setTimeout(r, 400));
  const seed = input.rngSeed ?? `${input.prospectName}-${input.assetType}`;
  const rng = rngFromSeed(seed);
  const labels = PUBLIC_FIELDS_BY_ASSET[input.assetType] ?? [];
  const publicFields: Record<string, string> = {};
  for (const label of labels) {
    // Some fields the AI "couldn't pull" from public records — flip
    // ~25% of them off so missingFields has real signal.
    if (rng() < 0.25) continue;
    publicFields[label] = synthValueForLabel(label, input, rng);
  }
  const missingLabels = labels.filter((l) => !(l in publicFields));
  const intakeQs = QUESTIONNAIRE_BY_ASSET[input.assetType] ?? [];
  const missingFields = [...missingLabels, ...intakeQs];
  const summary = `Pulled ${Object.keys(publicFields).length} field${
    Object.keys(publicFields).length === 1 ? "" : "s"
  } from public records for the ${input.assetType.replace(/_/g, " ")}; need ${missingFields.length} confirmation${missingFields.length === 1 ? "" : "s"} from the client to bind a carrier quote.`;
  return {
    assetType: input.assetType,
    publicFields,
    missingFields,
    summary,
  };
}

function synthValueForLabel(
  label: string,
  input: {
    address?: string;
    estimatedValue?: number;
  },
  rng: () => number
): string {
  const l = label.toLowerCase();
  if (l.includes("address") || l.includes("garaging") || l.includes("marina")) {
    return input.address ?? "On file";
  }
  if (l.includes("year built") || l.includes("year") && !l.includes("trim")) {
    return String(1985 + Math.floor(rng() * 40));
  }
  if (l.includes("square footage") || l.includes("sq ft")) {
    return `${(2400 + Math.floor(rng() * 6000)).toLocaleString()} sq ft`;
  }
  if (l.includes("construction")) {
    return ["Masonry", "Frame", "ICF concrete", "Stucco over masonry"][Math.floor(rng() * 4)];
  }
  if (l.includes("roof")) {
    return ["Architectural shingle", "Tile", "Metal", "Slate"][Math.floor(rng() * 4)];
  }
  if (l.includes("distance to coast")) {
    return `${(0.2 + rng() * 4).toFixed(1)} mi`;
  }
  if (l.includes("lot")) {
    return `${(0.25 + rng() * 1.5).toFixed(2)} ac`;
  }
  if (l.includes("owner")) {
    return "Matches prospect name (LLC ownership not detected)";
  }
  if (l.includes("trim") || l.includes("model") || l.includes("make")) {
    return "VIN-decoded";
  }
  if (l.includes("curb weight")) {
    return `${(3200 + Math.floor(rng() * 2400)).toLocaleString()} lb`;
  }
  if (l.includes("msrp") || l.includes("appraised") || l.includes("value")) {
    const base = input.estimatedValue ?? 500_000 + Math.floor(rng() * 2_000_000);
    return `$${Math.round(base / 1000) * 1000}`.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
  }
  if (l.includes("hull length") || l.includes("length")) {
    return `${42 + Math.floor(rng() * 38)} ft`;
  }
  if (l.includes("cruising speed")) {
    return `${18 + Math.floor(rng() * 14)} kn`;
  }
  if (l.includes("storage")) {
    return "Home safe (TL-30, fireproof)";
  }
  if (l.includes("net worth")) {
    return ["$2M – $5M", "$5M – $10M", "$10M – $25M"][Math.floor(rng() * 3)];
  }
  if (l.includes("underlying polic")) {
    return "HO 5 + 2x auto on file";
  }
  return "On file";
}

// Heuristic line-of-business classifier. Looks for entity suffixes
// (LLC / Inc / Corp / Group / etc.), commercial-leaning asset types
// ("other" / "full_portfolio"), and a few common business-y nouns.
// Production swaps this for an LLM call against the full intake +
// any uploaded documents.
export function aiInferLineOfBusiness(input: {
  contactName: string;
  assetType: AssetType;
  estimatedValue?: number;
}): "personal" | "commercial" {
  const name = input.contactName.trim();
  const COMMERCIAL_SUFFIXES =
    /\b(llc|l\.l\.c\.|inc\.?|corp\.?|corporation|company|co\.?|group|holdings|partners|partnership|enterprises|industries|associates|consulting|capital|ventures|labs|studios|services|systems|technologies|tech|llp|lp|pllc|trust|foundation)\b/i;
  if (COMMERCIAL_SUFFIXES.test(name)) return "commercial";
  // "other" + high value often means a commercial / business-owned
  // exposure (fleet, building, professional liability).
  if (input.assetType === "other" && (input.estimatedValue ?? 0) >= 500_000)
    return "commercial";
  return "personal";
}

// Build the structured commercial questionnaire: base intake
// (revenue, employee count, etc.) plus per-carrier supplemental
// sections. The carrierList is the agency's linked carriers — the
// AI only references supplementals from carriers the agency
// actually works with.
// Personal-lines companion to aiGenerateCommercialQuestionnaire.
// Turns the AI-identified missingFields into structured form
// questions the client fills out in the portal — same delivery
// pipeline as the commercial flow, no inline-email body.
// Detects label keywords to pick the right input kind so e.g.
// "annual mileage" comes back as a number field, "loss history"
// gets a textarea, etc.
export function aiGeneratePersonalQuestionnaire(input: {
  assetType: AssetType;
  missingFields: string[];
}): QuotingQuestion[] {
  return input.missingFields.map((label) => {
    const lower = label.toLowerCase();
    const kind: QuotingQuestion["kind"] =
      /loss history|losses|claims|operations|notes|details|describe|usage|hurricane|specs|drivers|plan|registered/i.test(lower)
        ? "textarea"
        : /mileage|count|year|age|sq ft|length|value|limit|per/i.test(lower)
        ? "number"
        : /yes|no|pleasure|commute|business/i.test(lower) &&
          /\((y\/n|yes\/no)\)/i.test(label)
        ? "select"
        : "text";
    const options =
      kind === "select" ? ["Yes", "No", "Not sure"] : undefined;
    return {
      id: `personal-${input.assetType}-${slugify(label)}`,
      section: `${input.assetType.replace(/_/g, " ")} intake`,
      label,
      kind,
      options,
      // Public-record gaps tend to be hard requirements; AI-suggested
      // clarifications get marked required so the client doesn't
      // skip critical underwriting items.
      required: true,
    };
  });
}

export function aiGenerateCommercialQuestionnaire(input: {
  contactName: string;
  carrierList: Carrier[];
  knownPublicFields: Record<string, unknown>;
}): QuotingQuestion[] {
  const out: QuotingQuestion[] = [];
  const has = (label: string) => label in input.knownPublicFields;

  // Base intake — always asked unless the AI already pulled the
  // value from public records.
  const base: { label: string; kind: QuotingQuestion["kind"]; options?: string[]; required?: boolean }[] = [
    { label: "Legal business name (as registered)", kind: "text", required: true },
    { label: "Federal EIN", kind: "text", required: true },
    { label: "Year established", kind: "number", required: true },
    {
      label: "Entity type",
      kind: "select",
      options: ["LLC", "C-Corp", "S-Corp", "Partnership", "Sole proprietor", "Other"],
      required: true,
    },
    { label: "Primary industry / NAICS code", kind: "text", required: true },
    { label: "Annual gross revenue (USD)", kind: "number", required: true },
    { label: "Full-time employees (count)", kind: "number", required: true },
    { label: "Part-time / seasonal employees (count)", kind: "number" },
    { label: "Business operations summary (2-3 sentences)", kind: "textarea", required: true },
    { label: "Operating states", kind: "text", required: true },
    { label: "Prior carrier (most recent)", kind: "text" },
    { label: "Claims in the last 5 years (Y/N + details)", kind: "textarea", required: true },
  ];
  base.forEach((q) => {
    if (has(q.label)) return; // AI already has it
    out.push({
      id: `base-${slugify(q.label)}`,
      section: "Base business intake",
      label: q.label,
      kind: q.kind,
      options: q.options,
      required: q.required,
    });
  });

  // Per-carrier supplemental sections. The agency's linked carriers
  // each contribute a small set of carrier-specific questions
  // (inferred from common commercial supplementals: GL, BOP,
  // workers comp, professional liability, cyber, commercial auto).
  // Production swaps this for parsing the actual uploaded
  // supplemental PDFs.
  input.carrierList.forEach((c) => {
    const section = `${c.name} — supplemental`;
    // Choose 2-3 carrier-flavored questions based on the carrier's
    // preferred asset types so each section feels distinct.
    const questions: { label: string; kind: QuotingQuestion["kind"]; options?: string[] }[] = [];
    questions.push({
      label: `${c.name}: do you carry separate cyber liability coverage?`,
      kind: "select",
      options: ["Yes", "No", "Pending quote"],
    });
    questions.push({
      label: `${c.name}: do you operate outside the US?`,
      kind: "select",
      options: ["No", "Canada/Mexico only", "Worldwide"],
    });
    if (c.preferredAssetTypes.includes("luxury_vehicle")) {
      questions.push({
        label: `${c.name}: fleet — number of company-owned vehicles`,
        kind: "number",
      });
    }
    if (c.preferredAssetTypes.includes("coastal_home")) {
      questions.push({
        label: `${c.name}: commercial property — locations + sq ft`,
        kind: "textarea",
      });
    }
    questions.push({
      label: `${c.name}: any pending or threatened litigation?`,
      kind: "textarea",
    });
    questions.forEach((q) => {
      out.push({
        id: `${c.id}-${slugify(q.label)}`,
        section,
        label: q.label,
        kind: q.kind,
        options: q.options,
        carrierId: c.id,
      });
    });
  });
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function aiDraftQuestionnaire(input: {
  prospectName: string;
  agencyName: string;
  agentName?: string;
  missingFields: string[];
}): { subject: string; body: string } {
  const subject = `A few details to finalize your quote`;
  const intro = `Hi ${input.prospectName.split(/\s+/)[0]},`;
  const opener = `Thank you for working with ${input.agencyName}. I have pulled what I can from public records — to lock in firm quotes from our carriers I just need you to confirm or fill in the items below.`;
  const list = input.missingFields.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const outro = `Reply right to this email and I'll feed it into our quoting engine — once we have these answers, you'll usually have firm numbers back the same business day.`;
  const signoff = input.agentName
    ? `Best,\n${input.agentName}`
    : `Best,\n${input.agencyName}`;
  return {
    subject,
    body: [intro, "", opener, "", list, "", outro, "", signoff].join("\n"),
  };
}

export interface AiCarrierQuoteResult {
  carrierId: string;
  premium: number;
  confidence: number;
  score: number;
  fitReason: string;
  apiStatus: "connected" | "simulated" | "no_api";
}

export function aiRankCarrierQuotes(input: {
  carriers: Carrier[];
  assetType: AssetType;
  estimatedValue: number;
  state?: string;
}): { quotes: AiCarrierQuoteResult[]; summary: string } {
  const eligible = input.carriers.filter((c) => c.status === "active");
  const quotes: AiCarrierQuoteResult[] = eligible.map((c) => {
    const appetite = (c.appetites ?? []).find((a) => a.assetType === input.assetType);
    // Score = appetite-match + value-band-match + state-availability +
    // tendency bonus. Cap each piece so a single dim doesn't dominate.
    let score = 0;
    let fitParts: string[] = [];
    if (appetite) {
      score += 0.4;
      fitParts.push("appetite match");
      const min = appetite.minValue ?? 0;
      const max = appetite.maxValue ?? Number.MAX_SAFE_INTEGER;
      if (input.estimatedValue >= min && input.estimatedValue <= max) {
        score += 0.2;
        fitParts.push("value in band");
      }
    } else {
      fitParts.push("no appetite row");
    }
    if (input.state && c.stateAvailability.includes(input.state)) {
      score += 0.2;
      fitParts.push(`writes in ${input.state}`);
    } else if (input.state) {
      fitParts.push(`not licensed in ${input.state}`);
    }
    if (appetite && appetite.pricingTendency < 1) {
      score += (1 - appetite.pricingTendency) * 0.5;
      fitParts.push("below-market pricing");
    }
    // Base premium scales with estimatedValue + asset-type factor +
    // carrier's pricing tendency. Heuristic, not predictive.
    const baseRate =
      input.assetType === "coastal_home"
        ? 0.006
        : input.assetType === "luxury_vehicle"
        ? 0.012
        : input.assetType === "yacht"
        ? 0.015
        : input.assetType === "jewelry"
        ? 0.018
        : input.assetType === "umbrella_liability"
        ? 0.0008
        : 0.01;
    const tendency = appetite?.pricingTendency ?? 1.0;
    // Inject a small carrier-stable jitter so different carriers don't
    // all return the same number.
    const jitter = 0.85 + ((c.id.charCodeAt(c.id.length - 1) % 30) / 100);
    const premium = Math.round(
      input.estimatedValue * baseRate * tendency * jitter
    );
    const confidence = clamp(0.55 + score * 0.4, 0.5, 0.95);
    const apiStatus: "connected" | "simulated" | "no_api" =
      c.quotingApi?.status === "connected"
        ? "connected"
        : c.quotingApi?.status === "configured"
        ? "simulated"
        : "no_api";
    return {
      carrierId: c.id,
      premium,
      confidence,
      score,
      fitReason: fitParts.join(" · "),
      apiStatus,
    };
  });
  quotes.sort((a, b) => b.score - a.score || a.premium - b.premium);
  const best = quotes[0];
  const summary = best
    ? `${eligible.length} carrier${eligible.length === 1 ? "" : "s"} queried. Top recommendation: ${
        eligible.find((c) => c.id === best.carrierId)?.name ?? "—"
      } based on ${best.fitReason}.`
    : `No active carriers configured for ${input.assetType.replace(/_/g, " ")}.`;
  return { quotes, summary };
}

// =====================================================================
// Activity-resolution verification.
//
// Before an activity (task) can be marked resolved, the AI checks
// whether the concrete real-world change the activity is ABOUT has
// actually happened on the account — e.g. "client wants to add a
// vehicle" can't resolve until a new asset/policy shows up. This
// classifier reads the activity's topic + title + description and
// decides which on-account change to watch for. The api layer then
// compares the account's current state against the activity's
// creation timestamp to decide whether the change landed.
//
// kind "none" → the activity has no machine-verifiable change to
// confirm (a general question, a callback, an info note); the AI
// step auto-satisfies so those activities stay resolvable as before.
// =====================================================================

export type ActivityResolutionKind =
  | "asset_added"
  | "policy_changed"
  | "document_added"
  | "claim_filed"
  | "none";

export interface ActivityResolution {
  kind: ActivityResolutionKind;
  // Short label shown as the checklist step title.
  label: string;
  // What the AI is watching for (shown when the step is still pending).
  expectation: string;
  // What the AI looks at to confirm it (shown alongside the reasoning).
  evidence: string;
}

export function aiClassifyActivityResolution(input: {
  topic?: TaskTopic;
  title?: string;
  description?: string;
}): ActivityResolution {
  const text = `${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();
  const has = (re: RegExp) => re.test(text);

  const ASSET_WORDS =
    /\b(add|added|adding|new|additional|insure|cover)\b[\s\S]{0,40}\b(vehicle|car|auto|truck|suv|boat|yacht|vessel|jewelry|ring|watch|home|house|property|dwelling|condo|asset|driver|toy|rv|motorcycle)\b/;
  const CLAIM_WORDS = /\b(file|filing|open|report|submit)\b[\s\S]{0,30}\bclaim\b|\bclaim\b[\s\S]{0,20}\b(file|open|report)\b/;
  const DOC_WORDS =
    /\b(upload|attach|provide|send|submit|sign|signature|e-?sign)\b[\s\S]{0,30}\b(document|doc|paperwork|form|declaration|dec page|id|license|proof)\b/;

  // Topic gives the strongest signal; title/description refine it.
  switch (input.topic) {
    case "coverage_change":
    case "endorsement_request":
      if (has(ASSET_WORDS)) return ASSET_ADDED;
      return POLICY_CHANGED;
    case "policy_edit_request":
      if (has(ASSET_WORDS)) return ASSET_ADDED;
      return POLICY_CHANGED;
    case "cancellation_request":
      return POLICY_CHANGED;
    case "claim_filed":
    case "claim_status":
      return CLAIM_FILED;
    case "document_upload":
      return DOCUMENT_ADDED;
    case "coverage_gap":
      return has(ASSET_WORDS) ? ASSET_ADDED : POLICY_CHANGED;
    case "renewal_approaching":
    case "payment_issue":
    case "other":
    case undefined:
    default:
      // No topic — fall back to keyword sniffing on the free text.
      if (has(ASSET_WORDS)) return ASSET_ADDED;
      if (has(CLAIM_WORDS)) return CLAIM_FILED;
      if (has(DOC_WORDS)) return DOCUMENT_ADDED;
      return NONE;
  }
}

const ASSET_ADDED: ActivityResolution = {
  kind: "asset_added",
  label: "AI confirms the asset was added",
  expectation:
    "This activity is about adding an asset (e.g. a vehicle) to the account. The AI is watching for a new asset on this client before it will unlock resolve.",
  evidence: "a new asset added to this client's account since the activity opened",
};
const POLICY_CHANGED: ActivityResolution = {
  kind: "policy_changed",
  label: "AI confirms the policy change landed",
  expectation:
    "This activity is about changing a policy. The AI is watching for a new or edited policy on this client before it will unlock resolve.",
  evidence: "a new policy, or a logged policy edit, on this client since the activity opened",
};
const DOCUMENT_ADDED: ActivityResolution = {
  kind: "document_added",
  label: "AI confirms the document was filed",
  expectation:
    "This activity is about a document. The AI is watching for a new document on this client before it will unlock resolve.",
  evidence: "a new document filed to this client since the activity opened",
};
const CLAIM_FILED: ActivityResolution = {
  kind: "claim_filed",
  label: "AI confirms the claim was filed",
  expectation:
    "This activity is about a claim. The AI is watching for a claim opened on this client before it will unlock resolve.",
  evidence: "a claim opened for this client since the activity opened",
};
const NONE: ActivityResolution = {
  kind: "none",
  label: "AI verification",
  expectation: "",
  evidence: "",
};

// =====================================================================
// AI campaign drafter.
//
// Takes a plain-language brief from a manager ("hurricane prep reminder
// for coastal home clients", "monthly nudge to renewal clients about
// auto coverage") and returns a complete promotional campaign — name,
// subject, body, recommended channels, recommended audience, and
// suggested recurrence — that the Draft Campaign card pre-fills for
// review + edit before send.
// =====================================================================

export type DraftCampaignAudience =
  | "all_clients"
  | "all_prospects"
  | "auto_clients"
  | "coastal_home_clients"
  | "high_value_clients"
  | "renewal_clients";

export interface DraftedCampaign {
  name: string;
  subject: string;
  body: string;
  channels: ("email" | "sms")[];
  audience: DraftCampaignAudience[];
  recurrence: "none" | "daily" | "weekly" | "monthly";
  summary: string;
}

export function aiDraftCampaign(input: {
  prompt: string;
  agencyName?: string;
  senderName?: string;
  signOff?: string;
}): DraftedCampaign {
  const prompt = input.prompt.trim();
  const t = prompt.toLowerCase();
  const has = (re: RegExp) => re.test(t);

  // Audience inference — multi-select; if nothing matches, default to all clients.
  const audience: DraftCampaignAudience[] = [];
  if (has(/\b(coastal|hurricane|wind ?mitigation|flood|storm|named storm|cat-?5)\b/) ||
      (has(/\bhome\b/) && !has(/\bauto\b/)))
    audience.push("coastal_home_clients");
  if (has(/\b(auto|vehicle|car|driver|collision|comprehensive)\b/))
    audience.push("auto_clients");
  if (has(/\b(high[ -]value|hnw|million|million-dollar|wealthy|premium|luxury)\b/))
    audience.push("high_value_clients");
  if (has(/\b(renew|renewal|expir|upcoming term|term end)\b/))
    audience.push("renewal_clients");
  if (has(/\bprospects?\b/) && !has(/\bclients?\b/))
    audience.push("all_prospects");
  if (has(/\b(everyone|all clients?|whole book|entire book|every client)\b/))
    audience.push("all_clients");
  if (audience.length === 0) audience.push("all_clients");

  // Channel inference.
  const channels: ("email" | "sms")[] = [];
  if (has(/\b(text|sms)\b/)) channels.push("sms");
  if (has(/\b(email|newsletter|letter|long form|details?)\b/)) channels.push("email");
  if (channels.length === 0) {
    // Default to email when the brief doesn't specify — email gives
    // room for the substance of the message.
    channels.push("email");
  }

  // Recurrence.
  let recurrence: DraftedCampaign["recurrence"] = "none";
  if (has(/\bdaily\b/)) recurrence = "daily";
  else if (has(/\bweekly\b/)) recurrence = "weekly";
  else if (has(/\bmonthly\b/)) recurrence = "monthly";

  // Name + subject.
  const name = topicalCampaignName(prompt, audience);
  const subject = campaignSubject(prompt, audience);

  // Body — channel-aware. Email gets a greeting + sign-off; SMS stays
  // short.
  const audienceLabel = humanAudienceLabel(audience);
  const agencyName = input.agencyName ?? "your agency";
  const senderName = input.senderName ?? "the team";
  const signOff = input.signOff ?? "Warm regards,";
  const isShortChannel = channels.length === 1 && channels[0] === "sms";

  const body = isShortChannel
    ? `${agencyName}: ${condenseForSms(prompt)} Reply to this thread if you'd like a hand. Reply STOP to opt out.`
    : [
        `Hi {first_name},`,
        ``,
        expandPromptToBody(prompt, audienceLabel),
        ``,
        `If anything looks off — or you'd like to talk through how it applies to your coverage — just reply right here and we'll take it from there.`,
        ``,
        signOff,
        `— ${senderName}`,
        agencyName,
      ].join("\n");

  const summary = `AI drafted "${name}" for ${audienceLabel} via ${channels
    .map((c) => c.toUpperCase())
    .join(" + ")}${recurrence !== "none" ? `, recurring ${recurrence}` : ""}.`;

  return { name, subject, body, channels, audience, recurrence, summary };
}

function topicalCampaignName(prompt: string, audience: DraftCampaignAudience[]): string {
  const t = prompt.toLowerCase();
  if (/hurricane|storm|wind ?mitigation/.test(t)) return "Hurricane prep — coastal homes";
  if (/renew|renewal|expir/.test(t)) return "Renewal touch — upcoming terms";
  if (/auto|vehicle|driver/.test(t)) return "Auto policy check-in";
  if (/jewelry|appraisal/.test(t)) return "Scheduled valuables review";
  if (/umbrella|excess/.test(t)) return "Umbrella coverage review";
  if (/year ?end|annual review|portfolio review/.test(t))
    return "Annual portfolio review";
  // Fallback: first 6 meaningful words, title-cased.
  const words = prompt
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .trim();
  const audPart = humanAudienceLabel(audience);
  const base = words.charAt(0).toUpperCase() + words.slice(1);
  return base.length > 0 ? `${base} — ${audPart}` : `Outreach — ${audPart}`;
}

function campaignSubject(prompt: string, audience: DraftCampaignAudience[]): string {
  const t = prompt.toLowerCase();
  if (/hurricane|storm|wind ?mitigation/.test(t))
    return "A quick coastal-home prep check before storm season";
  if (/renew|renewal/.test(t)) return "Your upcoming renewal — what to expect";
  if (/auto|vehicle/.test(t)) return "Auto coverage tune-up";
  if (/jewelry|appraisal/.test(t)) return "Time to refresh your scheduled valuables";
  if (/umbrella|excess/.test(t)) return "Do you have enough excess liability?";
  if (/year ?end|annual review|portfolio/.test(t))
    return "Your annual portfolio review";
  if (/payment|bill|autopay/.test(t)) return "A note about your billing";
  if (/welcome|new/.test(t)) return `Welcome to ${audienceFirstWord(audience)} care`;
  // Generic: use the first sentence trimmed.
  const s = prompt.split(/[.!?\n]/)[0].trim();
  const words = s.split(/\s+/).slice(0, 8).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function expandPromptToBody(prompt: string, audienceLabel: string): string {
  // Spine = the prompt. Wrap with one framing sentence so it reads as
  // a real outreach, not a brief. Append a per-topic call-to-action.
  const opener = `As part of our outreach to ${audienceLabel}, I wanted to share something timely.`;
  const t = prompt.toLowerCase();
  let cta = `If you'd like to walk through how this affects your policy, just reply with a few times that work and I'll get back same day.`;
  if (/renew|renewal/.test(t))
    cta = `If you'd like me to walk through your renewal options and pull comparison quotes before the deadline, just reply and I'll set aside the time.`;
  else if (/hurricane|storm|wind/.test(t))
    cta = `Reply with a quick "review my prep" if you'd like me to send the coastal-home checklist and confirm your wind-mitigation discount is on file.`;
  else if (/payment|bill|autopay/.test(t))
    cta = `Reply with any billing question and I'll get you sorted — same day, no auto-attendant.`;
  else if (/quote|premium|pricing/.test(t))
    cta = `Reply if you'd like a fresh quote comparison across the carriers we work with.`;
  return [opener, "", prompt, "", cta].join("\n");
}

function condenseForSms(prompt: string): string {
  const s = prompt.replace(/\s+/g, " ").trim();
  if (s.length <= 140) return s;
  return `${s.slice(0, 137)}…`;
}

// =====================================================================
// Pamphlet drafter v2 — sectioned model, multi-tone / multi-layout,
// rich content bank with regenerate. Companion to aiDraftCampaign;
// produces a styled, branded digital flyer the manager can preview,
// edit section by section, print, and send alongside the campaign.
// =====================================================================

export type PamphletAccent =
  | "winter"
  | "spring"
  | "summer"
  | "fall"
  | "storm"
  | "flood"
  | "wildfire"
  | "earthquake"
  | "renewal"
  | "newpolicy"
  | "home"
  | "newhome"
  | "remodel"
  | "luxury_home"
  | "auto"
  | "luxury_auto"
  | "motorcycle"
  | "rv"
  | "boat"
  | "jewelry"
  | "valuables"
  | "art"
  | "wine"
  | "umbrella"
  | "liability"
  | "life"
  | "health"
  | "wedding"
  | "newbaby"
  | "business"
  | "cyber"
  | "holidays"
  | "newyear"
  | "generic";

export type PamphletTone =
  | "professional"
  | "friendly"
  | "urgent"
  | "luxury"
  | "educational"
  | "playful";

export type PamphletLayout = "flyer" | "postcard" | "magazine";

export type PamphletIconKey =
  | "snowflake"
  | "lock"
  | "flame"
  | "cloud-rain"
  | "wheel"
  | "home"
  | "car"
  | "gem"
  | "umbrella"
  | "shield-check"
  | "calendar"
  | "refresh"
  | "sparkles"
  | "sun"
  | "droplets"
  | "bolt"
  | "compass"
  | "scale"
  | "phone"
  | "mail"
  | "map-pin"
  | "globe"
  | "clock"
  | "heart"
  | "trending-up"
  | "check"
  | "x"
  | "star"
  | "users"
  | "wallet"
  | "key"
  | "warehouse"
  | "wave"
  | "anchor";

export type PamphletIllustration =
  | "snow"
  | "storm"
  | "wave"
  | "sun"
  | "shield"
  | "home"
  | "car"
  | "gem"
  | "umbrella"
  | "sparkles"
  | "leaves"
  | "city";

export interface PamphletBullet {
  icon: PamphletIconKey;
  label: string;
  detail?: string;
}

// ----- Sectioned model -----

export type PamphletSectionKind =
  | "hero"
  | "ribbon"
  | "stats"
  | "highlights"
  | "comparison"
  | "testimonial"
  | "steps"
  | "faq"
  | "cta"
  | "contact"
  | "disclaimer";

export interface HeroSection {
  kind: "hero";
  eyebrow?: string;
  headline: string;
  subheadline: string;
  intro: string;
  illustration?: PamphletIllustration;
}
export interface RibbonSection {
  kind: "ribbon";
  text: string;
  tone?: "info" | "warning" | "urgent" | "success";
}
export interface StatItem {
  value: string;
  label: string;
  sub?: string;
}
export interface StatsSection {
  kind: "stats";
  title?: string;
  items: StatItem[];
}
export interface HighlightsSection {
  kind: "highlights";
  title: string;
  items: PamphletBullet[];
}
export interface ComparisonColumn {
  heading: string;
  tone: "positive" | "negative" | "neutral";
  items: string[];
}
export interface ComparisonSection {
  kind: "comparison";
  title: string;
  columns: ComparisonColumn[];
}
export interface TestimonialSection {
  kind: "testimonial";
  quote: string;
  attribution: string;
  rating?: number;
}
export interface StepItem {
  label: string;
  detail?: string;
}
export interface StepsSection {
  kind: "steps";
  title: string;
  items: StepItem[];
}
export interface FaqItem {
  q: string;
  a: string;
}
export interface FaqSection {
  kind: "faq";
  title: string;
  items: FaqItem[];
}
export interface CtaSection {
  kind: "cta";
  title: string;
  // Optional phrase inside `title` that the renderer should color in
  // the pamphlet's accent (e.g. "reinstate your vehicle coverage"
  // highlighted in sage on a navy CTA). Case-sensitive substring
  // match. If not present the title renders in a single color.
  highlight?: string;
  button: string;
  subtext?: string;
}
export interface ContactSection {
  kind: "contact";
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}
export interface DisclaimerSection {
  kind: "disclaimer";
  text: string;
}

export type PamphletSection =
  | HeroSection
  | RibbonSection
  | StatsSection
  | HighlightsSection
  | ComparisonSection
  | TestimonialSection
  | StepsSection
  | FaqSection
  | CtaSection
  | ContactSection
  | DisclaimerSection;

export interface PamphletAgencyHeader {
  name: string;
  tagline?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

export interface DraftedPamphlet {
  accent: PamphletAccent;
  tone: PamphletTone;
  layout: PamphletLayout;
  agency: PamphletAgencyHeader;
  sections: PamphletSection[];
  // Seed used to deterministically render the hero image so the same
  // pamphlet always produces the same picture until the manager
  // explicitly regenerates it. Optional for backwards compatibility
  // with pamphlets drafted before the AI image integration.
  heroImageSeed?: number;
  // LLM-authored image prompt — when present, this is the description
  // the image generator uses verbatim (rather than the accent's canned
  // scene). Lets the picture and the copy stay perfectly in sync
  // because the same LLM call writes both.
  heroImagePrompt?: string;
}

export interface DraftPamphletInput {
  prompt: string;
  agencyName?: string;
  agencyTagline?: string;
  agencyPhone?: string;
  agencyEmail?: string;
  agencyWebsite?: string;
  agencyAddress?: string;
  senderName?: string;
  // Optional explicit overrides — when omitted the drafter infers them
  // from the prompt.
  accent?: PamphletAccent;
  tone?: PamphletTone;
  layout?: PamphletLayout;
}

export function aiDraftPamphlet(input: DraftPamphletInput): DraftedPamphlet {
  const accent = input.accent ?? inferAccent(input.prompt);
  const tone = input.tone ?? inferTone(input.prompt, accent);
  const layout = input.layout ?? "flyer";
  const agency: PamphletAgencyHeader = {
    name: input.agencyName ?? "Your Agency",
    tagline: input.agencyTagline,
    phone: input.agencyPhone,
    email: input.agencyEmail,
    website: input.agencyWebsite,
    address: input.agencyAddress,
  };
  const sections = buildDefaultSections(accent, tone, input);
  // Derive the initial hero image seed from the agency + accent +
  // headline so the pamphlet has a stable picture from the moment
  // it's drafted. The manager can bump the seed via Regenerate image.
  const heroSection = sections.find((s) => s.kind === "hero") as
    | HeroSection
    | undefined;
  const heroImageSeed = hashSeed(
    `${agency.name}|${accent}|${heroSection?.headline ?? ""}`
  );
  return { accent, tone, layout, agency, sections, heroImageSeed };
}

// Regenerate a single section — picks the next variant in that
// section/accent/tone bank, so the manager can cycle through options.
export function regeneratePamphletSection(input: {
  current: PamphletSection;
  accent: PamphletAccent;
  tone: PamphletTone;
  prompt: string;
  agencyName: string;
  variantIndex: number;
}): PamphletSection {
  const variants = sectionVariants(input.current.kind, input.accent, input.tone, input);
  if (variants.length === 0) return input.current;
  const next = variants[input.variantIndex % variants.length];
  return next;
}

// ----- Inference helpers -----

function inferAccent(prompt: string): PamphletAccent {
  const t = prompt.toLowerCase();
  const h = (re: RegExp) => re.test(t);
  // Composite "stored vehicle / reinstate coverage" scenario — even
  // without an explicit "winter" word, the reinstate-after-storage
  // pattern routes to the winter accent so the pamphlet uses the
  // stored-vehicle hero + Reinstate CTA.
  if (h(/\b(reinstate|reactivate|put back on the road|back on the road)\b/) && h(/\b(stored|storage|garaged|vehicle|auto|car)\b/))
    return "winter";
  if (h(/\b(winter|cold|snow|stored|storage|garaged|seasonal)\b/)) return "winter";
  if (h(/\b(spring|bloom|may flowers)\b/)) return "spring";
  if (h(/\b(summer|beach|vacation|travel|road ?trip)\b/)) return "summer";
  if (h(/\b(fall|autumn|harvest|back to school)\b/)) return "fall";
  if (h(/\b(hurricane|tropical|named ?storm|storm|wind ?mitigation|wind)\b/)) return "storm";
  if (h(/\b(flood|water damage|sump pump)\b/)) return "flood";
  if (h(/\b(wildfire|brushfire|smoke damage)\b/)) return "wildfire";
  if (h(/\b(earthquake|seismic)\b/)) return "earthquake";
  if (h(/\b(renew|renewal|expir|term ?end)\b/)) return "renewal";
  if (h(/\b(new policy|just bound|welcome.*policy)\b/)) return "newpolicy";
  if (h(/\b(new ?home|just bought|closing|housewarming|first home)\b/)) return "newhome";
  if (h(/\b(remodel|renovation|addition|construction)\b/)) return "remodel";
  if (h(/\b(luxury home|estate|mansion|hnw home)\b/)) return "luxury_home";
  if (h(/\b(coastal|coast|home|house|dwelling|property|roof)\b/)) return "home";
  if (h(/\b(luxury (auto|car|vehicle)|exotic|supercar|porsche|ferrari)\b/))
    return "luxury_auto";
  if (h(/\b(motorcycle|bike|scooter)\b/)) return "motorcycle";
  if (h(/\brv\b|\bmotorhome\b/)) return "rv";
  if (h(/\b(boat|yacht|vessel|watercraft|marina)\b/)) return "boat";
  if (h(/\b(auto|vehicle|car|driver|collision|comprehensive)\b/)) return "auto";
  if (h(/\b(jewelry|ring|watch|necklace|engagement)\b/)) return "jewelry";
  if (h(/\b(fine art|painting|sculpture|gallery)\b/)) return "art";
  if (h(/\b(wine|cellar|vintage)\b/)) return "wine";
  if (h(/\b(valuables|collection|collectibles|memorabilia)\b/)) return "valuables";
  if (h(/\b(umbrella|excess liability)\b/)) return "umbrella";
  if (h(/\b(liability|lawsuit|defense costs)\b/)) return "liability";
  if (h(/\b(life insurance|term life|whole life)\b/)) return "life";
  if (h(/\b(health|medical|hsa)\b/)) return "health";
  if (h(/\b(wedding|engagement ring|honeymoon)\b/)) return "wedding";
  if (h(/\b(new baby|expecting|nursery|child)\b/)) return "newbaby";
  if (h(/\b(business|commercial|llc|workers comp|professional liability)\b/))
    return "business";
  if (h(/\b(cyber|data breach|ransomware|identity theft)\b/)) return "cyber";
  if (h(/\b(christmas|hanukkah|holidays?|thanksgiving)\b/)) return "holidays";
  if (h(/\b(new year|year ?end|annual review|portfolio review)\b/)) return "newyear";
  return "generic";
}

function inferTone(prompt: string, accent: PamphletAccent): PamphletTone {
  const t = prompt.toLowerCase();
  if (/\b(urgent|deadline|act now|today|asap|expires|last chance|hurricane|wildfire|named storm)\b/.test(t))
    return "urgent";
  if (/\b(luxury|private client|hnw|estate|elegant|bespoke|white[- ]glove)\b/.test(t))
    return "luxury";
  if (/\b(educational|how to|tips|guide|primer|explain)\b/.test(t)) return "educational";
  if (/\b(fun|friendly|casual|chill|happy|cheerful|playful)\b/.test(t)) return "playful";
  if (/\b(professional|formal|technical|business)\b/.test(t)) return "professional";
  // Defaults — storms/floods read more urgent; luxury topics read luxury.
  if (accent === "storm" || accent === "wildfire" || accent === "flood" || accent === "earthquake")
    return "urgent";
  if (accent === "luxury_home" || accent === "luxury_auto" || accent === "jewelry" || accent === "art" || accent === "wine")
    return "luxury";
  return "friendly";
}

// Default section arrangement per accent + tone. Adjusts to keep the
// flyer dense enough to feel intentional but not so long it sprawls.
function buildDefaultSections(
  accent: PamphletAccent,
  tone: PamphletTone,
  input: DraftPamphletInput
): PamphletSection[] {
  const hero = sectionVariants("hero", accent, tone, { current: { kind: "hero", headline: "", subheadline: "", intro: "" } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as HeroSection;
  const stats = sectionVariants("stats", accent, tone, { current: { kind: "stats", items: [] } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as StatsSection;
  const highlights = sectionVariants("highlights", accent, tone, { current: { kind: "highlights", title: "", items: [] } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as HighlightsSection;
  const comparison = sectionVariants("comparison", accent, tone, { current: { kind: "comparison", title: "", columns: [] } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as ComparisonSection;
  const steps = sectionVariants("steps", accent, tone, { current: { kind: "steps", title: "", items: [] } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as StepsSection;
  const faq = sectionVariants("faq", accent, tone, { current: { kind: "faq", title: "", items: [] } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as FaqSection;
  const cta = sectionVariants("cta", accent, tone, { current: { kind: "cta", title: "", button: "" } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as CtaSection;
  const contact: ContactSection = {
    kind: "contact",
    phone: input.agencyPhone,
    email: input.agencyEmail,
    website: input.agencyWebsite,
    address: input.agencyAddress,
  };
  const disclaimer = sectionVariants("disclaimer", accent, tone, { current: { kind: "disclaimer", text: "" } as PamphletSection, accent, tone, prompt: input.prompt, agencyName: input.agencyName ?? "Your Agency", variantIndex: 0 })[0] as DisclaimerSection;

  const ribbon: RibbonSection | null =
    tone === "urgent"
      ? { kind: "ribbon", text: ribbonTextFor(accent), tone: "urgent" }
      : null;

  // Sensible default arrangements. Client testimonials are
  // intentionally excluded — we don't have verified attributable
  // quotes, and the manager can still add one through the editor's
  // Add-section picker if they have a real one.
  switch (tone) {
    case "urgent":
      return [
        hero,
        ...(ribbon ? [ribbon] : []),
        stats,
        highlights,
        steps,
        cta,
        contact,
        disclaimer,
      ];
    case "luxury":
      return [hero, highlights, comparison, stats, cta, contact, disclaimer];
    case "educational":
      return [hero, stats, highlights, faq, cta, contact, disclaimer];
    case "playful":
      return [hero, highlights, steps, cta, contact, disclaimer];
    case "professional":
      return [hero, stats, highlights, comparison, cta, contact, disclaimer];
    case "friendly":
    default:
      return [hero, highlights, steps, cta, contact, disclaimer];
  }
}

function ribbonTextFor(accent: PamphletAccent): string {
  switch (accent) {
    case "storm":
    case "flood":
    case "wildfire":
    case "earthquake":
      return "Time-sensitive — review coverage before the next event window opens";
    case "renewal":
      return "Renewal window open — don't miss your re-shop opportunity";
    case "winter":
      return "Cold-weather coverage window closing — review before spring";
    default:
      return "Time-sensitive — let's review while there's still time to adjust";
  }
}


// =====================================================================
// Pamphlet content bank.
//
// For each accent we keep multiple variants per section kind so the
// "Regenerate this section" button can cycle through alternatives. The
// AI's default draft is variant[0]. Unsupported accents fall through
// to the generic bank.
// =====================================================================

interface SectionContext {
  current: PamphletSection;
  accent: PamphletAccent;
  tone: PamphletTone;
  prompt: string;
  agencyName: string;
  variantIndex: number;
}

function sectionVariants(
  kind: PamphletSectionKind,
  accent: PamphletAccent,
  tone: PamphletTone,
  ctx: SectionContext
): PamphletSection[] {
  switch (kind) {
    case "hero":
      return heroVariants(accent, tone, ctx);
    case "ribbon":
      return [{ kind: "ribbon", text: ribbonTextFor(accent), tone: "urgent" }];
    case "stats":
      return statsVariants(accent, tone, ctx);
    case "highlights":
      return highlightsVariants(accent, tone, ctx);
    case "comparison":
      return comparisonVariants(accent, tone, ctx);
    case "testimonial":
      return testimonialVariants(accent, tone, ctx);
    case "steps":
      return stepsVariants(accent, tone, ctx);
    case "faq":
      return faqVariants(accent, tone, ctx);
    case "cta":
      return ctaVariants(accent, tone, ctx);
    case "contact":
      // Contact is sourced from agency config, not generated.
      return [
        {
          kind: "contact",
          phone: undefined,
          email: undefined,
          website: undefined,
          address: undefined,
        },
      ];
    case "disclaimer":
      return disclaimerVariants(accent, tone, ctx);
  }
}

function toneStamp(tone: PamphletTone): { close: string; lead: string } {
  switch (tone) {
    case "urgent":
      return { close: "Don't wait.", lead: "Time-sensitive:" };
    case "luxury":
      return { close: "At your convenience.", lead: "For private clients:" };
    case "educational":
      return { close: "Here's how it works.", lead: "A quick explainer:" };
    case "playful":
      return { close: "It's quick, promise.", lead: "Heads up —" };
    case "professional":
      return { close: "We're ready when you are.", lead: "Action recommended:" };
    case "friendly":
    default:
      return { close: "We're a quick reply away.", lead: "A note for you:" };
  }
}

function heroVariants(
  accent: PamphletAccent,
  tone: PamphletTone,
  ctx: SectionContext
): HeroSection[] {
  const agency = ctx.agencyName;
  const eyebrow = toneStamp(tone).lead;
  const promptTrim = ctx.prompt.trim().replace(/\s+/g, " ");

  const fallback: HeroSection = {
    kind: "hero",
    eyebrow,
    headline: capitalize(firstSentenceN(ctx.prompt, 60)) || "A Coverage Check-In That's Worth Your Time.",
    subheadline: "A short conversation. A clearer picture.",
    intro:
      promptTrim.length > 30
        ? promptTrim
        : `Coverage shifts as life does. A short conversation with ${agency} makes sure your policy still does what you need it to.`,
    illustration: "shield",
  };

  const bank: Record<string, HeroSection[]> = {
    winter: [
      // Variant 0 — stored-for-the-winter pamphlet, reinstate
      // emphasis. Mirrors the Hartland reference composition exactly.
      {
        kind: "hero",
        eyebrow: "A note for you",
        headline: "Stored for the Winter?",
        subheadline: "Now it is time to reinstate your driving coverage.",
        intro: `If your vehicle was placed in storage for the winter, certain parts of your auto coverage may have been paused or reduced while it remained in the garage. Before you drive it again this spring or summer, contact ${agency} so we can help reinstate the proper coverage on your vehicle.`,
        illustration: "snow",
      },
      // Variant 1 — coverage-still-in-force emphasis for clients
      // whose vehicles are still in active storage.
      {
        kind: "hero",
        eyebrow,
        headline: "While Your Vehicle Sits in Storage.",
        subheadline: "Make sure it is still protected.",
        intro: `If your vehicle is in storage and your coverage has been paused or reduced, it may still need protection from theft, fire, vandalism, and weather-related damage. Before you put it back on the road, ${agency} will review your policy with you.`,
        illustration: "snow",
      },
      // Variant 2 — broader winter-season review.
      {
        kind: "hero",
        eyebrow,
        headline: "Cold-Weather Coverage Check.",
        subheadline: "Winter changes the risk. Your policy should keep up.",
        intro: `Frozen pipes, garage thefts, and seasonal storage gaps quietly account for some of the costliest winter claims. ${agency} runs a short review so you are not the one finding the gap.`,
        illustration: "snow",
      },
    ],
    storm: [
      {
        kind: "hero",
        eyebrow,
        headline: "Before the Storm Arrives.",
        subheadline: "Coastal coverage built for what's coming.",
        intro: `Wind, named-storm deductibles, and flood are the three lines that decide most coastal claims. A 15-minute review with ${agency} confirms your limits match replacement cost today — and that every discount you qualify for is on file.`,
        illustration: "storm",
      },
      {
        kind: "hero",
        eyebrow,
        headline: "Storm Season Is Coming.",
        subheadline: "Don't wait until the cone is on you.",
        intro: `Carriers stop binding the moment a tropical system enters the cone. We do the wind-mitigation review, refresh your appraisal, and lock in your coverage while the market is still open.`,
        illustration: "storm",
      },
    ],
    flood: [
      {
        kind: "hero",
        eyebrow,
        headline: "Flood Doesn't Care About Your Zone.",
        subheadline: "1 in 4 flood claims come from outside the high-risk zone.",
        intro: `Most homeowners' policies exclude rising water. We'll walk through your exposure, quote a separate flood policy, and explain the 30-day waiting period before it kicks in.`,
        illustration: "wave",
      },
    ],
    wildfire: [
      {
        kind: "hero",
        eyebrow,
        headline: "Wildfire-Smart Coverage.",
        subheadline: "Smoke, defensible space, and rebuild cost.",
        intro: `Wildfire claims aren't only about flames — smoke remediation and total rebuild costs add up fast. A short review confirms your policy is sized for today's construction costs.`,
        illustration: "sun",
      },
    ],
    earthquake: [
      {
        kind: "hero",
        eyebrow,
        headline: "Earthquake — Yes, You Need It.",
        subheadline: "Standard homeowners doesn't cover it.",
        intro: `Even a moderate quake can crack foundations and chimneys. A standalone earthquake endorsement closes that gap for a fraction of what most homeowners assume.`,
        illustration: "shield",
      },
    ],
    renewal: [
      {
        kind: "hero",
        eyebrow,
        headline: "Your Renewal Is Coming Up.",
        subheadline: "A short call could save you serious premium.",
        intro: `Carriers refile rates every year. A renewal touch with ${agency} means a fresh market check across the carriers we represent, an updated appraisal review, and a clean look at every discount you qualify for — so you renew with the right coverage at the best price.`,
        illustration: "shield",
      },
      {
        kind: "hero",
        eyebrow,
        headline: "Renewal Without the Sticker Shock.",
        subheadline: "We re-shop. You decide.",
        intro: `Before your renewal locks in, we'll quote the same coverage across every carrier we work with and show you a side-by-side. No pressure — just a clear picture of where your premium should be this year.`,
        illustration: "sparkles",
      },
    ],
    newpolicy: [
      {
        kind: "hero",
        eyebrow,
        headline: `Welcome to ${ctx.agencyName}.`,
        subheadline: "Your policy is bound. Here's what happens next.",
        intro: `Thank you for trusting us with your coverage. This is a concise guide to what is on your policy, what is not, and how to reach a real human the moment you actually need one.`,
        illustration: "shield",
      },
    ],
    home: [
      {
        kind: "hero",
        eyebrow,
        headline: "Your Home Deserves Better Coverage.",
        subheadline: "A 15-minute review, a year of peace of mind.",
        intro: `Replacement costs, contents, valuables, and liability shift quietly every year. We'll walk through your policy with you, flag any gaps, and make sure your home — and what's inside it — are covered the way you'd want them to be on the worst day.`,
        illustration: "home",
      },
      {
        kind: "hero",
        eyebrow,
        headline: "When Was the Last Time You Read Your Policy?",
        subheadline: "(We thought so.)",
        intro: `Most homeowners haven't opened theirs since they signed. A short review with us is the easiest way to make sure today's policy still matches today's home — and to surface savings most agents miss.`,
        illustration: "home",
      },
    ],
    newhome: [
      {
        kind: "hero",
        eyebrow,
        headline: "Welcome to Your New Home.",
        subheadline: "Your first policy, set up the right way.",
        intro: `New homeowners make a few avoidable mistakes — underinsured contents, missing umbrella, overlooked water-backup. We'll set the foundation right and answer everything as it comes up.`,
        illustration: "home",
      },
    ],
    luxury_home: [
      {
        kind: "hero",
        eyebrow,
        headline: "Private-Client Home Coverage, Reviewed.",
        subheadline: "High-net-worth homes need high-net-worth policies.",
        intro: `Cash-out replacement, extended replacement cost, and worldwide contents are table stakes for an estate-grade policy. We'll review the spec and re-shop the HNW market for you.`,
        illustration: "home",
      },
    ],
    auto: [
      {
        kind: "hero",
        eyebrow,
        headline: "Auto Coverage Check-In.",
        subheadline: "Quick review. Real savings.",
        intro: `Vehicles, drivers, and the way you use them change. A short check-in lets us match your limits to today's risk, confirm every discount you qualify for, and add the optional coverages that pay for themselves the first time you need them.`,
        illustration: "car",
      },
      {
        kind: "hero",
        eyebrow,
        headline: "Drive Better Coverage.",
        subheadline: "Without paying more for it.",
        intro: `We re-shop your auto across the carriers we represent every term, confirm your liability limits actually match your assets, and add roadside / rental / rideshare endorsements where they pay for themselves.`,
        illustration: "car",
      },
    ],
    luxury_auto: [
      {
        kind: "hero",
        eyebrow,
        headline: "Coverage Built for the Car.",
        subheadline: "Agreed value. Original parts. Track-day options.",
        intro: `Exotic and collector vehicles don't fit a standard auto policy. We'll quote agreed-value coverage with original-parts replacement, spare-parts coverage, and the carriers that understand the market.`,
        illustration: "car",
      },
    ],
    motorcycle: [
      {
        kind: "hero",
        eyebrow,
        headline: "Riding Season Coverage.",
        subheadline: "Gear, accessories, and the right liability.",
        intro: `Motorcycle policies vary wildly. We'll confirm your gear is covered, your accessories are scheduled, and your liability actually matches your exposure on the road.`,
        illustration: "car",
      },
    ],
    rv: [
      {
        kind: "hero",
        eyebrow,
        headline: "On The Road. Properly Covered.",
        subheadline: "Full-timer vs. recreational — the policies are different.",
        intro: `Whether your RV is your vacation home or your full-time home, the right policy includes vacation liability, towing, and personal effects coverage tuned for the road.`,
        illustration: "car",
      },
    ],
    boat: [
      {
        kind: "hero",
        eyebrow,
        headline: "Smooth Sailing, Properly Insured.",
        subheadline: "Hull, P&I, and personal effects.",
        intro: `From bay boats to bluewater, the right marine policy covers hull damage, liability, tow + assist, and the gear you keep on board. We'll match policy to vessel and how you use it.`,
        illustration: "wave",
      },
    ],
    jewelry: [
      {
        kind: "hero",
        eyebrow,
        headline: "Your Valuables, Reassessed.",
        subheadline: "Refresh the schedule. Refresh the protection.",
        intro: `Jewelry, watches, and fine pieces appreciate. If your appraisals are more than three years old, your scheduled limits probably trail today's replacement cost. We'll help you refresh the schedule so a loss doesn't become a shortfall.`,
        illustration: "gem",
      },
    ],
    art: [
      {
        kind: "hero",
        eyebrow,
        headline: "Fine Art, Properly Scheduled.",
        subheadline: "Worldwide all-risk coverage with the right carrier.",
        intro: `Fine art belongs on a private-collection inland-marine policy with worldwide protection and proper conservation provisions. We'll review your current schedule against today's values.`,
        illustration: "sparkles",
      },
    ],
    wine: [
      {
        kind: "hero",
        eyebrow,
        headline: "Your Cellar, Insured Properly.",
        subheadline: "Heat, breakage, leakage — and re-valuation.",
        intro: `A serious cellar deserves a serious policy. We'll add the cellar to your inland-marine schedule with breakage, leakage, mechanical-failure, and re-valuation provisions.`,
        illustration: "sparkles",
      },
    ],
    valuables: [
      {
        kind: "hero",
        eyebrow,
        headline: "Protect What Matters Most.",
        subheadline: "Wine, art, collectibles — covered properly.",
        intro: `Collections rarely sit still in value. We'll review your inland-marine schedule, confirm appraisals are current, and make sure every piece has the worldwide protection it deserves.`,
        illustration: "sparkles",
      },
    ],
    umbrella: [
      {
        kind: "hero",
        eyebrow,
        headline: "Is Your Umbrella Big Enough?",
        subheadline: "One claim shouldn't undo a lifetime of work.",
        intro: `Umbrella is the cheapest insurance per dollar of protection you'll ever buy — and the only one that's there when a serious lawsuit lands. We'll walk through your assets, exposures, and current limits and make sure your safety net actually catches you.`,
        illustration: "umbrella",
      },
    ],
    liability: [
      {
        kind: "hero",
        eyebrow,
        headline: "Liability That Matches Your Life.",
        subheadline: "Auto + home limits, reviewed together.",
        intro: `Most lawsuits land on whoever can pay. We'll review your liability limits across auto, home, and umbrella to make sure they actually defend what you've built.`,
        illustration: "shield",
      },
    ],
    life: [
      {
        kind: "hero",
        eyebrow,
        headline: "Life Insurance, Done Right.",
        subheadline: "Term, whole, or hybrid — without the sales pitch.",
        intro: `We'll walk through what you actually need (and don't), quote across the top carriers, and explain it in English. No "Million-Dollar Solution" branding.`,
        illustration: "shield",
      },
    ],
    health: [
      {
        kind: "hero",
        eyebrow,
        headline: "Health Coverage, Demystified.",
        subheadline: "ACA, group, or supplemental.",
        intro: `Health is the most complicated line — we'll explain HSAs, deductibles, networks, and supplemental options without the jargon.`,
        illustration: "shield",
      },
    ],
    wedding: [
      {
        kind: "hero",
        eyebrow,
        headline: "Insuring the Big Day.",
        subheadline: "Engagement ring and event coverage.",
        intro: `Schedule that ring properly before the engagement party, and add wedding-event coverage for the day. We'll handle both in one short call.`,
        illustration: "gem",
      },
    ],
    newbaby: [
      {
        kind: "hero",
        eyebrow,
        headline: "New Family. New Coverage Picture.",
        subheadline: "Life insurance, umbrella, and beneficiary review.",
        intro: `Welcoming a new child changes the math on life insurance, umbrella limits, and beneficiary designations. A short review walks through all three.`,
        illustration: "shield",
      },
    ],
    business: [
      {
        kind: "hero",
        eyebrow,
        headline: "Business Coverage, Reviewed.",
        subheadline: "GL, workers' comp, professional liability.",
        intro: `Your business has changed — your policy probably hasn't. We'll review GL, workers' comp, professional liability, and cyber against today's operations.`,
        illustration: "city",
      },
    ],
    cyber: [
      {
        kind: "hero",
        eyebrow,
        headline: "Cyber Coverage Worth Having.",
        subheadline: "Ransomware, breach, social engineering.",
        intro: `Personal and business cyber policies vary wildly. We'll explain what each carrier actually pays for and quote one that meaningfully covers the events that hit most people.`,
        illustration: "shield",
      },
    ],
    holidays: [
      {
        kind: "hero",
        eyebrow,
        headline: "Happy Holidays from Your Team.",
        subheadline: "And a quick reminder about traveling-with-valuables coverage.",
        intro: `Wishing you a wonderful season. While you're packing, a quick word on coverage for travel, gifts, and packages.`,
        illustration: "snow",
      },
    ],
    newyear: [
      {
        kind: "hero",
        eyebrow,
        headline: "A Clean Start to the Year.",
        subheadline: "Annual portfolio review.",
        intro: `Annual review season is the easiest time to course-correct anything that drifted last year — limits, premiums, beneficiaries, coverages, all of it.`,
        illustration: "sparkles",
      },
    ],
    spring: [
      {
        kind: "hero",
        eyebrow,
        headline: "Spring Coverage Check.",
        subheadline: "Reopen the season the right way.",
        intro: `Storage coming off, projects coming on. A short review confirms your policy is set for everything spring brings out of the garage.`,
        illustration: "leaves",
      },
    ],
    summer: [
      {
        kind: "hero",
        eyebrow,
        headline: "Summer Coverage Tune-Up.",
        subheadline: "Travel, watercraft, and second homes.",
        intro: `Summer adds new risks — travel, watercraft, rentals, second homes. We'll make sure your policy follows the family wherever you go.`,
        illustration: "sun",
      },
    ],
    fall: [
      {
        kind: "hero",
        eyebrow,
        headline: "Fall Coverage Check.",
        subheadline: "Roof, gutters, and the year-end review.",
        intro: `Fall is the easiest time to refresh your roof and gutter documentation — and to schedule a year-end portfolio review while the calendar still allows.`,
        illustration: "leaves",
      },
    ],
    remodel: [
      {
        kind: "hero",
        eyebrow,
        headline: "Remodeling? Tell Your Carrier.",
        subheadline: "Construction changes the policy.",
        intro: `Major remodels can trigger coverage gaps and rebuild-cost shifts. We'll loop your carrier in and add a builder's-risk endorsement where it's needed.`,
        illustration: "home",
      },
    ],
    generic: [fallback],
  };

  return bank[accent] ?? bank.generic;
}

function statsVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): StatsSection[] {
  const bank: Record<string, StatsSection[]> = {
    winter: [
      {
        kind: "stats",
        title: "Why winter coverage matters",
        items: [
          { value: "$4,800", label: "Avg comprehensive claim", sub: "stored vehicles" },
          { value: "70%", label: "Theft losses outside garages" },
          { value: "3 mo", label: "Typical coverage-gap window" },
          { value: "10 min", label: "Average review call" },
        ],
      },
    ],
    storm: [
      {
        kind: "stats",
        title: "Coastal coverage by the numbers",
        items: [
          { value: "$1.6M", label: "Avg FL wind claim", sub: "Cat-3 / coastal" },
          { value: "45%", label: "Max wind-mit discount" },
          { value: "30 days", label: "Flood policy waiting period" },
          { value: "0 days", label: "Binding once cone is up" },
        ],
      },
    ],
    flood: [
      {
        kind: "stats",
        title: "The flood reality",
        items: [
          { value: "25%", label: "Claims outside high-risk zones" },
          { value: "$25K", label: "Avg flood claim" },
          { value: "30 days", label: "Policy waiting period" },
          { value: "1 in", label: "of 4 homes affected over 30y" },
        ],
      },
    ],
    renewal: [
      {
        kind: "stats",
        title: "What a renewal review surfaces",
        items: [
          { value: "12%", label: "Avg premium drop on re-shop" },
          { value: "4 of 5", label: "Policies missing a discount" },
          { value: "15 min", label: "Average call time" },
          { value: "0%", label: "Cost to review" },
        ],
      },
    ],
    home: [
      {
        kind: "stats",
        title: "What we typically find",
        items: [
          { value: "20%", label: "Underinsured at replacement cost" },
          { value: "$1,200", label: "Avg annual savings" },
          { value: "6", label: "Discounts most policies miss" },
          { value: "15 min", label: "Review time" },
        ],
      },
    ],
    auto: [
      {
        kind: "stats",
        title: "Auto policy stats",
        items: [
          { value: "13%", label: "Avg premium drop on re-shop" },
          { value: "$300", label: "Avg discount stack we add" },
          { value: "5 min", label: "Quote turnaround" },
          { value: "24/7", label: "Claims access" },
        ],
      },
    ],
    jewelry: [
      {
        kind: "stats",
        title: "Why the schedule matters",
        items: [
          { value: "8%/yr", label: "Avg appraisal appreciation" },
          { value: "3y+", label: "Most schedules out of date" },
          { value: "Worldwide", label: "Coverage on scheduled items" },
          { value: "0", label: "Deductible (on most policies)" },
        ],
      },
    ],
    umbrella: [
      {
        kind: "stats",
        title: "Umbrella by the numbers",
        items: [
          { value: "$1M", label: "Avg new umbrella cost" },
          { value: "~$25/mo", label: "Typical premium" },
          { value: "Outside", label: "Defense costs" },
          { value: "Worldwide", label: "Coverage" },
        ],
      },
    ],
    valuables: [
      {
        kind: "stats",
        title: "Collections by the numbers",
        items: [
          { value: "6%", label: "Avg annual appreciation" },
          { value: "3y", label: "Recommended appraisal refresh" },
          { value: "Worldwide", label: "Scheduled coverage" },
          { value: "All-risk", label: "Form" },
        ],
      },
    ],
    generic: [
      {
        kind: "stats",
        title: "What a review tends to surface",
        items: [
          { value: "12%", label: "Avg premium savings" },
          { value: "4 of 5", label: "Policies missing a discount" },
          { value: "15 min", label: "Call time" },
          { value: "0%", label: "Cost to review" },
        ],
      },
    ],
  };
  return bank[accent] ?? bank.generic;
}

function highlightsVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): HighlightsSection[] {
  // Every set uses a "Why X now?" question-form title and BENEFIT-
  // focused item labels (what the client gets / avoids), not feature
  // labels (what's in the policy). Matches the reference pamphlet's
  // "Why reinstate your coverage now? → Restore full driving
  // protection / Avoid a coverage gap before your first drive…"
  // pattern.
  const bank: Record<string, HighlightsSection[]> = {
    winter: [
      {
        kind: "highlights",
        title: "Why reinstate your coverage now?",
        items: [
          { icon: "shield-check", label: "Restore full driving protection" },
          { icon: "calendar", label: "Avoid a coverage gap before your first drive" },
          { icon: "users", label: "Make sure liability and other coverages are active" },
          { icon: "wheel", label: "Get road ready for spring and summer" },
        ],
      },
      {
        kind: "highlights",
        title: "Why review your storage coverage?",
        items: [
          { icon: "lock", label: "Stay protected from theft while stored" },
          { icon: "flame", label: "Stay protected from fire and vandalism" },
          { icon: "cloud-rain", label: "Stay protected from storm and storage damage" },
          { icon: "shield-check", label: "Confirm coverage before the first drive back" },
        ],
      },
    ],
    spring: [
      {
        kind: "highlights",
        title: "Why refresh coverage this spring?",
        items: [
          { icon: "wheel", label: "Bring stored vehicles back online" },
          { icon: "home", label: "Re-verify home limits after the winter season" },
          { icon: "shield-check", label: "Confirm liability follows new spring activities" },
          { icon: "calendar", label: "Schedule the year's first portfolio review" },
        ],
      },
    ],
    summer: [
      {
        kind: "highlights",
        title: "Why tune coverage for summer?",
        items: [
          { icon: "car", label: "Cover the road trips and rentals" },
          { icon: "anchor", label: "Confirm watercraft is properly insured" },
          { icon: "home", label: "Protect the second home or seasonal rental" },
          { icon: "shield-check", label: "Make sure liability follows the family" },
        ],
      },
    ],
    fall: [
      {
        kind: "highlights",
        title: "Why button up before winter?",
        items: [
          { icon: "home", label: "Document the roof and gutters" },
          { icon: "droplets", label: "Confirm water-backup coverage is in place" },
          { icon: "shield-check", label: "Schedule a year-end portfolio review" },
          { icon: "calendar", label: "Lock in next year's premium and dates" },
        ],
      },
    ],
    storm: [
      {
        kind: "highlights",
        title: "Why review coastal coverage now?",
        items: [
          { icon: "cloud-rain", label: "Lock in wind and hurricane limits before the cone" },
          { icon: "droplets", label: "Right-size flood and named-storm deductibles" },
          { icon: "shield-check", label: "Capture every wind-mitigation discount on file" },
          { icon: "home", label: "Match dwelling limits to today's rebuild cost" },
        ],
      },
    ],
    flood: [
      {
        kind: "highlights",
        title: "Why a flood policy now?",
        items: [
          { icon: "droplets", label: "Cover rising-water damage your home policy excludes" },
          { icon: "home", label: "Protect the foundation and lower-level finishes" },
          { icon: "shield-check", label: "Cover building and contents on the right policy" },
          { icon: "clock", label: "Start the 30-day waiting period sooner" },
        ],
      },
    ],
    wildfire: [
      {
        kind: "highlights",
        title: "Why fireproof your coverage?",
        items: [
          { icon: "flame", label: "Right-size dwelling for today's rebuild cost" },
          { icon: "home", label: "Document defensible-space credits" },
          { icon: "shield-check", label: "Confirm smoke-remediation coverage" },
          { icon: "wallet", label: "Cover additional living expense for evacuation" },
        ],
      },
    ],
    earthquake: [
      {
        kind: "highlights",
        title: "Why an earthquake endorsement?",
        items: [
          { icon: "bolt", label: "Close the standard-policy gap" },
          { icon: "home", label: "Cover foundation and structural repair" },
          { icon: "wallet", label: "Protect against six- and seven-figure losses" },
          { icon: "shield-check", label: "Add coverage that costs less than most assume" },
        ],
      },
    ],
    renewal: [
      {
        kind: "highlights",
        title: "Why re-shop at renewal?",
        items: [
          { icon: "refresh", label: "Test the market across every carrier we represent" },
          { icon: "sparkles", label: "Capture every discount you now qualify for" },
          { icon: "shield-check", label: "Match limits to today's values and exposures" },
          { icon: "calendar", label: "Confirm dates, autopay, and beneficiaries" },
        ],
      },
    ],
    newpolicy: [
      {
        kind: "highlights",
        title: "What we will set up together",
        items: [
          { icon: "shield-check", label: "Walk you through what is and is not covered" },
          { icon: "calendar", label: "Set up autopay and renewal reminders" },
          { icon: "users", label: "Add household members and drivers correctly" },
          { icon: "mail", label: "Make sure you know how to reach us fast" },
        ],
      },
    ],
    home: [
      {
        kind: "highlights",
        title: "Why review your home policy?",
        items: [
          { icon: "home", label: "Right-size dwelling and other-structures limits" },
          { icon: "gem", label: "Schedule new valuables properly" },
          { icon: "shield-check", label: "Align liability and umbrella for today's assets" },
          { icon: "droplets", label: "Add water-backup and overlooked endorsements" },
        ],
      },
    ],
    newhome: [
      {
        kind: "highlights",
        title: "Why set this up properly?",
        items: [
          { icon: "home", label: "Match dwelling to true replacement cost" },
          { icon: "shield-check", label: "Add the umbrella most new owners miss" },
          { icon: "droplets", label: "Include water-backup before the first storm" },
          { icon: "calendar", label: "Schedule the first-year follow-up" },
        ],
      },
    ],
    remodel: [
      {
        kind: "highlights",
        title: "Why update before the work starts?",
        items: [
          { icon: "home", label: "Add a builder's-risk endorsement" },
          { icon: "shield-check", label: "Notify the carrier so claims are not denied" },
          { icon: "wallet", label: "Re-rate dwelling for the new finished value" },
          { icon: "users", label: "Confirm liability for contractors on site" },
        ],
      },
    ],
    luxury_home: [
      {
        kind: "highlights",
        title: "Why a private-client policy?",
        items: [
          { icon: "home", label: "Cash-out and extended replacement cost" },
          { icon: "gem", label: "Worldwide contents with blanket schedule" },
          { icon: "shield-check", label: "Excess liability sized for the estate" },
          { icon: "users", label: "Service from a dedicated specialist" },
        ],
      },
    ],
    auto: [
      {
        kind: "highlights",
        title: "Why tune your auto policy?",
        items: [
          { icon: "car", label: "Match liability to your actual assets" },
          { icon: "wheel", label: "Add roadside, rental, and rideshare where it pays off" },
          { icon: "sparkles", label: "Capture every multi-policy and safe-driver discount" },
          { icon: "shield-check", label: "Right-size comprehensive and collision deductibles" },
        ],
      },
    ],
    luxury_auto: [
      {
        kind: "highlights",
        title: "Why an agreed-value policy?",
        items: [
          { icon: "car", label: "Lock in the value, not depreciated book" },
          { icon: "wheel", label: "Specify original-parts replacement" },
          { icon: "shield-check", label: "Add spare-parts and tools coverage" },
          { icon: "compass", label: "Cover track-day and exhibition use" },
        ],
      },
    ],
    motorcycle: [
      {
        kind: "highlights",
        title: "Why tune your motorcycle coverage?",
        items: [
          { icon: "car", label: "Schedule helmets, jackets, and gear" },
          { icon: "shield-check", label: "Right-size liability for road exposure" },
          { icon: "sparkles", label: "Add accessories and aftermarket parts" },
          { icon: "wheel", label: "Confirm trailer and transport coverage" },
        ],
      },
    ],
    rv: [
      {
        kind: "highlights",
        title: "Why confirm RV coverage?",
        items: [
          { icon: "car", label: "Right-size liability for vacation use" },
          { icon: "shield-check", label: "Add personal-effects coverage" },
          { icon: "compass", label: "Confirm towing and emergency-expense" },
          { icon: "calendar", label: "Adjust full-timer vs. recreational classification" },
        ],
      },
    ],
    boat: [
      {
        kind: "highlights",
        title: "Why review marine coverage?",
        items: [
          { icon: "anchor", label: "Right-size hull and P&I limits" },
          { icon: "wave", label: "Confirm tow-and-assist coverage" },
          { icon: "shield-check", label: "Schedule electronics and personal effects" },
          { icon: "compass", label: "Verify navigational territory" },
        ],
      },
    ],
    jewelry: [
      {
        kind: "highlights",
        title: "Why refresh the schedule?",
        items: [
          { icon: "gem", label: "Match scheduled limits to today's replacement cost" },
          { icon: "compass", label: "Carry worldwide all-risk protection" },
          { icon: "shield-check", label: "Cover mysterious disappearance" },
          { icon: "sparkles", label: "Insure pairs and sets at full value" },
        ],
      },
    ],
    valuables: [
      {
        kind: "highlights",
        title: "Why refresh the collection?",
        items: [
          { icon: "gem", label: "Update scheduled values to today's market" },
          { icon: "compass", label: "Confirm worldwide all-risk coverage" },
          { icon: "shield-check", label: "Meet loss-prevention requirements" },
          { icon: "sparkles", label: "Cover new acquisitions automatically" },
        ],
      },
    ],
    art: [
      {
        kind: "highlights",
        title: "Why a private-collection policy?",
        items: [
          { icon: "sparkles", label: "Worldwide all-risk coverage" },
          { icon: "shield-check", label: "Restoration and conservation provisions" },
          { icon: "calendar", label: "Newly-acquired coverage between appraisals" },
          { icon: "compass", label: "Covered while on loan or in transit" },
        ],
      },
    ],
    wine: [
      {
        kind: "highlights",
        title: "Why schedule your cellar?",
        items: [
          { icon: "sparkles", label: "Breakage, leakage, and mechanical failure" },
          { icon: "shield-check", label: "Heat- and temperature-failure provisions" },
          { icon: "calendar", label: "Re-valuation as the market moves" },
          { icon: "wallet", label: "Coverage at agreed value, not cost" },
        ],
      },
    ],
    umbrella: [
      {
        kind: "highlights",
        title: "Why right-size your umbrella?",
        items: [
          { icon: "umbrella", label: "Add excess on top of auto and home" },
          { icon: "scale", label: "Cover defense costs outside the policy limit" },
          { icon: "compass", label: "Carry worldwide liability protection" },
          { icon: "shield-check", label: "Align underlying limits with carrier requirements" },
        ],
      },
    ],
    liability: [
      {
        kind: "highlights",
        title: "Why align your liability?",
        items: [
          { icon: "scale", label: "Match limits to today's assets" },
          { icon: "shield-check", label: "Layer auto, home, and umbrella correctly" },
          { icon: "users", label: "Cover household members and incidents" },
          { icon: "compass", label: "Carry coverage that follows you worldwide" },
        ],
      },
    ],
    life: [
      {
        kind: "highlights",
        title: "Why review your life coverage?",
        items: [
          { icon: "heart", label: "Match face amount to today's obligations" },
          { icon: "users", label: "Confirm beneficiaries are current" },
          { icon: "shield-check", label: "Compare term, whole, and hybrid options" },
          { icon: "calendar", label: "Lock in rates while you are still insurable" },
        ],
      },
    ],
    health: [
      {
        kind: "highlights",
        title: "Why review your health plan?",
        items: [
          { icon: "heart", label: "Compare ACA, group, and supplemental options" },
          { icon: "wallet", label: "Right-size deductible against premium" },
          { icon: "users", label: "Confirm provider network and prescription coverage" },
          { icon: "shield-check", label: "Add the supplemental coverage that pays out" },
        ],
      },
    ],
    wedding: [
      {
        kind: "highlights",
        title: "Why insure the day?",
        items: [
          { icon: "gem", label: "Schedule the ring properly before the engagement party" },
          { icon: "shield-check", label: "Cover cancellation, postponement, and vendor failure" },
          { icon: "users", label: "Add event liability for the venue" },
          { icon: "compass", label: "Cover wedding-day attire and gifts" },
        ],
      },
    ],
    newbaby: [
      {
        kind: "highlights",
        title: "Why update coverage now?",
        items: [
          { icon: "heart", label: "Re-rate life insurance for the new chapter" },
          { icon: "umbrella", label: "Right-size umbrella for the new responsibility" },
          { icon: "users", label: "Update beneficiaries and guardians" },
          { icon: "shield-check", label: "Add the optional coverages parents miss" },
        ],
      },
    ],
    business: [
      {
        kind: "highlights",
        title: "Why review the business policy?",
        items: [
          { icon: "trending-up", label: "Right-size GL and product liability" },
          { icon: "users", label: "Confirm workers' comp matches headcount" },
          { icon: "shield-check", label: "Add professional liability for what you sell" },
          { icon: "lock", label: "Add cyber for the way you actually operate" },
        ],
      },
    ],
    cyber: [
      {
        kind: "highlights",
        title: "Why real cyber coverage?",
        items: [
          { icon: "lock", label: "Pay out on ransomware events" },
          { icon: "shield-check", label: "Cover social-engineering and wire-transfer fraud" },
          { icon: "users", label: "Include breach response and notification" },
          { icon: "wallet", label: "Cover business interruption from downtime" },
        ],
      },
    ],
    holidays: [
      {
        kind: "highlights",
        title: "Why a holiday coverage check?",
        items: [
          { icon: "compass", label: "Cover travel and trip cancellation" },
          { icon: "gem", label: "Travel with valuables properly insured" },
          { icon: "home", label: "Protect the home while away" },
          { icon: "shield-check", label: "Verify package and gift coverage" },
        ],
      },
    ],
    newyear: [
      {
        kind: "highlights",
        title: "Why an annual portfolio review?",
        items: [
          { icon: "refresh", label: "Re-shop every line of coverage" },
          { icon: "shield-check", label: "Match limits to today's life" },
          { icon: "calendar", label: "Update beneficiaries and payment preferences" },
          { icon: "sparkles", label: "Capture every discount in the market" },
        ],
      },
    ],
    generic: [
      {
        kind: "highlights",
        title: "Why review your coverage?",
        items: [
          { icon: "shield-check", label: "Match your limits to today's risk" },
          { icon: "refresh", label: "Re-shop the market for better rates" },
          { icon: "sparkles", label: "Capture every discount you qualify for" },
          { icon: "calendar", label: "Update payment and autopay preferences" },
        ],
      },
    ],
  };
  return bank[accent] ?? bank.generic;
}

function comparisonVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  _ctx: SectionContext
): ComparisonSection[] {
  const generic: ComparisonSection = {
    kind: "comparison",
    title: "Why review now?",
    columns: [
      {
        heading: "Without a review",
        tone: "negative",
        items: [
          "Old limits, today's costs",
          "Missing the discounts you qualify for",
          "Coverage gaps you'd find at claim time",
          "Auto-renewal at last year's premium",
        ],
      },
      {
        heading: "With our review",
        tone: "positive",
        items: [
          "Limits sized to current values",
          "Every discount captured",
          "Gaps surfaced before they hurt you",
          "Re-shopped pricing across our carriers",
        ],
      },
    ],
  };

  const bank: Record<string, ComparisonSection[]> = {
    storm: [
      {
        kind: "comparison",
        title: "Wind-mitigated vs. not",
        columns: [
          {
            heading: "Without wind-mit on file",
            tone: "negative",
            items: [
              "Full retail premium",
              "No discount stack",
              "Higher named-storm deductible",
              "Higher out-of-pocket post-claim",
            ],
          },
          {
            heading: "With wind-mit on file",
            tone: "positive",
            items: [
              "Up to 45% discount",
              "Lower deductible options",
              "Better carrier appetite",
              "Faster claim handling",
            ],
          },
        ],
      },
    ],
    umbrella: [
      {
        kind: "comparison",
        title: "Umbrella worth having",
        columns: [
          {
            heading: "Without umbrella",
            tone: "negative",
            items: [
              "Liability stops at policy limit",
              "Defense costs come out of limit",
              "Personal assets exposed",
              "No worldwide coverage",
            ],
          },
          {
            heading: "With umbrella",
            tone: "positive",
            items: [
              "Excess limit kicks in over auto/home",
              "Defense costs outside the limit",
              "Assets protected up to your limit",
              "Worldwide coverage",
            ],
          },
        ],
      },
    ],
    renewal: [
      {
        kind: "comparison",
        title: "Auto-renew vs. reviewed renew",
        columns: [
          {
            heading: "Auto-renew",
            tone: "negative",
            items: [
              "Last year's pricing",
              "Same limits regardless of value changes",
              "No new-carrier comparison",
              "Same discounts (or missing new ones)",
            ],
          },
          {
            heading: "Reviewed renewal",
            tone: "positive",
            items: [
              "Re-shopped across our carriers",
              "Limits aligned to today's values",
              "Side-by-side carrier comparison",
              "Every discount you qualify for",
            ],
          },
        ],
      },
    ],
    generic: [generic],
  };
  return bank[accent] ?? bank.generic;
}

function testimonialVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): TestimonialSection[] {
  const generic: TestimonialSection = {
    kind: "testimonial",
    quote: `"${ctx.agencyName} caught two gaps in my old policy I didn't even know I had — and shaved my premium. Worth the 15-minute call."`,
    attribution: "— Client review",
    rating: 5,
  };
  const bank: Record<string, TestimonialSection[]> = {
    storm: [
      {
        kind: "testimonial",
        quote: `"After Hurricane Ian I called other clients of ${ctx.agencyName}. Every single one was paid out faster than mine through a national carrier."`,
        attribution: "— Coastal client",
        rating: 5,
      },
    ],
    luxury_home: [
      {
        kind: "testimonial",
        quote: `"They placed my home with a HNW carrier I didn't know I qualified for. Better coverage, same premium. Should've called sooner."`,
        attribution: "— Private client",
        rating: 5,
      },
    ],
    jewelry: [
      {
        kind: "testimonial",
        quote: `"They scheduled my engagement ring properly the week of the proposal. When the bezel snapped a year later, the replacement was handled in 48 hours."`,
        attribution: "— Client review",
        rating: 5,
      },
    ],
    auto: [
      {
        kind: "testimonial",
        quote: `"Saved $1,400 over my last carrier and added roadside. The whole call was 12 minutes."`,
        attribution: "— Auto client",
        rating: 5,
      },
    ],
    umbrella: [
      {
        kind: "testimonial",
        quote: `"They added a $2M umbrella to my policy for less than my monthly streaming bill. Sleep so much better."`,
        attribution: "— Umbrella client",
        rating: 5,
      },
    ],
    generic: [generic],
  };
  return bank[accent] ?? bank.generic;
}

function stepsVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): StepsSection[] {
  const generic: StepsSection = {
    kind: "steps",
    title: "How a review works",
    items: [
      { label: "Reply or call", detail: "We schedule a 15-min review on your terms." },
      { label: "We pull current limits + values", detail: "No paperwork from you." },
      { label: "We re-shop the market", detail: "Side-by-side options across our carriers." },
      { label: "You decide", detail: "No pressure. Same advisor every term." },
    ],
  };
  const bank: Record<string, StepsSection[]> = {
    storm: [
      {
        kind: "steps",
        title: "Your storm-season prep",
        items: [
          { label: "Confirm wind-mitigation form is on file" },
          { label: "Review named-storm deductible" },
          { label: "Quote separate flood policy (if applicable)" },
          { label: "Lock everything in before tropical activity opens the cone" },
        ],
      },
    ],
    renewal: [
      {
        kind: "steps",
        title: "Your renewal in 4 steps",
        items: [
          { label: "We re-shop your coverage across our carriers" },
          { label: "We refresh appraisals + verify every discount" },
          { label: "You see a side-by-side comparison" },
          { label: "You pick. We bind. Same advisor next term." },
        ],
      },
    ],
    auto: [
      {
        kind: "steps",
        title: "Auto review steps",
        items: [
          { label: "Confirm vehicles + drivers" },
          { label: "Verify liability matches your assets" },
          { label: "Stack discounts (multi-policy, safe-driver, etc.)" },
          { label: "Add roadside / rental / rideshare where it pays" },
        ],
      },
    ],
    generic: [generic],
  };
  return bank[accent] ?? bank.generic;
}

function faqVariants(
  accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): FaqSection[] {
  const generic: FaqSection = {
    kind: "faq",
    title: "Questions we hear a lot",
    items: [
      {
        q: "Will this cost me anything?",
        a: "No. Coverage reviews are part of being a client of ours.",
      },
      {
        q: "How long does it take?",
        a: "About 15 minutes. We do the legwork before the call.",
      },
      {
        q: "Do I have to switch carriers?",
        a: "Never. We re-shop, you decide. Same advisor either way.",
      },
    ],
  };
  const bank: Record<string, FaqSection[]> = {
    storm: [
      {
        kind: "faq",
        title: "Storm-season FAQ",
        items: [
          {
            q: "When do carriers stop binding?",
            a: "The moment a tropical system enters the cone — usually 72 hours before landfall. We bind well before that.",
          },
          {
            q: "Do I need separate flood coverage?",
            a: "If you're below the BFE or near the coast, almost certainly. Standard homeowners excludes rising water.",
          },
          {
            q: "What is wind mitigation?",
            a: "An inspection that documents your roof shape, attachments, openings, etc. It can reduce wind premium up to 45%.",
          },
        ],
      },
    ],
    auto: [
      {
        kind: "faq",
        title: "Auto FAQ",
        items: [
          {
            q: "Is the cheapest policy the best?",
            a: "Not when it's time to claim. We look at carrier reputation + the policy's actual coverages, not just price.",
          },
          {
            q: "Should I bundle?",
            a: "Often yes — bundling unlocks multi-policy discounts AND simplifies claims when multiple policies are involved.",
          },
          {
            q: "What's underinsured motorist?",
            a: "Coverage for when the at-fault driver doesn't have enough liability to cover your damages. Often overlooked.",
          },
        ],
      },
    ],
    umbrella: [
      {
        kind: "faq",
        title: "Umbrella FAQ",
        items: [
          {
            q: "How much umbrella do I need?",
            a: "Generally enough to cover your net worth + future income. We help you size it.",
          },
          {
            q: "What does it cost?",
            a: "$1M umbrellas often run ~$300/yr, scaling down as a percentage on each additional million.",
          },
          {
            q: "When does it kick in?",
            a: "Above your underlying auto/home liability limit. Defense costs are usually outside that limit.",
          },
        ],
      },
    ],
    generic: [generic],
  };
  return bank[accent] ?? bank.generic;
}

function ctaVariants(
  accent: PamphletAccent,
  tone: PamphletTone,
  ctx: SectionContext
): CtaSection[] {
  const agency = ctx.agencyName;
  const close = toneStamp(tone).close;
  // Every accent gets an accent-specific action verb in the button
  // and a key phrase highlighted in the title — matches the reference
  // pamphlet style where the verb defines the next step ("Reinstate",
  // "Quote", "Lock in") instead of the generic "Request a review".
  const bank: Record<string, CtaSection[]> = {
    winter: [
      {
        kind: "cta",
        title: `Before you drive again, review and reinstate your vehicle coverage with ${agency}.`,
        highlight: "reinstate your vehicle coverage",
        button: "Reinstate my coverage",
        subtext: close,
      },
    ],
    spring: [
      {
        kind: "cta",
        title: `Before the season is in full swing, refresh your seasonal coverage with ${agency}.`,
        highlight: "refresh your seasonal coverage",
        button: "Refresh my coverage",
        subtext: close,
      },
    ],
    summer: [
      {
        kind: "cta",
        title: `Before the family hits the road, tune your summer coverage with ${agency}.`,
        highlight: "tune your summer coverage",
        button: "Tune my coverage",
        subtext: close,
      },
    ],
    fall: [
      {
        kind: "cta",
        title: `Before the weather turns, button up your home coverage with ${agency}.`,
        highlight: "button up your home coverage",
        button: "Button up my coverage",
        subtext: close,
      },
    ],
    storm: [
      {
        kind: "cta",
        title: `Before the season opens, harden your coastal coverage with ${agency}.`,
        highlight: "harden your coastal coverage",
        button: "Harden my coverage",
        subtext: close,
      },
    ],
    flood: [
      {
        kind: "cta",
        title: `Bind your flood policy with ${agency} — the 30-day waiting period starts the day you sign.`,
        highlight: "Bind your flood policy",
        button: "Bind a flood policy",
        subtext: close,
      },
    ],
    wildfire: [
      {
        kind: "cta",
        title: `Before the dry season, fireproof your coverage with ${agency}.`,
        highlight: "fireproof your coverage",
        button: "Fireproof my coverage",
        subtext: close,
      },
    ],
    earthquake: [
      {
        kind: "cta",
        title: `Add an earthquake endorsement with ${agency} and close the standard-policy gap.`,
        highlight: "Add an earthquake endorsement",
        button: "Add earthquake coverage",
        subtext: close,
      },
    ],
    renewal: [
      {
        kind: "cta",
        title: `Before your renewal locks in, re-shop your coverage with ${agency}.`,
        highlight: "re-shop your coverage",
        button: "Re-shop my renewal",
        subtext: close,
      },
    ],
    newpolicy: [
      {
        kind: "cta",
        title: `Welcome aboard — schedule your onboarding call with ${agency} to set the foundation right.`,
        highlight: "schedule your onboarding call",
        button: "Schedule onboarding",
        subtext: close,
      },
    ],
    home: [
      {
        kind: "cta",
        title: `Walk through your home policy with ${agency} — the heavy lifting is on us.`,
        highlight: "Walk through your home policy",
        button: "Review my home policy",
        subtext: close,
      },
    ],
    newhome: [
      {
        kind: "cta",
        title: `Get your first home policy set up properly with ${agency}.`,
        highlight: "set up properly",
        button: "Set up my policy",
        subtext: close,
      },
    ],
    remodel: [
      {
        kind: "cta",
        title: `Before the work begins, loop your carrier in with ${agency}.`,
        highlight: "loop your carrier in",
        button: "Update my coverage",
        subtext: close,
      },
    ],
    luxury_home: [
      {
        kind: "cta",
        title: `Review your private-client home coverage with ${agency}.`,
        highlight: "private-client home coverage",
        button: "Review my coverage",
        subtext: close,
      },
    ],
    auto: [
      {
        kind: "cta",
        title: `In fifteen minutes, tune your auto coverage with ${agency} — no obligation.`,
        highlight: "tune your auto coverage",
        button: "Tune my auto policy",
        subtext: close,
      },
    ],
    luxury_auto: [
      {
        kind: "cta",
        title: `Properly insure your collector vehicle with ${agency} — agreed value, original parts.`,
        highlight: "agreed value, original parts",
        button: "Review my collector policy",
        subtext: close,
      },
    ],
    motorcycle: [
      {
        kind: "cta",
        title: `Before riding season, tune your motorcycle coverage with ${agency}.`,
        highlight: "tune your motorcycle coverage",
        button: "Tune my coverage",
        subtext: close,
      },
    ],
    rv: [
      {
        kind: "cta",
        title: `Before the next trip, confirm your RV coverage with ${agency}.`,
        highlight: "confirm your RV coverage",
        button: "Review my RV policy",
        subtext: close,
      },
    ],
    boat: [
      {
        kind: "cta",
        title: `Before the season opens, review your marine coverage with ${agency}.`,
        highlight: "review your marine coverage",
        button: "Review my marine policy",
        subtext: close,
      },
    ],
    jewelry: [
      {
        kind: "cta",
        title: `Refresh your scheduled valuables with ${agency} — current appraisals keep claims clean.`,
        highlight: "Refresh your scheduled valuables",
        button: "Refresh my schedule",
        subtext: close,
      },
    ],
    valuables: [
      {
        kind: "cta",
        title: `Refresh your collection coverage with ${agency} — appraisals, schedule, worldwide protection.`,
        highlight: "Refresh your collection coverage",
        button: "Refresh my collection",
        subtext: close,
      },
    ],
    art: [
      {
        kind: "cta",
        title: `Schedule your fine art with ${agency} on a private-collection inland-marine policy.`,
        highlight: "Schedule your fine art",
        button: "Schedule my collection",
        subtext: close,
      },
    ],
    wine: [
      {
        kind: "cta",
        title: `Insure your cellar properly with ${agency} — breakage, leakage, and re-valuation.`,
        highlight: "Insure your cellar properly",
        button: "Schedule my cellar",
        subtext: close,
      },
    ],
    umbrella: [
      {
        kind: "cta",
        title: `Right-size your umbrella with ${agency} — protect what you've built.`,
        highlight: "Right-size your umbrella",
        button: "Right-size my umbrella",
        subtext: close,
      },
    ],
    liability: [
      {
        kind: "cta",
        title: `Align your liability limits across auto, home, and umbrella with ${agency}.`,
        highlight: "Align your liability limits",
        button: "Align my limits",
        subtext: close,
      },
    ],
    life: [
      {
        kind: "cta",
        title: `Walk through your life insurance options with ${agency} — without the sales pitch.`,
        highlight: "Walk through your life insurance",
        button: "Review my life options",
        subtext: close,
      },
    ],
    health: [
      {
        kind: "cta",
        title: `Get clear on your health coverage with ${agency} — ACA, group, and supplemental.`,
        highlight: "Get clear on your health coverage",
        button: "Review my health plan",
        subtext: close,
      },
    ],
    wedding: [
      {
        kind: "cta",
        title: `Insure the ring and the day with ${agency} — one short call.`,
        highlight: "Insure the ring and the day",
        button: "Schedule my coverage",
        subtext: close,
      },
    ],
    newbaby: [
      {
        kind: "cta",
        title: `Update your coverage for the new family chapter with ${agency}.`,
        highlight: "Update your coverage for the new family chapter",
        button: "Update my coverage",
        subtext: close,
      },
    ],
    business: [
      {
        kind: "cta",
        title: `Review your business coverage with ${agency} — GL, workers' comp, professional, cyber.`,
        highlight: "Review your business coverage",
        button: "Review my business policy",
        subtext: close,
      },
    ],
    cyber: [
      {
        kind: "cta",
        title: `Quote real cyber coverage with ${agency} — the kind that actually pays out.`,
        highlight: "Quote real cyber coverage",
        button: "Quote cyber coverage",
        subtext: close,
      },
    ],
    holidays: [
      {
        kind: "cta",
        title: `Protect the season with ${agency} — travel, valuables, and home-while-away.`,
        highlight: "Protect the season",
        button: "Schedule a check-in",
        subtext: close,
      },
    ],
    newyear: [
      {
        kind: "cta",
        title: `Start the year with a clean coverage review by ${agency}.`,
        highlight: "clean coverage review",
        button: "Schedule my review",
        subtext: close,
      },
    ],
    generic: [
      {
        kind: "cta",
        title: `Schedule your coverage review with ${agency} — fifteen minutes, no obligation.`,
        highlight: "Schedule your coverage review",
        button: "Schedule my review",
        subtext: close,
      },
    ],
  };
  return bank[accent] ?? bank.generic;
}

function disclaimerVariants(
  _accent: PamphletAccent,
  _tone: PamphletTone,
  ctx: SectionContext
): DisclaimerSection[] {
  return [
    {
      kind: "disclaimer",
      text: `${ctx.agencyName} — Trusted coverage. Personalized guidance. This pamphlet is for informational purposes only and does not modify any insurance contract. Final terms, conditions, and exclusions are governed by the issued policy.`,
    },
    {
      kind: "disclaimer",
      text: `Marketing material. ${ctx.agencyName} represents multiple carriers and recommends coverage based on your stated needs. Premium and discount estimates are illustrative; actual quotes require underwriting.`,
    },
  ];
}

function firstSentenceN(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  const cut = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return cut.length > n ? `${cut.slice(0, n - 1)}…` : cut;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanAudienceLabel(audience: DraftCampaignAudience[]): string {
  const labels: Record<DraftCampaignAudience, string> = {
    all_clients: "all clients",
    all_prospects: "all prospects",
    auto_clients: "auto-policy clients",
    coastal_home_clients: "coastal-home clients",
    high_value_clients: "high-value-asset clients",
    renewal_clients: "renewal clients",
  };
  return audience.map((a) => labels[a]).join(" + ");
}

function audienceFirstWord(audience: DraftCampaignAudience[]): string {
  return humanAudienceLabel(audience).split(" ")[0] ?? "client";
}

// =====================================================================
// Inbound-message triage.
//
// Scans an incoming message from a client / prospect / carrier and
// decides whether it warrants an Activity Center task. Pure
// acknowledgements ("thanks!", "got it") are ignored; anything that
// asks for something or signals a coverage / claim / payment / document
// event becomes an activity. Returns the activity's title, topic, and
// severity so the auto-creator can stamp a useful card.
// =====================================================================

export interface InboundTriage {
  warrants: boolean;
  title: string;
  topic: TaskTopic;
  severity: "urgent" | "warning" | "info";
  reason: string;
}

export function aiClassifyInboundForActivity(input: {
  body: string;
  subject?: string;
  channel?: string;
  contactName?: string;
  contactKind?: "client" | "prospect" | "carrier";
}): InboundTriage {
  const text = `${input.subject ?? ""} ${input.body ?? ""}`.toLowerCase().trim();
  const who = input.contactName ?? "Contact";
  const has = (re: RegExp) => re.test(text);
  const noActivity = (): InboundTriage => ({
    warrants: false,
    title: "",
    topic: "other",
    severity: "info",
    reason: "",
  });

  // Pure acknowledgements / pleasantries → no activity.
  const ACK = /^(thanks|thank you|thx|ty|ok|okay|k|got it|great|perfect|sounds good|will do|received|no problem|np|cheers|appreciate it|👍+|🙏+)[!.\s]*$/i;
  if (!text || ACK.test(text) || (text.length < 6 && !text.includes("?"))) {
    return noActivity();
  }

  const mk = (
    topic: TaskTopic,
    severity: InboundTriage["severity"],
    label: string
  ): InboundTriage => ({
    warrants: true,
    title: `${who}: ${label}`,
    topic,
    severity,
    reason: `AI read an inbound ${
      input.channel ? input.channel.toUpperCase() + " " : ""
    }message and opened this activity — "${firstSentence(input.body)}"`,
  });

  // Highest-urgency events first.
  if (has(/\b(accident|collision|crash|stolen|theft|burglar|fire|flood|water damage|hail|storm damage|damaged|loss|lawsuit|injured|injury)\b/) ||
      has(/\b(file|open|start|report)\b[\s\S]{0,20}\bclaim\b/) ||
      has(/\bclaim\b/)) {
    return mk("claim_filed", "urgent", "possible claim / loss reported");
  }
  if (has(/\b(cancel|cancellation|terminate|drop|discontinue)\b/)) {
    return mk("cancellation_request", "urgent", "wants to cancel coverage");
  }
  if (has(/\b(add|adding|insure|cover|new)\b[\s\S]{0,40}\b(vehicle|car|auto|truck|suv|driver|boat|yacht|jewelry|ring|watch|home|house|property|condo|asset|rv|motorcycle)\b/)) {
    return mk("coverage_change", "warning", "wants to add to their policy");
  }
  if (has(/\b(increase|decrease|raise|lower|change|update|adjust|add|remove)\b[\s\S]{0,30}\b(coverage|limit|deductible|endorsement|policy)\b/)) {
    return mk("coverage_change", "warning", "requested a coverage change");
  }
  if (has(/\b(payment|invoice|bill|billed|charge|charged|refund|autopay|past due|overdue|premium)\b/)) {
    return mk("payment_issue", "warning", "has a billing / payment question");
  }
  if (has(/\b(document|upload|sign|signature|e-?sign|form|declaration|dec page|proof of insurance|paperwork|attachment)\b/)) {
    return mk("document_upload", "warning", "documents needed / sent");
  }
  if (has(/\b(renew|renewal|expire|expiring|expiration)\b/)) {
    return mk("renewal_approaching", "warning", "renewal question");
  }
  if (has(/\b(quote|premium|price|pricing|rate|estimate)\b/)) {
    return mk("coverage_change", "warning", "asking about a quote / pricing");
  }
  // Generic question / request that needs a human response.
  if (has(/\?|\b(can you|could you|would you|please|need|how do|how can|when|why|what about|let me know|follow up|following up|waiting)\b/)) {
    return mk("other", "info", "has a question that needs a reply");
  }
  return noActivity();
}

function firstSentence(s: string): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  const cut = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return cut.length > 90 ? `${cut.slice(0, 87)}…` : cut;
}
