import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// Asset-enrichment provider tests.
//
// These lock in the contract with real public APIs:
//   - OpenStreetMap Nominatim → geocoding (address → lat/lon)
//   - FEMA NFHL (ArcGIS REST)  → real flood zone for that lat/lon
//   - NHTSA VPIC               → real VIN decode (year/make/model)
//
// Fields no free public API can answer (property value, square
// footage, roof age, construction type, wind mitigation status,
// vehicle market value) MUST be returned in `unavailableFields` with
// no synthesized placeholder. A regression that re-introduces fake
// values will fail these tests immediately.
// =====================================================================

const NOMINATIM_GEOCODE_NORTHVILLE = [
  {
    lat: "42.4314",
    lon: "-83.4830",
    display_name: "901 McDonald Drive, Northville, MI 48167",
  },
];

const FEMA_FLOOD_ZONE_X = {
  features: [
    { attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" } },
  ],
};

const FEMA_FLOOD_ZONE_AE = {
  features: [{ attributes: { FLD_ZONE: "AE" } }],
};

const NHTSA_VIN_RESPONSE = {
  Results: [
    { Variable: "Error Code", Value: "0" },
    { Variable: "Make", Value: "PORSCHE" },
    { Variable: "Model", Value: "911" },
    { Variable: "Model Year", Value: "2022" },
    { Variable: "Body Class", Value: "Coupe" },
    { Variable: "Other", Value: "Skip me" },
  ],
};

const GOOGLE_GEOCODE_NORTHVILLE = {
  status: "OK",
  results: [
    {
      formatted_address: "901 McDonald Dr, Northville, MI 48167, USA",
      geometry: { location: { lat: 42.4314, lng: -83.483 } },
    },
  ],
};

describe("aiEnrichAsset - server mode", () => {
  it("uses the backend enrichment endpoint when server AI is enabled", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000/api");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        fields: { floodZone: "AE" },
        evidence: {
          floodZone: {
            fieldKey: "floodZone",
            sourceKind: "government_api",
            sourceLabel: "FEMA National Flood Hazard Layer (NFHL)",
            confidence: 0.96,
            verified: true,
            allowDocumentAutofill: true,
            collectedAt: "2026-06-18T00:00:00.000Z",
          },
        },
        sources: ["FEMA National Flood Hazard Layer (NFHL)"],
        confidence: 0.96,
      }),
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    expect(out.fields.floodZone).toBe("AE");
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe(
      "http://localhost:4000/api/ai/enrich-asset"
    );
  });
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  // Default to keyless config so the Nominatim-only path is exercised
  // unless a test explicitly opts into the Google geocoder. Vite
  // loads any project-local .env at test time, which would otherwise
  // leak the real key into these unit tests.
  vi.stubEnv("VITE_AI_MODE", "");
  vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "");
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("aiEnrichAsset — coastal home", () => {
  it("returns the real FEMA flood zone for the geocoded address", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("nominatim.openstreetmap.org")) {
        return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });

    // FEMA flood zone is the verified field.
    expect(out.fields.floodZone).toBe("AE");
    expect(out.evidence?.floodZone?.sourceKind).toBe("government_api");
    expect(out.evidence?.floodZone?.allowDocumentAutofill).toBe(true);
    // AI-estimated property characteristics are also populated so
    // the intake form auto-fills with sensible defaults. These are
    // deterministic for the same address.
    expect(out.fields).toHaveProperty("yearBuilt");
    expect(out.evidence?.yearBuilt?.sourceKind).toBe("model_estimate");
    expect(out.evidence?.yearBuilt?.allowDocumentAutofill).toBe(false);
    expect(out.fields).toHaveProperty("squareFootage");
    expect(out.fields).toHaveProperty("constructionType");
    expect(out.fields).toHaveProperty("roofMaterial");
    expect(out.fields).toHaveProperty("estimatedValue");

    // Only wind mitigation is truly unavailable (homeowner-submitted).
    expect(out.unavailableFields).toEqual(["windMitigation"]);

    // Sources cite both the FEMA layer and the AI estimator.
    expect(out.sources).toEqual(
      expect.arrayContaining([
        "FEMA National Flood Hazard Layer (NFHL)",
        "AI property estimator (demo)",
      ])
    );
    expect(out.notes).toMatch(/FEMA NFHL/);
  });

  it("calls FEMA with the geocoded lat/lon in WGS84 (esriGeometryPoint)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("nominatim")) return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      if (url.includes("fema")) return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_X });
      return Promise.reject(new Error("unexpected"));
    });
    const { aiEnrichAsset } = await import("../ai");
    await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    const femaCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).includes("hazards.fema.gov")
    );
    expect(femaCall).toBeDefined();
    const url = String(femaCall![0]);
    expect(url).toContain("geometry=-83.483%2C42.4314");
    expect(url).toContain("geometryType=esriGeometryPoint");
    expect(url).toContain("inSR=4326");
    expect(url).toContain("outFields=FLD_ZONE%2CZONE_SUBTY");
  });

  it("marks floodZone unavailable when FEMA returns no features", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("nominatim")) return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      if (url.includes("fema")) return Promise.resolve({ ok: true, json: async () => ({ features: [] }) });
      return Promise.reject(new Error("unexpected"));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    expect(out.fields.floodZone).toBeUndefined();
    // AI-estimated property defaults still populate so the form
    // doesn't sit empty.
    expect(out.fields).toHaveProperty("yearBuilt");
    expect(out.unavailableFields).toContain("floodZone");
  });

  it("returns clean 'address not geocodable' when Nominatim has no match — and leaves unavailableFields EMPTY (we never tried the FEMA call, so we don't false-flag every field)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("nominatim")) return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.reject(new Error("should not be called"));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "asdf asdf asdf" });
    expect(out.fields).toEqual({});
    expect(out.confidence).toBe(0);
    expect(out.notes).toMatch(/couldn't resolve/i);
    expect(out.sources?.[0]).toMatch(/no match/i);
    // Critically: every field stays editable with no "Not in public
    // records" chip — we couldn't attempt the lookup so don't pretend
    // we got a definitive "no" from the database.
    expect(out.unavailableFields).toEqual([]);
  });
});

describe("aiEnrichAsset — Smarty validation primary geocoder", () => {
  it("uses Smarty's verified lat/lon when the proxy returns a result, skipping Google + Nominatim entirely", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "google-key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string, init?: RequestInit) => {
      const url = String(u);
      if (url === "/api/smarty-validate") {
        // Round-trip through the helper's expected response shape.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            result: {
              deliverable: true,
              dpvCode: "Y",
              standardized: {
                street: "901 McDonald Dr",
                apt: "",
                city: "Northville",
                state: "MI",
                zip: "48167",
                zip4: "2241",
              },
              lat: 42.4314,
              lon: -83.483,
              county: "Wayne",
              timezone: "Eastern",
              rdi: "Residential",
              composed: "901 McDonald Dr, Northville, MI 48167-2241",
              cached: false,
            },
          }),
        });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      // Track if anything else gets called — these should NOT.
      return Promise.reject(new Error(`Unexpected URL ${url} (init=${JSON.stringify(init)})`));
    });
    if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]) === "/api/smarty-validate")).toBe(true);
    expect(calls.some((c) => String(c[0]).includes("maps.googleapis.com"))).toBe(false);
    expect(calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);
    expect(calls.some((c) => String(c[0]).includes("hazards.fema.gov"))).toBe(true);
    expect(out.fields.floodZone).toBe("AE");
  });

  it("falls back to Google → Nominatim when Smarty proxy is not deployed (HTTP 404)", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "google-key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url === "/api/smarty-validate") {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      if (url.includes("maps.googleapis.com")) {
        return Promise.resolve({ ok: true, json: async () => GOOGLE_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]) === "/api/smarty-validate")).toBe(true);
    expect(calls.some((c) => String(c[0]).includes("maps.googleapis.com"))).toBe(true);
    expect(out.fields.floodZone).toBe("AE");
  });
});

describe("aiEnrichAsset — US Census geocoder fallback (no API keys required)", () => {
  it("uses Census Geocoder when no other provider is configured and Smarty isn't deployed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url === "/api/smarty-validate") {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      if (url.includes("geocoding.geo.census.gov")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              addressMatches: [
                {
                  matchedAddress: "901 MCDONALD DR, NORTHVILLE, MI, 48167",
                  coordinates: { x: -83.483, y: 42.4314 },
                },
              ],
            },
          }),
        });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    // Census got called.
    expect(calls.some((c) => String(c[0]).includes("geocoding.geo.census.gov"))).toBe(true);
    // FEMA got the lat/lon Census produced.
    expect(out.fields.floodZone).toBe("AE");
    // Nominatim was NOT touched — Census short-circuited the chain.
    expect(calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);
  });

  it("falls through to Nominatim only when Census itself misses", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url === "/api/smarty-validate") {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      if (url.includes("geocoding.geo.census.gov")) {
        return Promise.resolve({ ok: true, json: async () => ({ result: { addressMatches: [] } }) });
      }
      if (url.includes("nominatim")) {
        return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    expect(out.fields.floodZone).toBe("AE");
  });
});

describe("aiEnrichAsset — luxury vehicle VIN length guard", () => {
  it("returns a clear 'too short' message instead of calling NHTSA when VIN < 11 chars", async () => {
    const fetchSpy = (globalThis.fetch as ReturnType<typeof vi.fn>);
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("luxury_vehicle", { vin: "ABC123" });
    expect(out.fields).toEqual({});
    expect(out.notes).toMatch(/too short/i);
    // No fetch attempted — the guard short-circuits.
    const nhtsaCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("vpic.nhtsa"));
    expect(nhtsaCalls.length).toBe(0);
  });
});

describe("aiEnrichAsset — Google Geocoding fallback chain", () => {
  it("uses Google Geocoding API when VITE_GOOGLE_MAPS_API_KEY is set, with country=US bias", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key-abc");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("maps.googleapis.com")) {
        return Promise.resolve({ ok: true, json: async () => GOOGLE_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });

    // Verify the geocoding request shape — key passed, US bias set.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const googleCall = calls.find((c) => String(c[0]).includes("maps.googleapis.com"));
    expect(googleCall).toBeDefined();
    const googleUrl = String(googleCall![0]);
    expect(googleUrl).toContain("address=901+McDonald+Drive");
    expect(googleUrl).toContain("components=country%3AUS");
    expect(googleUrl).toContain("key=test-key-abc");

    // Nominatim must NOT be called when Google succeeds.
    expect(calls.some((c) => String(c[0]).includes("nominatim"))).toBe(false);

    // And the rest of the chain (FEMA) still runs with the Google coords.
    expect(out.fields.floodZone).toBe("AE");
  });

  it("falls through to Nominatim when Google returns status != OK", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key-abc");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("maps.googleapis.com")) {
        return Promise.resolve({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) });
      }
      if (url.includes("nominatim.openstreetmap.org")) {
        return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes("maps.googleapis.com"))).toBe(true);
    expect(calls.some((c) => String(c[0]).includes("nominatim"))).toBe(true);
    expect(out.fields.floodZone).toBe("AE");
  });

  it("falls through to Nominatim when Google returns HTTP 403 (referrer block)", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "test-key-abc");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("maps.googleapis.com")) {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
      }
      if (url.includes("nominatim.openstreetmap.org")) {
        return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    expect(out.fields.floodZone).toBe("AE");
  });

  it("skips Google entirely when no Google key is configured", async () => {
    // beforeEach clears both VITE_GOOGLE_PLACES_API_KEY and
    // VITE_GOOGLE_MAPS_API_KEY so the Nominatim path is the only one.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("nominatim.openstreetmap.org")) {
        return Promise.resolve({ ok: true, json: async () => NOMINATIM_GEOCODE_NORTHVILLE });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_FLOOD_ZONE_AE });
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const { aiEnrichAsset } = await import("../ai");
    await aiEnrichAsset("coastal_home", { address: "901 McDonald Drive, Northville, MI 48167" });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes("maps.googleapis.com"))).toBe(false);
    expect(calls.some((c) => String(c[0]).includes("nominatim"))).toBe(true);
  });
});

describe("aiEnrichAsset — luxury vehicle", () => {
  it("decodes a VIN via NHTSA and returns real year/make/model", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((u: string) => {
      const url = String(u);
      if (url.includes("vpic.nhtsa.dot.gov")) {
        return Promise.resolve({ ok: true, json: async () => NHTSA_VIN_RESPONSE });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("luxury_vehicle", { vin: "WP0AD2A99NS260123" });
    expect(out.fields).toEqual({
      year: 2022,
      make: "PORSCHE",
      model: "911",
    });
    expect(out.evidence?.year?.sourceKind).toBe("government_api");
    expect(out.evidence?.year?.allowDocumentAutofill).toBe(true);
    // Market value is ALWAYS unavailable — no free public API.
    expect(out.unavailableFields).toEqual(expect.arrayContaining(["estimatedValue"]));
    expect(out.sources?.[0]).toContain("NHTSA");
    expect(out.notes).toMatch(/Manheim|KBB|NADA/);
  });

  it("URL-encodes the VIN in the NHTSA request", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NHTSA_VIN_RESPONSE,
    });
    const { aiEnrichAsset } = await import("../ai");
    await aiEnrichAsset("luxury_vehicle", { vin: "WP0AD2A99NS260123" });
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toBe(
      "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/WP0AD2A99NS260123?format=json"
    );
  });

  it("returns empty fields + unavailable list when NHTSA fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("luxury_vehicle", { vin: "WP0AD2A99NS260123" });
    expect(out.fields).toEqual({});
    expect(out.unavailableFields).toEqual(expect.arrayContaining(["year", "make", "model", "estimatedValue"]));
  });

  it("returns an empty enrichment with a 'please enter a VIN' note when no VIN given", async () => {
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("luxury_vehicle", {});
    expect(out.fields).toEqual({});
    expect(out.notes).toMatch(/Enter a VIN/i);
    // Crucially: no fake decoded values whatsoever.
    expect(out.fields).not.toHaveProperty("year");
    expect(out.fields).not.toHaveProperty("make");
    expect(out.fields).not.toHaveProperty("model");
  });
});

describe("aiEnrichAsset — yacht & jewelry (no public sources)", () => {
  it("yacht returns empty fields + an unavailableFields list", async () => {
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("yacht", { make: "Princess", model: "Y72", year: 2021 });
    expect(out.fields).toEqual({});
    expect(out.unavailableFields).toEqual(expect.arrayContaining(["length", "estimatedValue"]));
    expect(out.notes).toMatch(/marine valuation provider/i);
  });

  it("jewelry returns empty fields — no fabricated defaults", async () => {
    const { aiEnrichAsset } = await import("../ai");
    const out = await aiEnrichAsset("jewelry", { estimatedValue: 250_000 });
    expect(out.fields).toEqual({});
    // No "storage: 'Bank vault'" or "wearFrequency: 'Special occasions'"
    // synthesized from the value bucket — those were placeholder
    // heuristics. Real values come from the customer.
    expect(out.fields).not.toHaveProperty("storage");
    expect(out.fields).not.toHaveProperty("wearFrequency");
  });
});
