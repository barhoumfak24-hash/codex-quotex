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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/nominatim-search", () => {
  it("preserves the typed house number for a road-level Nominatim match", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          place_id: 373059960,
          display_name: "McDonald Drive, Pheasant Hills, Northville, Michigan, 48167, United States",
          address: {
            road: "McDonald Drive",
            village: "Northville",
            state: "Michigan",
            "ISO3166-2-lvl4": "US-MI",
            postcode: "48167",
          },
        },
      ],
    });

    const handler = (await import("../nominatim-search")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "901 McDonald Dr, Northville",
          locationBias: { latitude: 42.4314, longitude: -83.483, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [{ id: "373059960", description: "901 McDonald Drive, Northville, MI 48167" }],
    });

    const [calledUrl, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.hostname).toBe("nominatim.openstreetmap.org");
    expect(url.searchParams.get("q")).toBe("901 McDonald Dr, Northville");
    expect(url.searchParams.get("viewbox")).toBeTruthy();
    expect(options.headers["User-Agent"]).toContain("QuotexInsurance");
  });

  it("does not use Nominatim as a two-character browser autocomplete feed", async () => {
    const handler = (await import("../nominatim-search")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "90" } }, res);

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({ suggestions: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when Nominatim blocks or throttles the request", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    const handler = (await import("../nominatim-search")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "901 McDonald Dr, Northville" } }, res);

    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "nominatim_unavailable", status: 403 });
  });
});
