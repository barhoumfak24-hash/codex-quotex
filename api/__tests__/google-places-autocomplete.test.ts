import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockRes() {
  const state: { status: number; json: unknown } = { status: 200, json: null };
  return {
    state,
    setHeader: vi.fn(),
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: unknown) {
      state.json = payload;
      return this;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "server-google-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/google-places-autocomplete", () => {
  it("calls Google server-side and returns normalized address suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-fake-1",
              text: { text: "901 McDonald Drive, Northville, MI 48167, USA" },
            },
          },
        ],
      }),
    });

    const handler = (await import("../google-places-autocomplete")).default;
    const res = mockRes();
    await handler(
      { method: "POST", body: { query: "901 McDonald Dr, Northville", sessionToken: "tok" } },
      res
    );

    expect(res.state.status).toBe(200);
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("server-google-key");
    const body = JSON.parse(String(init?.body));
    expect(body.input).toBe("901 McDonald Dr, Northville");
    expect(body.includedPrimaryTypes).toEqual(["street_address", "premise", "subpremise"]);
    expect(body.includedRegionCodes).toEqual(["us"]);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "ChIJ-fake-1",
          description: "901 McDonald Drive, Northville, MI 48167",
          googlePlaceId: "ChIJ-fake-1",
        },
      ],
    });
  });

  it("does not leak the Google key when upstream fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "denied" } }),
    });

    const handler = (await import("../google-places-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "901 McDonald" } }, res);

    expect(res.state.status).toBe(502);
    expect(JSON.stringify(res.state.json)).not.toContain("server-google-key");
  });

  it("does not accept browser-prefixed VITE Google keys as server credentials", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "public-key-should-not-work");

    const handler = (await import("../google-places-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "901 McDonald" } }, res);

    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "google_places_not_configured" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("accepts two-character searches and forwards validated location bias", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ-fake-90",
              text: { text: "9070 7 Mile Rd, Northville, MI 48167, USA" },
            },
          },
        ],
      }),
    });

    const handler = (await import("../google-places-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "90",
          sessionToken: "tok",
          locationBias: {
            latitude: 42.4311,
            longitude: -83.4833,
            radiusMeters: 75_000,
          },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.input).toBe("90");
    expect(body.locationBias).toBeUndefined();
    expect(body.locationRestriction).toEqual({
      circle: {
        center: {
          latitude: 42.4311,
          longitude: -83.4833,
        },
        radius: 50_000,
      },
    });
  });
});
