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

describe("/api/google-place-details", () => {
  it("returns structured address parts for the selected Google place", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        formattedAddress: "901 McDonald Drive, Northville, MI 48167, USA",
        addressComponents: [
          { longText: "901", shortText: "901", types: ["street_number"] },
          { longText: "McDonald Drive", shortText: "McDonald Dr", types: ["route"] },
          { longText: "Northville", shortText: "Northville", types: ["locality"] },
          { longText: "Michigan", shortText: "MI", types: ["administrative_area_level_1"] },
          { longText: "48167", shortText: "48167", types: ["postal_code"] },
        ],
      }),
    });

    const handler = (await import("../google-place-details")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { placeId: "ChIJ-fake-1", sessionToken: "tok" } }, res);

    expect(res.state.status).toBe(200);
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toContain("https://places.googleapis.com/v1/places/ChIJ-fake-1");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("server-google-key");
    expect(res.state.json).toEqual({
      formattedAddress: "901 McDonald Drive, Northville, MI 48167",
      parts: {
        street: "901 McDonald Drive",
        apt: "",
        city: "Northville",
        state: "MI",
        zip: "48167",
      },
    });
  });

  it("does not accept browser-prefixed VITE Google keys as server credentials", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "public-key-should-not-work");

    const handler = (await import("../google-place-details")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { placeId: "ChIJ-fake-1", sessionToken: "tok" } }, res);

    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "google_places_not_configured" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
