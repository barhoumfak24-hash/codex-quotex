import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CENSUS_MATCH = {
  result: {
    addressMatches: [
      {
        matchedAddress: "901 MCDONALD DR, NORTHVILLE, MI, 48167",
        coordinates: { x: -83.483, y: 42.4314 },
      },
    ],
  },
};

const FEMA_ZONE_X = {
  features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" } }],
};

function openAiOutput(payload: unknown) {
  return {
    ok: true,
    text: async () => JSON.stringify({ output_text: JSON.stringify(payload) }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_ASSET_ENRICHMENT_CACHE_TTL_MS", "0");
  vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server aiEnrichAsset public-data guardrails", () => {
  it("keeps only cited OpenAI web-search fields and rejects uncited or estimated property facts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("geocoding.geo.census.gov")) {
        return Promise.resolve({ ok: true, json: async () => CENSUS_MATCH });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_ZONE_X });
      }
      if (url.includes("api.openai.com/v1/responses")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: "web_search" })]));
        expect(body.tool_choice).toBe("required");
        const prompt = JSON.stringify(body.input ?? body);
        expect(prompt).toContain("county assessor");
        expect(prompt).toContain("building-permit");
        expect(prompt).toContain("FEMA National Flood Hazard Layer");
        expect(prompt).toContain("Zillow");
        expect(prompt).toContain("Redfin");
        expect(prompt).toContain("do not rely on realtor.com or any single listing site");
        expect(prompt).toContain("Aggregate and cross-verify");
        return Promise.resolve(
          openAiOutput({
            fieldEntries: [
              {
                key: "yearBuilt",
                value: "2007",
                confidence: 0.91,
                sourceKind: "public_web",
                sourceLabel: "Oakland County Property Gateway",
                sourceUrl: "https://example.test/property/901-mcdonald",
                verified: true,
                notes: "County property record page.",
              },
              {
                key: "squareFootage",
                value: "6500",
                confidence: 0.9,
                sourceKind: "public_web",
                sourceLabel: "Missing citation",
                sourceUrl: "",
                verified: true,
                notes: "No citation should be rejected.",
              },
              {
                key: "roofMaterial",
                value: "Architectural shingle",
                confidence: 0.72,
                sourceKind: "model_estimate",
                sourceLabel: "OpenAI inference",
                sourceUrl: "",
                verified: false,
                notes: "Estimated from exterior style.",
              },
              {
                key: "roofAge",
                value: "Unknown; verify with applicant",
                confidence: 0.75,
                sourceKind: "public_web",
                sourceLabel: "County page",
                sourceUrl: "https://example.test/property/901-mcdonald",
                verified: true,
                notes: "Unavailable note should be rejected as a field value.",
              },
            ],
            unavailableFields: ["lossHistory"],
            sources: [{ title: "Oakland County Property Gateway", url: "https://example.test/property/901-mcdonald" }],
            notes: "Cited public property research complete.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiEnrichAsset } = await import("../index.js");
    const out = await aiEnrichAsset({
      assetType: "coastal_home",
      seed: { address: "901 McDonald Drive, Northville, MI 48167" },
    });

    expect(out.fields.address).toBe("901 MCDONALD DR, NORTHVILLE, MI, 48167");
    expect(out.fields.floodZone).toBe("X");
    expect(out.fields.yearBuilt).toBe("2007");
    expect(out.fields.squareFootage).toBeUndefined();
    expect(out.fields.roofMaterial).toBeUndefined();
    expect(out.evidence?.yearBuilt?.sourceKind).toBe("web_search");
    expect(out.evidence?.yearBuilt?.sourceUrl).toBe("https://example.test/property/901-mcdonald");
    expect(out.evidence?.yearBuilt?.allowDocumentAutofill).toBe(true);
    expect(out.evidence?.yearBuilt?.notes).toContain("https://example.test/property/901-mcdonald");
    expect(out.unavailableFields).toEqual(expect.arrayContaining(["squareFootage", "roofMaterial", "roofAge", "lossHistory"]));
  });

  it("returns jewelry fields unavailable instead of running a public-data guess", async () => {
    const { aiEnrichAsset } = await import("../index.js");
    const out = await aiEnrichAsset({
      assetType: "jewelry",
      seed: { description: "Rolex watch" },
    });

    expect(out.fields).toEqual({});
    expect(out.confidence).toBe(0);
    expect(out.unavailableFields).toEqual(
      expect.arrayContaining(["appraisedValue", "estimatedValue", "storageLocation", "wearFrequency"])
    );
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("only returns fields that match the supplied questionnaire targets", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("geocoding.geo.census.gov")) {
        return Promise.resolve({ ok: true, json: async () => CENSUS_MATCH });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_ZONE_X });
      }
      if (url.includes("api.openai.com/v1/responses")) {
        return Promise.resolve(
          openAiOutput({
            fieldEntries: [
              {
                key: "yearBuilt",
                value: "2007",
                confidence: 0.91,
                sourceKind: "public_web",
                sourceLabel: "Oakland County Property Gateway",
                sourceUrl: "https://oakgov.example.gov/property/901-mcdonald",
                verified: true,
                notes: "County property record page.",
              },
              {
                key: "squareFootage",
                value: "6500",
                confidence: 0.91,
                sourceKind: "public_web",
                sourceLabel: "Oakland County Property Gateway",
                sourceUrl: "https://oakgov.example.gov/property/901-mcdonald",
                verified: true,
                notes: "County property record page.",
              },
            ],
            unavailableFields: ["squareFootage"],
            sources: [{ title: "Oakland County Property Gateway", url: "https://oakgov.example.gov/property/901-mcdonald" }],
            notes: "Target-scoped public property research complete.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiEnrichAsset } = await import("../index.js");
    const out = await aiEnrichAsset({
      assetType: "coastal_home",
      seed: { address: "901 McDonald Drive, Northville, MI 48167" },
      targetQuestions: [{ key: "yearBuilt", label: "Year built", inputType: "number", required: true }],
    });

    expect(out.fields.yearBuilt).toBe("2007");
    expect(out.fields.squareFootage).toBeUndefined();
    expect(out.fields.address).toBeUndefined();
    expect(out.fields.floodZone).toBeUndefined();
    expect(out.unavailableFields).not.toContain("squareFootage");
  });

  it("caches the same normalized asset identifier when caching is enabled", async () => {
    vi.stubEnv("AI_ASSET_ENRICHMENT_CACHE_TTL_MS", "60000");
    let openAiCalls = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("geocoding.geo.census.gov")) {
        return Promise.resolve({ ok: true, json: async () => CENSUS_MATCH });
      }
      if (url.includes("hazards.fema.gov")) {
        return Promise.resolve({ ok: true, json: async () => FEMA_ZONE_X });
      }
      if (url.includes("api.openai.com/v1/responses")) {
        openAiCalls += 1;
        return Promise.resolve(
          openAiOutput({
            fieldEntries: [],
            unavailableFields: ["yearBuilt"],
            sources: [],
            notes: "No cited public property facts found.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiEnrichAsset } = await import("../index.js");
    const first = await aiEnrichAsset({
      assetType: "coastal_home",
      seed: { address: "901 McDonald Drive, Northville, MI 48167" },
    });
    const second = await aiEnrichAsset({
      assetType: "coastal_home",
      seed: { address: " 901  McDonald Drive, Northville, MI 48167 " },
    });

    expect(first).toEqual(second);
    expect(openAiCalls).toBe(1);
  });

  it("sends VIN research to OpenAI with the exact identifier prompt and accepts cited vehicle corrections", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("vpic.nhtsa.dot.gov")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            Results: [
              {
                ErrorCode: "0",
                ErrorText: "0 - VIN decoded clean. Check Digit valid.",
                ModelYear: "2024",
                Make: "PORSCHE",
                Model: "911",
                Series: "Carrera",
                Trim: "",
                BodyClass: "Coupe",
                VehicleType: "PASSENGER CAR",
              },
            ],
          }),
        });
      }
      if (url.includes("api.openai.com/v1/responses")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { input?: Array<{ content?: string }> };
        const prompt = String(body.input?.[1]?.content ?? "");
        expect(prompt).toContain(
          "FIND ALL PUBLIC INFORMATION ON THIS VIN/ASSET NUMBER: WP0AB2A99RS123456"
        );
        expect(prompt).toContain("NHTSA VIN decoder");
        expect(prompt).toContain("manufacturer public specifications");
        expect(prompt).toContain("J.D. Power");
        expect(prompt).toContain("KBB");
        expect(prompt).toContain("CARFAX");
        return Promise.resolve(
          openAiOutput({
            fieldEntries: [
              {
                key: "model",
                value: "911 Turbo S",
                confidence: 0.82,
                sourceKind: "public_web",
                sourceLabel: "Edmunds public VIN listing",
                sourceUrl: "https://www.edmunds.com/porsche/911/2024/vin-WP0AB2A99RS123456",
                verified: true,
                notes: "VIN-specific listing identifies trim.",
              },
              {
                key: "estimatedValue",
                value: "$245,000",
                confidence: 0.78,
                sourceKind: "commercial_provider",
                sourceLabel: "J.D. Power valuation page",
                sourceUrl: "https://www.jdpower.com/cars/vin/WP0AB2A99RS123456",
                verified: true,
                notes: "Public valuation range.",
              },
            ],
            unavailableFields: [],
            sources: [{ title: "Edmunds public VIN listing", url: "https://www.edmunds.com/porsche/911/2024/vin-WP0AB2A99RS123456" }],
            notes: "OpenAI VIN research complete.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiEnrichAsset } = await import("../index.js");
    const out = await aiEnrichAsset({
      assetType: "luxury_vehicle",
      seed: { vin: "WP0AB2A99RS123456" },
    });

    expect(out.fields.year).toBe(2024);
    expect(out.fields.make).toBe("PORSCHE");
    expect(out.fields.model).toBe("911 Turbo S");
    expect(out.fields.estimatedValue).toBe("$245,000");
    expect(out.evidence?.model?.sourceKind).toBe("web_search");
    expect(out.sources).toEqual(expect.arrayContaining(["NHTSA VIN decoder (vpic.nhtsa.dot.gov)"]));
  });

  it("still runs OpenAI VIN research when NHTSA is unavailable", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string) => {
      const url = String(input);
      if (url.includes("vpic.nhtsa.dot.gov")) {
        return Promise.resolve({ ok: false });
      }
      if (url.includes("api.openai.com/v1/responses")) {
        return Promise.resolve(
          openAiOutput({
            fieldEntries: [
              {
                key: "year",
                value: "2023",
                confidence: 0.86,
                sourceKind: "public_web",
                sourceLabel: "CARFAX public VIN result",
                sourceUrl: "https://www.carfax.com/vehicle/ZFF95NLA0P0287654",
                verified: true,
                notes: "VIN-specific public source.",
              },
              {
                key: "model",
                value: "Roma",
                confidence: 0.86,
                sourceKind: "public_web",
                sourceLabel: "CARFAX public VIN result",
                sourceUrl: "https://www.carfax.com/vehicle/ZFF95NLA0P0287654",
                verified: true,
                notes: "VIN-specific public source.",
              },
            ],
            unavailableFields: [],
            sources: [{ title: "CARFAX public VIN result", url: "https://www.carfax.com/vehicle/ZFF95NLA0P0287654" }],
            notes: "OpenAI VIN research completed after NHTSA failed.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiEnrichAsset } = await import("../index.js");
    const out = await aiEnrichAsset({
      assetType: "luxury_vehicle",
      seed: { vin: "ZFF95NLA0P0287654" },
    });

    expect(out.fields.year).toBe(2023);
    expect(out.fields.model).toBe("Roma");
    expect(out.sources).toEqual(expect.arrayContaining(["NHTSA VIN decoder (request failed)"]));
  });

  it("skips property imagery without a server-side Google Maps key", async () => {
    const { aiAnalyzePropertyImagery } = await import("../index.js");
    const out = await aiAnalyzePropertyImagery({
      address: "901 McDonald Dr, Northville, MI 48167",
      lat: 42.4314,
      lon: -83.483,
    });

    expect(out.fields).toEqual({});
    expect(out.confidence).toBe(0);
    expect(out.notes).toMatch(/Google Maps key/i);
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("marks property imagery findings as advisory and never document-autofill eligible", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "google-test-key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("streetview/metadata")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "OK",
            pano_id: "pano-123",
            date: "2024-05",
            location: { lat: 42.4315, lng: -83.4829 },
          }),
        });
      }
      if (url.includes("maps.googleapis.com/maps/api/streetview?") || url.includes("staticmap")) {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          })
        );
      }
      if (url.includes("api.openai.com/v1/responses")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { input?: Array<{ content?: unknown }> };
        expect(Array.isArray(body.input?.[1]?.content)).toBe(true);
        return Promise.resolve(
          openAiOutput({
            findings: [
              {
                feature: "pool",
                value: "Visible in rear yard",
                confidence: 0.88,
                sourceImage: "aerial",
                captureDate: "2024-05",
                notDeterminable: false,
                rationale: "Blue rectangular pool is visible behind the structure.",
              },
              {
                feature: "roof material",
                value: "Not determinable",
                confidence: 0.2,
                sourceImage: "aerial",
                captureDate: "2024-05",
                notDeterminable: true,
                rationale: "Image is too low resolution.",
              },
            ],
            summary: "One advisory imagery finding.",
          })
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });

    const { aiAnalyzePropertyImagery } = await import("../index.js");
    const out = await aiAnalyzePropertyImagery({
      address: "901 McDonald Dr, Northville, MI 48167",
      lat: 42.4314,
      lon: -83.483,
    });

    expect(Array.isArray(out.fields.imageryFindings)).toBe(true);
    expect(out.fields.detachedStructuresAndRecreation).toBeUndefined();
    expect(out.evidence?.["imagery.pool"]).toMatchObject({
      sourceKind: "imagery_vision",
      verified: false,
      allowDocumentAutofill: false,
      observedDate: "2024-05",
    });
    expect(out.evidence?.detachedStructuresAndRecreation).toBeUndefined();
    expect(out.evidence?.["imagery.pool"]?.sourceUrl).toContain("key=redacted");
    expect(out.unavailableFields).toEqual(expect.arrayContaining(["imagery.pool", "imagery.roof-material"]));
  });
});
