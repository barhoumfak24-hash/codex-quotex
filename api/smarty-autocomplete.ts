// Server-side Smarty US Autocomplete Pro proxy.
//
// The browser must not receive SMARTY_AUTH_ID / SMARTY_AUTH_TOKEN.
// This endpoint signs autocomplete requests on the server and returns
// only normalized suggestions for the UI dropdown.

import { applyRateLimit } from "./_rateLimit.js";

const SMARTY_AUTOCOMPLETE_BASE = "https://us-autocomplete-pro.api.smarty.com/lookup";

interface RequestPayload {
  query?: string;
  maxResults?: number;
}

interface SmartySuggestion {
  street_line?: string;
  secondary?: string;
  entries?: number;
  city?: string;
  state?: string;
  zipcode?: string;
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
    !(await applyRateLimit(req, res, "smarty-autocomplete", {
      windowMs: 60_000,
      limit: 120,
      failOpen: true,
    }))
  ) {
    return;
  }

  const authId = process.env.SMARTY_AUTH_ID;
  const authToken = process.env.SMARTY_AUTH_TOKEN;
  if (!authId || !authToken) {
    res.status(503).json({ error: "smarty_not_configured" });
    return;
  }

  const body: RequestPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const query = normalizeQuery(body.query);
  if (query.length < 2) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const url = new URL(SMARTY_AUTOCOMPLETE_BASE);
  url.searchParams.set("auth-id", authId);
  url.searchParams.set("auth-token", authToken);
  url.searchParams.set("search", query.slice(0, 32));
  url.searchParams.set("source", "all");
  url.searchParams.set("max_results", String(clamp(body.maxResults ?? 10, 1, 10)));

  const headers: HeadersInit = {};
  const forwardedFor = firstForwardedIp(req.headers?.["x-forwarded-for"]);
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), { headers });
  } catch (error) {
    console.error("[smarty-autocomplete] upstream fetch failed", error);
    res.status(502).json({ error: "smarty_unreachable" });
    return;
  }

  if (upstream.status === 429) {
    res.status(429).json({ error: "smarty_rate_limited" });
    return;
  }
  if (upstream.status === 402) {
    console.error("[smarty-autocomplete] upstream HTTP", upstream.status);
    res.status(503).json({ error: "smarty_not_available" });
    return;
  }
  if (!upstream.ok) {
    console.error("[smarty-autocomplete] upstream HTTP", upstream.status);
    res.status(502).json({ error: "smarty_upstream_error", status: upstream.status });
    return;
  }

  let data: { suggestions?: SmartySuggestion[] };
  try {
    data = (await upstream.json()) as { suggestions?: SmartySuggestion[] };
  } catch (error) {
    console.error("[smarty-autocomplete] failed to parse Smarty JSON", error);
    res.status(502).json({ error: "smarty_bad_response" });
    return;
  }

  res.status(200).json({
    suggestions: (data.suggestions ?? []).map(toPrediction).filter(Boolean),
  });
}

function toPrediction(s: SmartySuggestion): AddressPrediction | null {
  const street = [s.street_line, s.secondary].filter(Boolean).join(" ").trim();
  const tail = [s.state, s.zipcode].filter(Boolean).join(" ").trim();
  const description = [street, s.city, tail].filter(Boolean).join(", ");
  if (!description) return null;
  return {
    id: description.replace(/\s+/g, "_"),
    description,
  };
}

function normalizeQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : max));
}

function firstForwardedIp(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw.split(",")[0]?.trim() ?? "";
}

function safeJsonParse(s: string): RequestPayload {
  try {
    return JSON.parse(s) as RequestPayload;
  } catch {
    return {};
  }
}

export const __SMARTY_AUTOCOMPLETE_BASE = SMARTY_AUTOCOMPLETE_BASE;
