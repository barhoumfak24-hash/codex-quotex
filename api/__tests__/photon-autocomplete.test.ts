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

describe("/api/photon-autocomplete", () => {
  it("returns normalized house suggestions with location bias", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-83.48, 42.43] },
            properties: {
              housenumber: "9070",
              street: "7 Mile Road",
              city: "Northville",
              state: "Michigan",
              postcode: "48167",
              countrycode: "US",
              osm_type: "W",
              osm_id: 123,
            },
          },
        ],
      }),
    });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "90",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 50_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:123:9070 7 Mile Road, Northville, MI 48167",
          description: "9070 7 Mile Road, Northville, MI 48167",
        },
      ],
    });

    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.hostname).toBe("photon.komoot.io");
    expect(url.searchParams.get("q")).toBe("90");
    expect(url.searchParams.getAll("layer")).toEqual(["house", "street"]);
    expect(url.searchParams.get("countrycode")).toBe("US");
    expect(url.searchParams.get("lat")).toBe("42.4311");
    expect(url.searchParams.get("lon")).toBe("-83.4833");
    expect(url.searchParams.get("bbox")).toBeTruthy();
  });

  it("preserves a typed house number when Photon returns a road-level result", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-83.473, 42.42] },
            properties: {
              name: "McDonald Drive",
              city: "Northville",
              state: "Michigan",
              postcode: "48167",
              countrycode: "US",
              osm_key: "highway",
              osm_type: "W",
              osm_id: 456,
            },
          },
        ],
      }),
    });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "901 McDonald Dr, Northville" } }, res);

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:456:901 McDonald Drive, Northville, MI 48167",
          description: "901 McDonald Drive, Northville, MI 48167",
        },
      ],
    });
  });

  it("adds nearby city context for short numeric searches", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: {
            geographies: {
              "Incorporated Places": [{ BASENAME: "Northville" }],
              States: [{ STUSAB: "MI" }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
            {
              properties: {
                name: "Northville Road",
                city: "Northville Charter Township",
                state: "Michigan",
                postcode: "48167",
                countrycode: "US",
                osm_key: "highway",
                osm_type: "W",
                osm_id: 443184418,
              },
            },
          ],
        }),
      });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "90",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:443184418:90 Northville Road, Northville Charter Township, MI 48167",
          description: "90 Northville Road, Northville Charter Township, MI 48167",
        },
      ],
    });

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0])
    );
    expect(calls[1]).toContain("geocoding.geo.census.gov/geocoder/geographies/coordinates");
    expect(new URL(calls[2]).searchParams.get("q")).toBe("90 Northville");
    expect(new URL(calls[3]).pathname).toBe("/structured");
    expect(new URL(calls[3]).searchParams.get("housenumber")).toBe("90");
    expect(new URL(calls[3]).searchParams.get("street")).toBe("Northville");
  });

  it("does not return business POIs that happen to be located on a matching street", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-83.483, 42.431] },
            properties: {
              name: "McDonald's",
              housenumber: "15110",
              street: "Beck Road",
              city: "Plymouth Charter Township",
              state: "Michigan",
              postcode: "48170",
              countrycode: "US",
              osm_key: "amenity",
              osm_value: "fast_food",
              osm_type: "N",
              osm_id: 1,
            },
          },
        ],
      }),
    });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "McDonald" } }, res);

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({ suggestions: [] });
  });

  it("keeps options visible for short partial street prefixes by falling back to house number plus locality", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: {
            geographies: {
              "Incorporated Places": [{ BASENAME: "Northville" }],
              States: [{ STUSAB: "MI" }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
          {
            geometry: { coordinates: [-83.482, 42.432] },
            properties: {
                name: "McDonald Drive",
                city: "Northville",
                state: "Michigan",
                postcode: "48167",
                countrycode: "US",
                osm_key: "highway",
                osm_type: "W",
                osm_id: 443184418,
              },
            },
          ],
        }),
      });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "901 Mc",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:443184418:901 McDonald Drive, Northville, MI 48167",
          description: "901 McDonald Drive, Northville, MI 48167",
        },
      ],
    });

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0])
    );
    expect(new URL(calls.at(-1) ?? "").searchParams.get("q")).toBe("Mc");
  });

  it("uses the first typed road character to narrow local suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: {
            geographies: {
              "Incorporated Places": [{ BASENAME: "Northville" }],
              States: [{ STUSAB: "MI" }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
          {
            geometry: { coordinates: [-83.477, 42.423] },
            properties: {
                name: "Main Street",
                city: "Northville",
                state: "Michigan",
                postcode: "48167",
                countrycode: "US",
                osm_key: "highway",
                osm_type: "W",
                osm_id: 443184419,
              },
            },
          ],
        }),
      });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "901 M",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:443184419:901 Main Street, Northville, MI 48167",
          description: "901 Main Street, Northville, MI 48167",
        },
      ],
    });

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0])
    );
    expect(new URL(calls.at(-1) ?? "").searchParams.get("q")).toBe("M");
  });

  it("retries with Photon structured search for house-number street inputs", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
          {
            geometry: { coordinates: [-83.483, 42.431] },
            properties: {
                name: "McDonald Drive",
                city: "Northville",
                state: "Michigan",
                postcode: "48167",
                countrycode: "US",
                osm_key: "highway",
                osm_type: "W",
                osm_id: 789,
              },
            },
          ],
        }),
      });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "901 McDonald Dr, Northville",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:789:901 McDonald Drive, Northville, MI 48167",
          description: "901 McDonald Drive, Northville, MI 48167",
        },
      ],
    });

    const [structuredUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const url = new URL(String(structuredUrl));
    expect(url.pathname).toBe("/structured");
    expect(url.searchParams.get("housenumber")).toBe("901");
    expect(url.searchParams.get("street")).toBe("McDonald Dr");
    expect(url.searchParams.get("city")).toBe("Northville");
    expect(url.searchParams.get("bbox")).toBeTruthy();
  });

  it("accepts top-level latitude and longitude as a location bias", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-83.48, 42.43] },
            properties: {
              housenumber: "9070",
              street: "7 Mile Road",
              city: "Northville",
              state: "Michigan",
              postcode: "48167",
              countrycode: "US",
              osm_type: "W",
              osm_id: 321,
            },
          },
        ],
      }),
    });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "90",
          latitude: 42.4311,
          longitude: -83.4833,
          radiusMeters: 15_000,
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:321:9070 7 Mile Road, Northville, MI 48167",
          description: "9070 7 Mile Road, Northville, MI 48167",
        },
      ],
    });

    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.searchParams.get("lat")).toBe("42.4311");
    expect(url.searchParams.get("lon")).toBe("-83.4833");
  });

  it("rejects far-away Photon guesses for short local house-number searches", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [-74.013, 40.706] },
              properties: {
                housenumber: "90",
                street: "West Street",
                city: "New York",
                state: "New York",
                postcode: "10006",
                countrycode: "US",
                osm_type: "W",
                osm_id: 999,
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          result: {
            geographies: {
              "Incorporated Places": [{ BASENAME: "Northville" }],
              States: [{ STUSAB: "MI" }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ features: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          features: [
            {
              geometry: { coordinates: [-83.473, 42.42] },
              properties: {
                name: "Northville Road",
                city: "Northville Charter Township",
                state: "Michigan",
                postcode: "48167",
                countrycode: "US",
                osm_key: "highway",
                osm_type: "W",
                osm_id: 443184418,
              },
            },
          ],
        }),
      });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: {
          query: "90",
          locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
        },
      },
      res
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "W:443184418:90 Northville Road, Northville Charter Township, MI 48167",
          description: "90 Northville Road, Northville Charter Township, MI 48167",
        },
      ],
    });
  });

  it("fails closed when Photon returns non-JSON HTML", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html>Connection denied</html>",
    });

    const handler = (await import("../photon-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "90" } }, res);

    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "photon_unavailable", status: 200 });
  });
});
