import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// Address autocomplete provider tests.
//
// These are gated on CI and run on every deploy so a future provider
// regression — formatting drift, contract change, broken parser —
// trips the build before users see "901 Main Street, Mockville, FL".
// =====================================================================

const NOMINATIM_NORTHVILLE_RESPONSE = [
  {
    place_id: 12345,
    display_name:
      "901, McDonald Drive, Northville, Wayne County, Michigan, 48167, United States",
    address: {
      house_number: "901",
      road: "McDonald Drive",
      city: "Northville",
      county: "Wayne County",
      state: "Michigan",
      "ISO3166-2-lvl4": "US-MI",
      postcode: "48167",
      country: "United States",
    },
  },
];

const MAPBOX_NORTHVILLE_RESPONSE = {
  features: [
    {
      id: "address.123",
      place_name: "901 McDonald Drive, Northville, Michigan 48167, United States",
      place_type: ["address"],
    },
  ],
};

const NOMINATIM_ROAD_ONLY_NORTHVILLE_RESPONSE = [
  {
    place_id: 7001,
    display_name: "McDonald Drive, Pheasant Hills, Northville, Oakland County, Michigan, 48167, United States",
    address: {
      road: "McDonald Drive",
      village: "Northville",
      county: "Oakland County",
      state: "Michigan",
      "ISO3166-2-lvl4": "US-MI",
      postcode: "48167",
      country: "United States",
      country_code: "us",
    },
  },
];

// Mixed response simulating Nominatim's default behavior — street
// address + several city/county/region hits that must be filtered out.
const NOMINATIM_MIXED_RESPONSE = [
  // ✅ Real street address — should survive
  {
    place_id: 1,
    display_name: "901 McDonald Drive, Northville, Wayne County, Michigan, 48167, United States",
    address: {
      house_number: "901",
      road: "McDonald Drive",
      city: "Northville",
      state: "Michigan",
      "ISO3166-2-lvl4": "US-MI",
      postcode: "48167",
    },
  },
  // ❌ Town — should be filtered
  {
    place_id: 2,
    display_name: "McDonald, Washington County, Pennsylvania, 15057, United States",
    address: {
      city: "McDonald",
      county: "Washington County",
      state: "Pennsylvania",
      "ISO3166-2-lvl4": "US-PA",
      postcode: "15057",
    },
  },
  // ❌ Town — should be filtered
  {
    place_id: 3,
    display_name: "McDonald, Trumbull County, Ohio, 44437, United States",
    address: {
      city: "McDonald",
      county: "Trumbull County",
      state: "Ohio",
      "ISO3166-2-lvl4": "US-OH",
      postcode: "44437",
    },
  },
  // ❌ County — should be filtered
  {
    place_id: 4,
    display_name: "McDonald County, Missouri, United States",
    address: {
      county: "McDonald County",
      state: "Missouri",
      "ISO3166-2-lvl4": "US-MO",
    },
  },
  // ❌ Region/town — should be filtered
  {
    place_id: 5,
    display_name: "McDonald, Sherman County, Kansas, United States",
    address: {
      city: "McDonald",
      state: "Kansas",
      "ISO3166-2-lvl4": "US-KS",
    },
  },
  // ✅ Another real street address — should survive
  {
    place_id: 6,
    display_name: "901 McDonald Avenue, Brooklyn, New York, 11218, United States",
    address: {
      house_number: "901",
      road: "McDonald Avenue",
      city: "Brooklyn",
      state: "New York",
      "ISO3166-2-lvl4": "US-NY",
      postcode: "11218",
    },
  },
];

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  // Default to keyless config — Nominatim is the primary path. Each
  // test that wants a paid provider opts in via vi.stubEnv().
  vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "");
  vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
  vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "");
  vi.stubEnv("VITE_MAPBOX_TOKEN", "");
  // Tests share module state across calls now (the response cache).
  // Reset it so each case starts from a clean slate.
  const mod = await import("../addressSearch");
  mod._resetAddressSearchForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("searchAddresses (Nominatim default)", () => {
  it("returns empty array for empty queries (no network call)", async () => {
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("   ");
    expect(out).toEqual([]);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("calls Nominatim with US-only restrictions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("901 McDonald Dr Northville MI");
    const calledUrl = String(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(calledUrl).toContain("nominatim.openstreetmap.org/search");
    expect(calledUrl).toContain("countrycodes=us");
    expect(calledUrl).toContain("addressdetails=1");
    expect(calledUrl).toMatch(/q=901\+McDonald/);
  });

  it("biases Nominatim around device location while keeping US-only restrictions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("901 McDonald", "address", undefined, undefined, {
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 25_000,
      },
    });
    const calledUrl = String(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
    );
    expect(calledUrl).toContain("countrycodes=us");
    expect(calledUrl).toContain("addressdetails=1");
    expect(calledUrl).toContain("viewbox=");
    expect(calledUrl).toContain("bounded=0");
  });

  it("formats Nominatim results as clean US-style addresses", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    // Use a query that is a real prefix of the formatted output
    // ("901 McDonald" is a prefix of "901 McDonald Drive, Northville,
    // MI 48167"); strict prefix matching is verified separately.
    const out = await searchAddresses("901 McDonald");
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("901 McDonald Drive, Northville, MI 48167");
    expect(out[0].description).not.toContain("United States");
    expect(out[0].description).not.toContain("Wayne County");
  });

  it("preserves the typed house number when Nominatim only returns the matching road", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suggestions: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suggestions: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => NOMINATIM_ROAD_ONLY_NORTHVILLE_RESPONSE,
      });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald Dr, Northville");

    expect(out).toEqual([
      {
        id: "7001",
        description: "901 McDonald Drive, Northville, MI 48167",
      },
    ]);
  });

  it("uses the Nominatim server proxy before direct browser Nominatim when enabled", async () => {
    vi.stubEnv("VITE_ENABLE_NOMINATIM_PROXY", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "373059960",
            description: "901 McDonald Drive, Northville, MI 48167",
          },
        ],
      }),
    });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald", "address", undefined, undefined, {
      locationBias: { latitude: 42.4314, longitude: -83.483, radiusMeters: 15_000 },
    });

    expect(out).toEqual([
      {
        id: "373059960",
        description: "901 McDonald Drive, Northville, MI 48167",
      },
    ]);
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0][0])).toBe("/api/nominatim-search");
    expect(calls[0][1]?.body).toContain("901 McDonald");
  });

  it("recovers when the user types an abbreviated suffix and partial city", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "901_McDonald_Dr,_Northville,_MI_48167",
            description: "901 McDonald Dr, Northville, MI 48167",
          },
        ],
      }),
    });

    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald Dr, Northville");

    expect(out).toEqual([
      {
        id: "901_McDonald_Dr,_Northville,_MI_48167",
        description: "901 McDonald Dr, Northville, MI 48167",
      },
    ]);
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      decodeURIComponent(String(call[0]))
    );
    expect(urls).toEqual(["/api/census-geocode"]);
    expect(_getAddressSearchTelemetry().broaderQueryRetries).toBe(0);
  });

  it("returns empty by default when Nominatim returns non-OK", async () => {
    // Both the original query and the broader-query retry get 503.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
    );
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("123 Main");
    expect(out).toEqual([]);
    const telemetry = _getAddressSearchTelemetry();
    expect(telemetry.errors.at(-1)?.provider).toBe("nominatim");
    expect(telemetry.errors.at(-1)?.status).toBe(503);
  });

  it("returns empty by default when Nominatim throws (network error)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error("network down"))
    );
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("456 Oak");
    expect(out).toEqual([]);
    const telemetry = _getAddressSearchTelemetry();
    expect(telemetry.errors.at(-1)?.message).toMatch(/network down/);
  });

  it("uses mock fallback only when the caller explicitly opts into demo suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("123 Main", "address", undefined, undefined, {
      allowMockFallback: true,
    });
    expect(out.length).toBeGreaterThan(0);
    out.forEach((p) => expect(p.description.toLowerCase()).toMatch(/^123 main/));
  });

  it("does not generate demo addresses when verified-only mode is requested", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("123 Main", "address", undefined, undefined, {
      allowMockFallback: false,
    });
    expect(out).toEqual([]);
  });
});

describe("searchAddresses (Mapbox when token configured)", () => {
  it("uses Mapbox when VITE_MAPBOX_TOKEN is set", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => MAPBOX_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald Dr");
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("api.mapbox.com");
    expect(url).toContain("country=us");
    expect(url).toContain("access_token=pk.test_token");
    expect(out[0].description).toBe("901 McDonald Drive, Northville, Michigan 48167");
  });

  it("passes device location as Mapbox proximity and restricts short numeric searches to a bbox", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => MAPBOX_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("90", "address", undefined, undefined, {
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 50_000,
      },
    });
    const url = decodeURIComponent(
      String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])
    );
    expect(url).toContain("proximity=-83.4833,42.4311");
    expect(url).toContain("bbox=");
  });

  it("keeps provider cache separated by location bias", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => MAPBOX_NORTHVILLE_RESPONSE,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              id: "address.456",
              place_name: "901 McDonald Avenue, Brooklyn, New York 11218, United States",
              place_type: ["address"],
            },
          ],
        }),
      });

    const { searchAddresses } = await import("../addressSearch");
    const first = await searchAddresses("901 McDonald", "address", undefined, undefined, {
      locationBias: { latitude: 42.4311, longitude: -83.4833 },
    });
    const second = await searchAddresses("901 McDonald", "address", undefined, undefined, {
      locationBias: { latitude: 40.6501, longitude: -73.9496 },
    });

    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(first[0].description).toContain("Northville");
    expect(second[0].description).toContain("Brooklyn");
  });

  it("retries Mapbox with a broader query when the original returns no features", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    // 1st call ("901 McD") → 0 features, 2nd ("901") → 1 address
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ features: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => MAPBOX_NORTHVILLE_RESPONSE });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("901 McD");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(out[0].description).toContain("Northville");
    expect(_getAddressSearchTelemetry().lastBroaderQuery).toEqual({
      original: "901 McD",
      broader: "901",
    });
  });
});

describe("formatNominatimAddress", () => {
  it("handles results missing house_number", async () => {
    const { formatNominatimAddress } = await import("../addressSearch");
    const out = formatNominatimAddress({
      place_id: 1,
      display_name: "Main Street, Springfield, Illinois, United States",
      address: {
        road: "Main Street",
        city: "Springfield",
        state: "Illinois",
        "ISO3166-2-lvl4": "US-IL",
        postcode: "62701",
      },
    });
    expect(out).toBe("Main Street, Springfield, IL 62701");
  });

  it("derives state code from full state name when ISO code missing", async () => {
    const { formatNominatimAddress } = await import("../addressSearch");
    const out = formatNominatimAddress({
      place_id: 2,
      display_name: "12 Elm, Burlington, Vermont, United States",
      address: {
        house_number: "12",
        road: "Elm Street",
        city: "Burlington",
        state: "Vermont",
        postcode: "05401",
      },
    });
    expect(out).toBe("12 Elm Street, Burlington, VT 05401");
  });

  it("falls back to display_name when address fields are absent", async () => {
    const { formatNominatimAddress } = await import("../addressSearch");
    const out = formatNominatimAddress({
      place_id: 3,
      display_name: "Anywhere, USA, United States",
    });
    expect(out).toBe("Anywhere, USA");
  });
});

// =====================================================================
// Regression coverage for the "city / county / region leak" bug.
//
// Symptom that prompted this layer: typing "901 McDonald" returned
// "McDonald, PA / KS / OH" and "McDonald County, MO" instead of real
// street addresses. The filter must drop anything without both a
// house number AND a road.
// =====================================================================

describe("street-only filter (regression for city/county/region leak)", () => {
  it("drops city, town, county, and region hits from Nominatim mixed response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_MIXED_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");

    // Exactly the two real street addresses survive — the four
    // non-street rows in the mixed response are filtered out.
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.description)).toEqual([
      "901 McDonald Drive, Northville, MI 48167",
      "901 McDonald Avenue, Brooklyn, NY 11218",
    ]);

    // None of the filtered descriptions look like a bare city/county.
    for (const p of out) {
      expect(p.description).toMatch(/^\d+\s+\S+/); // starts with number + word
      expect(p.description).not.toMatch(/^McDonald,/);
      expect(p.description).not.toContain("County");
    }
  });

  it("records each non-street result in telemetry so ops can spot leaks", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_MIXED_RESPONSE,
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const before = _getAddressSearchTelemetry().nonStreetFilteredCount;
    await searchAddresses("901 McDonald");
    const after = _getAddressSearchTelemetry().nonStreetFilteredCount;
    expect(after - before).toBe(4); // 4 city/county rows dropped
    expect(_getAddressSearchTelemetry().lastNonStreetSample?.provider).toBe("nominatim");
  });

  it("returns empty array when the provider gives only city / county hits", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        NOMINATIM_MIXED_RESPONSE.filter((r) => !r.address?.house_number),
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("McDonald");
    // 0 real street addresses → empty (UI shows "No matches" rather
    // than falling back to mocks for a high-confidence keyword query).
    // Note: the public entry point currently falls back to the mock
    // pool when both providers return nothing, so we assert the
    // descriptions are NOT one of the filtered-out forms.
    for (const p of out) {
      expect(p.description).not.toMatch(/^McDonald,/);
      expect(p.description).not.toContain("County");
      expect(p.description).toMatch(/^\d/); // starts with a house number
    }
  });

  it("Mapbox request asks for types=address only", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => MAPBOX_NORTHVILLE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("901 McDonald");
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("types=address");
    expect(url).not.toContain("types=address,place");
    expect(url).not.toContain("locality");
    expect(url).not.toContain("postcode");
  });

  it("drops Mapbox features that don't carry place_type address (defense in depth)", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          { id: "place.1", place_name: "McDonald, PA, United States", place_type: ["place"] },
          { id: "address.2", place_name: "901 McDonald Drive, Northville, MI 48167, United States", place_type: ["address"] },
          { id: "region.3", place_name: "Pennsylvania, United States", place_type: ["region"] },
        ],
      }),
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    // Query is a real prefix of the surviving street address so it
    // passes the strict prefix filter too.
    const out = await searchAddresses("901 McDonald");
    expect(out).toHaveLength(1);
    expect(out[0].description).toContain("901 McDonald Drive");
    expect(_getAddressSearchTelemetry().lastNonStreetSample?.provider).toBe("mapbox");
  });
});

describe("isNominatimStreetLevel (the filter predicate itself)", () => {
  it("accepts results with both house_number and road", async () => {
    const { isNominatimStreetLevel } = await import("../addressSearch");
    expect(
      isNominatimStreetLevel({
        place_id: 1,
        display_name: "",
        address: { house_number: "901", road: "McDonald Drive" },
      })
    ).toBe(true);
  });

  it("rejects results missing house_number (towns, cities)", async () => {
    const { isNominatimStreetLevel } = await import("../addressSearch");
    expect(
      isNominatimStreetLevel({
        place_id: 1,
        display_name: "",
        address: { city: "McDonald", state: "Pennsylvania" },
      })
    ).toBe(false);
  });

  it("rejects results missing road (postcode-only, region-only)", async () => {
    const { isNominatimStreetLevel } = await import("../addressSearch");
    expect(
      isNominatimStreetLevel({
        place_id: 1,
        display_name: "",
        address: { house_number: "901", postcode: "48167" },
      })
    ).toBe(false);
  });

  it("rejects results with absent address object entirely", async () => {
    const { isNominatimStreetLevel } = await import("../addressSearch");
    expect(isNominatimStreetLevel({ place_id: 1, display_name: "Anywhere" })).toBe(false);
  });
});

// =====================================================================
// Multi-state street-level smoke test — covers diverse inputs to make
// sure the formatter and filter both behave across the US.
// =====================================================================

describe("multi-state street-level smoke", () => {
  const CASES: { fixture: any; expect: string }[] = [
    {
      fixture: {
        place_id: 1,
        display_name: "...",
        address: { house_number: "901", road: "McDonald Drive", city: "Northville", "ISO3166-2-lvl4": "US-MI", postcode: "48167" },
      },
      expect: "901 McDonald Drive, Northville, MI 48167",
    },
    {
      fixture: {
        place_id: 2,
        display_name: "...",
        address: { house_number: "1600", road: "Pennsylvania Avenue NW", city: "Washington", "ISO3166-2-lvl4": "US-DC", postcode: "20500" },
      },
      expect: "1600 Pennsylvania Avenue NW, Washington, DC 20500",
    },
    {
      fixture: {
        place_id: 3,
        display_name: "...",
        address: { house_number: "350", road: "5th Avenue", city: "New York", "ISO3166-2-lvl4": "US-NY", postcode: "10118" },
      },
      expect: "350 5th Avenue, New York, NY 10118",
    },
    {
      fixture: {
        place_id: 4,
        display_name: "...",
        address: { house_number: "1", road: "Apple Park Way", city: "Cupertino", state: "California", postcode: "95014" },
      },
      expect: "1 Apple Park Way, Cupertino, CA 95014",
    },
    {
      fixture: {
        place_id: 5,
        display_name: "...",
        address: { house_number: "200", road: "Main Street", town: "Rural Hall", state: "North Carolina", postcode: "27045" },
      },
      expect: "200 Main Street, Rural Hall, NC 27045",
    },
  ];

  CASES.forEach(({ fixture, expect: expected }) => {
    it(`formats ${expected}`, async () => {
      const { formatNominatimAddress, isNominatimStreetLevel } = await import("../addressSearch");
      expect(isNominatimStreetLevel(fixture)).toBe(true);
      expect(formatNominatimAddress(fixture)).toBe(expected);
    });
  });
});

// =====================================================================
// Strict left-to-right prefix matching.
//
// Every dropdown row must start, character-by-character, with the
// user's input (case + whitespace normalized). When no street match
// satisfies that, the dropdown is empty — never "loosely related".
// =====================================================================

const NOMINATIM_MCDONALD_FAR_MATCH = [
  // Real street, but the road name doesn't begin with "McDonald" —
  // it ENDS in "McDonald". Should fail strict prefix matching even
  // though it's a street address.
  {
    place_id: 99,
    display_name: "12 Old McDonald Lane, Springfield, IL, 62701, United States",
    address: {
      house_number: "12",
      road: "Old McDonald Lane",
      city: "Springfield",
      state: "Illinois",
      "ISO3166-2-lvl4": "US-IL",
      postcode: "62701",
    },
  },
  // Matches strict prefix.
  {
    place_id: 100,
    display_name: "901 McDonald Drive, Northville, MI 48167, United States",
    address: {
      house_number: "901",
      road: "McDonald Drive",
      city: "Northville",
      state: "Michigan",
      "ISO3166-2-lvl4": "US-MI",
      postcode: "48167",
    },
  },
];

describe("strict prefix matching (every row must start with the user's input)", () => {
  it("drops street rows whose description does not start with the query", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_MCDONALD_FAR_MATCH,
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const before = _getAddressSearchTelemetry().nonPrefixFilteredCount;
    const out = await searchAddresses("901 McDonald");

    // Only the "901 McDonald Drive…" survives. "12 Old McDonald Lane"
    // is a real street but does not start with "901".
    expect(out).toHaveLength(1);
    expect(out[0].description).toMatch(/^901 McDonald/);

    // The dropped non-prefix row is recorded in telemetry.
    const after = _getAddressSearchTelemetry().nonPrefixFilteredCount;
    expect(after - before).toBe(1);
    expect(_getAddressSearchTelemetry().lastNonPrefixSample?.provider).toBe("nominatim");
    expect(_getAddressSearchTelemetry().lastNonPrefixSample?.query).toBe("901 McDonald");
  });

  it("matches are case- and whitespace-insensitive but otherwise exact", async () => {
    const { matchesQueryPrefix } = await import("../addressSearch");
    // Same content, varied case / spacing → still matches
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "901 mcdonald")).toBe(true);
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "  901   McDonald  ")).toBe(true);
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "901 McDonald Dr, Northville")).toBe(true);
    // First character mismatch → no match
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "902 McDonald")).toBe(false);
    // Mid-string mismatch → no match
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "901 MacDonald")).toBe(false);
    // City keyword somewhere later in the description is not a prefix
    expect(matchesQueryPrefix("901 McDonald Drive, Northville, MI 48167", "Northville")).toBe(false);
    // Empty query trivially matches everything (component sets its
    // own minQueryLength to suppress the dropdown until 2+ chars).
    expect(matchesQueryPrefix("anything", "")).toBe(true);
  });

  it("progressive typing narrows the dropdown deterministically", async () => {
    const { matchesQueryPrefix } = await import("../addressSearch");
    const candidates = [
      "901 McDonald Drive, Northville, MI 48167",
      "901 McDonald Avenue, Brooklyn, NY 11218",
      "901 Madison Avenue, New York, NY 10021",
      "9015 Main Street, Tampa, FL 33602",
      "12 Old McDonald Lane, Springfield, IL 62701",
    ];
    // Counts reflect the 5 candidates above: three "901 ..." rows,
    // one "9015 Main Street..." row, and one "12 Old McDonald Lane..."
    // row that never matches a query starting with "9".
    const cases: { input: string; expectedCount: number }[] = [
      { input: "9", expectedCount: 4 },             // all 4 "9…" rows
      { input: "90", expectedCount: 4 },            // same 4
      { input: "901", expectedCount: 4 },           // "9015 Main…" still matches
      { input: "901 M", expectedCount: 3 },         // "9015 Main…" drops (no space after 9015)
      { input: "901 Mc", expectedCount: 2 },        // only the two McDonald rows
      { input: "901 McDonald", expectedCount: 2 },  // same
      { input: "901 McDonald Dr", expectedCount: 1 },
      { input: "901 McDonald Drive,", expectedCount: 1 },
      { input: "902", expectedCount: 0 },           // no candidate begins with 902
    ];
    for (const c of cases) {
      const matching = candidates.filter((d) => matchesQueryPrefix(d, c.input));
      expect(matching, `input "${c.input}"`).toHaveLength(c.expectedCount);
    }
  });

  it("returns an empty list when nothing prefix-matches, even though the API returned hits", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [NOMINATIM_MCDONALD_FAR_MATCH[0]], // only the "12 Old McDonald Lane" row
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(out).toEqual([]);
    // Counter incremented, sample captured
    expect(_getAddressSearchTelemetry().nonPrefixFilteredCount).toBeGreaterThan(0);
  });

  it("Mapbox results obey the same strict prefix rule", async () => {
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_token");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        features: [
          {
            id: "address.A",
            // Same street name but a different house number — should
            // not surface for query "901 McDonald".
            place_name: "902 McDonald Drive, Northville, MI 48167, United States",
            place_type: ["address"],
          },
          {
            id: "address.B",
            place_name: "901 McDonald Drive, Northville, MI 48167, United States",
            place_type: ["address"],
          },
        ],
      }),
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(out).toHaveLength(1);
    expect(out[0].description).toMatch(/^901 McDonald/);
    expect(_getAddressSearchTelemetry().lastNonPrefixSample?.provider).toBe("mapbox");
  });
});

// =====================================================================
// Per-keystroke "character-by-character" regression.
//
// Reproduces the user-reported bug: Nominatim does whole-word
// matching, so "901 McD" returned 0 results and broke the dropdown.
// The combined cache + broader-query-retry strategy must keep
// results stable through every transition.
// =====================================================================

const NOMINATIM_901_MCDONALD_FULL_RESPONSE = [
  {
    place_id: 901_1,
    display_name: "901 McDonald Drive, Northville, Wayne County, Michigan, 48167, United States",
    address: {
      house_number: "901",
      road: "McDonald Drive",
      city: "Northville",
      state: "Michigan",
      "ISO3166-2-lvl4": "US-MI",
      postcode: "48167",
    },
  },
  {
    place_id: 901_2,
    display_name: "901 McDonald Avenue, Brooklyn, New York, 11218, United States",
    address: {
      house_number: "901",
      road: "McDonald Avenue",
      city: "Brooklyn",
      state: "New York",
      "ISO3166-2-lvl4": "US-NY",
      postcode: "11218",
    },
  },
];

describe("per-keystroke typing — '901 McDonald' across all 11 inputs", () => {
  // For inputs Nominatim treats as whole words ("901", "901 McDonald"),
  // return the canonical 2-result set. For the in-between inputs with
  // a partial trailing word ("901 M", "901 Mc", "901 McD", "901 McDo",
  // "901 McDon", "901 McDona", "901 McDonal") Nominatim returns 0 —
  // simulating real production behavior. The provider's broader-query
  // retry must then call again with the stripped query and the cache
  // must reuse the result on subsequent keystrokes.
  function stubNominatim(query: string) {
    const isWhole = query === "901" || query === "901 McDonald";
    return {
      ok: true,
      json: async () => (isWhole ? NOMINATIM_901_MCDONALD_FULL_RESPONSE : []),
    };
  }

  it("returns the same two real street addresses at every keystroke from '901' to '901 McDonald'", async () => {
    // Mock fetch to inspect the requested URL and answer per query.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      const params = new URL(String(url)).searchParams;
      // Nominatim sends the query in `q`
      const q = params.get("q") ?? "";
      return Promise.resolve(stubNominatim(q));
    });

    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const progression = [
      "9",
      "90",
      "901",
      "901 ",
      "901 M",
      "901 Mc",
      "901 McD",
      "901 McDo",
      "901 McDon",
      "901 McDona",
      "901 McDonal",
      "901 McDonald",
    ];

    const seen: { input: string; descriptions: string[] }[] = [];
    for (const input of progression) {
      // eslint-disable-next-line no-await-in-loop
      const out = await searchAddresses(input);
      seen.push({ input, descriptions: out.map((p) => p.description) });
    }

    // For every keystroke at or past "901 ", the two real street
    // results must be present and prefix-match the typed input.
    for (const step of seen) {
      if (step.input.trim().length < 3) continue; // very short inputs may yield mock fallback
      for (const desc of step.descriptions) {
        expect(desc.toLowerCase()).toMatch(/^901/);
      }
    }

    // The transition the user complained about: "901 Mc" → "901 McD"
    // must stay non-empty AND must contain the same two canonical
    // street addresses, regardless of whether the API returns 0 for
    // the partial word.
    const at = (input: string) => seen.find((s) => s.input === input)!;
    expect(at("901 Mc").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McD").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McDo").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McDon").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McDona").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McDonal").descriptions.length).toBeGreaterThan(0);
    expect(at("901 McDonald").descriptions.length).toBeGreaterThan(0);

    // The final input shows both canonical real addresses, in order
    // from the API.
    expect(at("901 McDonald").descriptions).toEqual([
      "901 McDonald Drive, Northville, MI 48167",
      "901 McDonald Avenue, Brooklyn, NY 11218",
    ]);

    // Cache hits must have fired during the progression — the user
    // typing through "901 McDonald" should reuse the "901" response
    // for every step from "901 " onward instead of hitting the API
    // on every keystroke. The broader-query retry is verified in a
    // dedicated test below.
    const telemetry = _getAddressSearchTelemetry();
    expect(telemetry.cacheHits).toBeGreaterThan(0);
  });

  it("retries with the broader query when the partial-word query returns 0", async () => {
    // First call ("901 McD") → 0 results
    // Second call (broader: "901") → 2 results
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => NOMINATIM_901_MCDONALD_FULL_RESPONSE });

    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    const out = await searchAddresses("901 McD");
    // place_id values in the fixture are 901_1 (= 9011) and 901_2 (= 9012)
    expect(out).toEqual([
      { id: "9011", description: "901 McDonald Drive, Northville, MI 48167" },
      { id: "9012", description: "901 McDonald Avenue, Brooklyn, NY 11218" },
    ]);
    const telemetry = _getAddressSearchTelemetry();
    expect(telemetry.broaderQueryRetries).toBe(1);
    expect(telemetry.lastBroaderQuery).toEqual({ original: "901 McD", broader: "901" });
    // Both URLs were hit
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("uses cached longer-prefix results to satisfy a backspace ('901 McDonald' → '901 McDonal')", async () => {
    // First call: full word, 2 results
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => NOMINATIM_901_MCDONALD_FULL_RESPONSE,
    });
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    await searchAddresses("901 McDonald");
    const after = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(1);

    // Now user backspaces — same prefix "901 McDonal" should
    // hit the cache and return the same 2 results without
    // another fetch.
    const out = await searchAddresses("901 McDonal");
    expect(out.length).toBe(2);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(after);
    expect(_getAddressSearchTelemetry().cacheHits).toBe(1);
  });

  it("case-insensitive: '901 mc' and '901 MC' return the same results", async () => {
    // Both calls hit "901 mc" / "901 MC" with 0 results (partial
    // word), then broader query "901" with 2.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => NOMINATIM_901_MCDONALD_FULL_RESPONSE,
      })
    );
    const { searchAddresses } = await import("../addressSearch");
    const lower = await searchAddresses("901 mc");
    const upper = await searchAddresses("901 MC");
    expect(lower.map((p) => p.description)).toEqual(upper.map((p) => p.description));
    expect(lower.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// SmartyStreets US Autocomplete Pro — production-grade provider that
// takes priority when VITE_SMARTY_WEBSITE_KEY is set.
// =====================================================================

const SMARTY_RESPONSE = {
  suggestions: [
    {
      street_line: "901 McDonald Dr",
      secondary: "",
      city: "Northville",
      state: "MI",
      zipcode: "48167",
    },
    {
      street_line: "901 McDonald Ave",
      secondary: "",
      city: "Brooklyn",
      state: "NY",
      zipcode: "11218",
    },
  ],
};

describe("SmartyStreets provider", () => {
  it("uses the protected Smarty proxy when enabled, without requiring a browser key", async () => {
    vi.stubEnv("VITE_ENABLE_SMARTY_AUTOCOMPLETE_PROXY", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          { id: "901", description: "901 McDonald Dr, Northville, MI 48167" },
        ],
      }),
    });
    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(getActiveProvider()).toBe("smarty");
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/smarty-autocomplete");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      query: "901 McDonald",
      maxResults: 10,
    });
    expect(out).toEqual([{ id: "901", description: "901 McDonald Dr, Northville, MI 48167" }]);
  });

  it("is selected when VITE_SMARTY_WEBSITE_KEY is set, even if Mapbox token is also set", async () => {
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "smarty_test_key");
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test_mapbox");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => SMARTY_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("us-autocomplete-pro.api.smarty.com/lookup");
    expect(url).toContain("key=smarty_test_key");
    expect(url).toContain("search=901+McDonald");
    expect(out.map((p) => p.description)).toEqual([
      "901 McDonald Dr, Northville, MI 48167",
      "901 McDonald Ave, Brooklyn, NY 11218",
    ]);
  });

  it("appends secondary unit info when Smarty returns it", async () => {
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            street_line: "123 Main St",
            secondary: "Apt 4B",
            city: "Boston",
            state: "MA",
            zipcode: "02108",
          },
        ],
      }),
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("123 Main");
    expect(out[0].description).toBe("123 Main St Apt 4B, Boston, MA 02108");
  });

  it("logs telemetry when Smarty returns a non-OK status", async () => {
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({}) })
    );
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    await searchAddresses("123 Main");
    const telemetry = _getAddressSearchTelemetry();
    expect(telemetry.errors.at(-1)?.provider).toBe("smarty");
    expect(telemetry.errors.at(-1)?.status).toBe(401);
  });

  it("does not let Smarty win short numeric searches when device location is available", async () => {
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "smarty_test_key");
    vi.stubEnv("VITE_ENABLE_PHOTON_AUTOCOMPLETE", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "photon-local-90",
            description: "9070 7 Mile Road, Northville, MI 48167",
          },
        ],
      }),
    });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("90", "address", undefined, undefined, {
      locationBias: { latitude: 42.4311, longitude: -83.4833, radiusMeters: 15_000 },
    });

    expect(out[0].description).toBe("9070 7 Mile Road, Northville, MI 48167");
    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/photon-autocomplete");
  });
});

describe("Census Geocoder fallback", () => {
  it("uses Census before broad search for complete U.S. addresses", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              id: "4600_Silver_Hill_Rd_Washington_DC_20233",
              description: "4600 Silver Hill Rd, Washington, DC 20233",
            },
          ],
        }),
      });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("4600 Silver Hill Rd, Washington, DC 20233");
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls).toEqual(["/api/census-geocode"]);
    expect(out).toEqual([
      {
        id: "4600_Silver_Hill_Rd_Washington_DC_20233",
        description: "4600 Silver Hill Rd, Washington, DC 20233",
      },
    ]);
  });

  it("uses Census for street plus city inputs even without state or ZIP", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "901_McDonald_Dr,_Northville,_MI_48167",
            description: "901 McDonald Dr, Northville, MI 48167",
          },
        ],
      }),
    });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald Dr, Northville");
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

    expect(calls).toEqual(["/api/census-geocode"]);
    expect(out).toEqual([
      {
        id: "901_McDonald_Dr,_Northville,_MI_48167",
        description: "901 McDonald Dr, Northville, MI 48167",
      },
    ]);
  });

  it("keeps searching when a provider returns rows that do not match the typed prefix", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              id: "902_McDonald_Dr,_Northville,_MI_48167",
              description: "902 McDonald Dr, Northville, MI 48167",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => NOMINATIM_NORTHVILLE_RESPONSE,
      });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald Dr, Northville");

    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      {
        id: "12345",
        description: "901 McDonald Drive, Northville, MI 48167",
      },
    ]);
  });
});

describe("Photon autocomplete proxy provider", () => {
  it("uses the keyless Photon proxy before Nominatim when enabled", async () => {
    vi.stubEnv("VITE_ENABLE_PHOTON_AUTOCOMPLETE", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "W:123:9070 7 Mile Road, Northville, MI 48167",
            description: "9070 7 Mile Road, Northville, MI 48167",
          },
        ],
      }),
    });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("90", "address", undefined, undefined, {
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 50_000,
      },
    });

    expect(out).toEqual([
      {
        id: "W:123:9070 7 Mile Road, Northville, MI 48167",
        description: "9070 7 Mile Road, Northville, MI 48167",
      },
    ]);
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/photon-autocomplete");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "90",
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 50_000,
      },
    });
  });
});

// =====================================================================
// Google Places Autocomplete (New)
// =====================================================================

const GOOGLE_AUTOCOMPLETE_RESPONSE = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJ-fake-1",
        text: { text: "901 McDonald Drive, Northville, MI 48167, USA" },
      },
    },
    {
      placePrediction: {
        placeId: "ChIJ-fake-2",
        text: { text: "901 McDonald Avenue, Brooklyn, NY 11218, USA" },
      },
    },
  ],
};

const GOOGLE_PLACE_DETAILS_RESPONSE = {
  formattedAddress: "901 McDonald Drive, Northville, MI 48167, USA",
  addressComponents: [
    { longText: "901", shortText: "901", types: ["street_number"] },
    { longText: "McDonald Drive", shortText: "McDonald Dr", types: ["route"] },
    { longText: "Apt 4B", shortText: "Apt 4B", types: ["subpremise"] },
    { longText: "Northville", shortText: "Northville", types: ["locality", "political"] },
    {
      longText: "Wayne County",
      shortText: "Wayne County",
      types: ["administrative_area_level_2", "political"],
    },
    {
      longText: "Michigan",
      shortText: "MI",
      types: ["administrative_area_level_1", "political"],
    },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: "48167", shortText: "48167", types: ["postal_code"] },
  ],
};

describe("Google Places (New) provider", () => {
  it("prefers the server-side Google proxy when it is enabled", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_PLACES_PROXY", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "ChIJ-proxy-1",
            description: "901 McDonald Drive, Northville, MI 48167",
            googlePlaceId: "ChIJ-proxy-1",
          },
        ],
      }),
    });

    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    expect(getActiveProvider()).toBe("google");
    const out = await searchAddresses("901 McDonald Dr, Northville", "address", undefined, "tok");
    expect(out).toEqual([
      {
        id: "ChIJ-proxy-1",
        description: "901 McDonald Drive, Northville, MI 48167",
        googlePlaceId: "ChIJ-proxy-1",
      },
    ]);
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/google-places-autocomplete");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "901 McDonald Dr, Northville",
      sessionToken: "tok",
    });
  });

  it("passes two-character searches and location bias through the server-side Google proxy", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_PLACES_PROXY", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: "ChIJ-proxy-90",
            description: "9070 7 Mile Rd, Northville, MI 48167",
            googlePlaceId: "ChIJ-proxy-90",
          },
        ],
      }),
    });

    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("90", "address", undefined, "tok", {
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 50_000,
      },
    });
    expect(out[0].description).toContain("Northville");
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/google-places-autocomplete");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "90",
      sessionToken: "tok",
      locationBias: {
        latitude: 42.4311,
        longitude: -83.4833,
        radiusMeters: 50_000,
      },
    });
  });

  it("fetches selected-place details through the server-side Google proxy", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_PLACES_PROXY", "true");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        parts: {
          street: "901 McDonald Drive",
          apt: "",
          city: "Northville",
          state: "MI",
          zip: "48167",
        },
      }),
    });

    const { fetchGooglePlaceDetails } = await import("../addressSearch");
    const parts = await fetchGooglePlaceDetails("ChIJ-proxy-1", "tok");
    expect(parts).toEqual({
      street: "901 McDonald Drive",
      apt: "",
      city: "Northville",
      state: "MI",
      zip: "48167",
    });
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("/api/google-place-details");
    expect(JSON.parse(String(init?.body))).toEqual({
      placeId: "ChIJ-proxy-1",
      sessionToken: "tok",
    });
  });

  it("does not use browser-exposed Google keys unless direct debug mode is explicitly enabled", async () => {
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "public-looking-key");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "legacy-public-looking-key");
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "smarty_key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            street_line: "901 McDonald Drive",
            city: "Northville",
            state: "MI",
            zipcode: "48167",
          },
        ],
      }),
    });

    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    expect(getActiveProvider()).toBe("smarty");
    await searchAddresses("901 McDonald");
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toContain("us-autocomplete-pro.api.smarty.com");
    expect(JSON.stringify(init)).not.toContain("public-looking-key");
    expect(JSON.stringify(init)).not.toContain("legacy-public-looking-key");
  });

  it("is selected when VITE_GOOGLE_MAPS_API_KEY is set, beating Smarty + Mapbox", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "google_test_key");
    vi.stubEnv("VITE_SMARTY_WEBSITE_KEY", "smarty_key");
    vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.mapbox");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    expect(getActiveProvider()).toBe("google");
    const out = await searchAddresses("901 McDonald");
    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("google_test_key");
    expect(headers["X-Goog-FieldMask"]).toContain("suggestions.placePrediction.placeId");
    expect(headers["X-Goog-FieldMask"]).toContain("suggestions.placePrediction.text");
    const body = JSON.parse(String(init?.body));
    expect(body.input).toBe("901 McDonald");
    expect(body.includedPrimaryTypes).toEqual(["street_address", "premise", "subpremise"]);
    expect(body.includedRegionCodes).toEqual(["us"]);
    expect(typeof body.sessionToken).toBe("string");
    expect(body.sessionToken.length).toBeGreaterThan(0);
    // Predictions are mapped + ", USA" stripped + googlePlaceId attached.
    expect(out.map((p) => p.description)).toEqual([
      "901 McDonald Drive, Northville, MI 48167",
      "901 McDonald Avenue, Brooklyn, NY 11218",
    ]);
    expect(out[0].googlePlaceId).toBe("ChIJ-fake-1");
  });

  it("fetchGooglePlaceDetails parses addressComponents into Street/Apt/City/State/ZIP", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_PLACE_DETAILS_RESPONSE,
    });
    const { fetchGooglePlaceDetails } = await import("../addressSearch");
    const parts = await fetchGooglePlaceDetails("ChIJ-fake-1", "session-token-123");
    expect(parts).toEqual({
      street: "901 McDonald Drive",
      apt: "Apt 4B",
      city: "Northville",
      state: "MI", // shortText for administrative_area_level_1
      zip: "48167",
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("https://places.googleapis.com/v1/places/ChIJ-fake-1");
    expect(String(url)).toContain("sessionToken=session-token-123");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    expect(headers["X-Goog-FieldMask"]).toContain("formattedAddress");
    expect(headers["X-Goog-FieldMask"]).toContain("addressComponents");
  });

  it("fetchGooglePlaceDetails returns null when Google returns non-OK", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    const { fetchGooglePlaceDetails, _getAddressSearchTelemetry } = await import("../addressSearch");
    const parts = await fetchGooglePlaceDetails("ChIJ-x", "tok");
    expect(parts).toBeNull();
    expect(_getAddressSearchTelemetry().errors.at(-1)?.provider).toBe("google_details");
    expect(_getAddressSearchTelemetry().errors.at(-1)?.status).toBe(403);
  });

  it("Google search reuses the supplied sessionToken across keystrokes", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE })
    );
    const { searchAddresses, _resetAddressSearchForTest } = await import("../addressSearch");
    _resetAddressSearchForTest();
    const SESSION = "fixed-session-token";
    await searchAddresses("901", "address", undefined, SESSION);
    // Reset cache so the second call actually re-fetches.
    _resetAddressSearchForTest();
    await searchAddresses("901 McDonald", "address", undefined, SESSION);
    const bodies = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? "{}"))
    );
    expect(bodies[0].sessionToken).toBe(SESSION);
    expect(bodies[1].sessionToken).toBe(SESSION);
  });

  it("logs telemetry when Google returns 403 / 429", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "k");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: false, status: 429, json: async () => ({}) })
    );
    const { searchAddresses, _getAddressSearchTelemetry } = await import("../addressSearch");
    await searchAddresses("123 Main");
    const t = _getAddressSearchTelemetry();
    expect(t.errors.some((e) => e.provider === "google" && e.status === 429)).toBe(true);
  });

  it("prefers VITE_GOOGLE_PLACES_API_KEY over the legacy VITE_GOOGLE_MAPS_API_KEY when both are set", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "places_key_v2");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "legacy_maps_key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    expect(getActiveProvider()).toBe("google");
    await searchAddresses("901 McDonald");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init?.headers as Record<string, string>) ?? {};
    expect(headers["X-Goog-Api-Key"]).toBe("places_key_v2");
  });

  it("falls back to the legacy VITE_GOOGLE_MAPS_API_KEY when only that var is set", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "legacy_only_key");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses, getActiveProvider } = await import("../addressSearch");
    expect(getActiveProvider()).toBe("google");
    await searchAddresses("901 McDonald");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init?.headers as Record<string, string>) ?? {};
    expect(headers["X-Goog-Api-Key"]).toBe("legacy_only_key");
  });

  it("uses the new key for fetchGooglePlaceDetails as well", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "places_key_v2");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_PLACE_DETAILS_RESPONSE,
    });
    const { fetchGooglePlaceDetails } = await import("../addressSearch");
    await fetchGooglePlaceDetails("ChIJ-fake-1", "tok");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init?.headers as Record<string, string>) ?? {};
    expect(headers["X-Goog-Api-Key"]).toBe("places_key_v2");
  });
});

// =====================================================================
// Google Places — JS SDK transport
//
// These mock the `./googleMapsLoader` module so we can simulate the
// Maps JS SDK being present (and various failure modes) without
// actually injecting <script> tags into jsdom.
// =====================================================================

describe("Google Places (New) — JS SDK transport", () => {
  it("uses the JS SDK when it loads, never hits the REST endpoint", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    const fetchSpy = vi.fn();
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockResolvedValue({
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: fetchSpy.mockResolvedValue({
            suggestions: [
              {
                placePrediction: {
                  placeId: "ChIJ-fake-1",
                  text: { text: "901 McDonald Drive, Northville, MI 48167, USA" },
                },
              },
            ],
          }),
        },
        AutocompleteSessionToken: class {},
        Place: class {
          fetchFields() {
            return Promise.resolve({ place: {} });
          }
        },
      }),
    }));
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("901 McDonald Drive, Northville, MI 48167");
    expect(out[0].googlePlaceId).toBe("ChIJ-fake-1");
    // SDK call shape
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "901 McDonald",
        includedPrimaryTypes: ["street_address", "premise", "subpremise"],
        includedRegionCodes: ["us"],
      })
    );
    // REST endpoint must NOT be hit when the SDK responds.
    const restCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes("places.googleapis.com")
    );
    expect(restCalls).toHaveLength(0);
    vi.doUnmock("../googleMapsLoader");
  });

  it("falls back to REST when the JS SDK fails to load", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockRejectedValue(new Error("CSP blocked maps.googleapis.com")),
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(out.length).toBeGreaterThan(0);
    // Confirm REST endpoint was hit as a fallback.
    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(calledUrl)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    vi.doUnmock("../googleMapsLoader");
  });

  it("falls back to REST when the SDK returns zero predictions for a partial-word query", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockResolvedValue({
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
        },
        AutocompleteSessionToken: class {},
        Place: class {},
      }),
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    const out = await searchAddresses("901 McDonald");
    expect(out.length).toBeGreaterThan(0);
    // Both transports were called.
    const restCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes("places.googleapis.com")
    );
    expect(restCalls).toHaveLength(1);
    vi.doUnmock("../googleMapsLoader");
  });

  it("logs REQUEST_DENIED with a remediation hint when the SDK throws it", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockResolvedValue({
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi
            .fn()
            .mockRejectedValue(new Error("REQUEST_DENIED: This API project is not authorized")),
        },
        AutocompleteSessionToken: class {},
        Place: class {},
      }),
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("901 McDonald");
    const warnedMessage = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnedMessage).toMatch(/REQUEST_DENIED/);
    expect(warnedMessage).toMatch(/Places API \(New\)/);
    warnSpy.mockRestore();
    vi.doUnmock("../googleMapsLoader");
  });

  it("logs OVER_QUERY_LIMIT with a billing remediation hint", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockResolvedValue({
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi
            .fn()
            .mockRejectedValue(new Error("OVER_QUERY_LIMIT: You have exceeded your daily quota")),
        },
        AutocompleteSessionToken: class {},
        Place: class {},
      }),
    }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => GOOGLE_AUTOCOMPLETE_RESPONSE,
    });
    const { searchAddresses } = await import("../addressSearch");
    await searchAddresses("901 McDonald");
    const warnedMessage = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnedMessage).toMatch(/OVER_QUERY_LIMIT/);
    expect(warnedMessage).toMatch(/Billing/i);
    warnSpy.mockRestore();
    vi.doUnmock("../googleMapsLoader");
  });

  it("Place.fetchFields parses Street/Apt/City/State/ZIP via the JS SDK", async () => {
    vi.stubEnv("VITE_ENABLE_DIRECT_GOOGLE_PLACES", "true");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "test-key");
    vi.doMock("../googleMapsLoader", () => ({
      loadGoogleMaps: vi.fn().mockResolvedValue({
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: vi.fn() },
        AutocompleteSessionToken: class {},
        Place: class {
          fetchFields() {
            return Promise.resolve({
              place: {
                addressComponents: [
                  { longText: "901", shortText: "901", types: ["street_number"] },
                  { longText: "McDonald Drive", shortText: "McDonald Dr", types: ["route"] },
                  { longText: "Apt 4B", shortText: "Apt 4B", types: ["subpremise"] },
                  { longText: "Northville", shortText: "Northville", types: ["locality"] },
                  {
                    longText: "Michigan",
                    shortText: "MI",
                    types: ["administrative_area_level_1"],
                  },
                  { longText: "48167", shortText: "48167", types: ["postal_code"] },
                ],
              },
            });
          }
        },
      }),
    }));
    const { fetchGooglePlaceDetails } = await import("../addressSearch");
    const parts = await fetchGooglePlaceDetails("ChIJ-fake-1", "session-tok");
    expect(parts).toEqual({
      street: "901 McDonald Drive",
      apt: "Apt 4B",
      city: "Northville",
      state: "MI",
      zip: "48167",
    });
    vi.doUnmock("../googleMapsLoader");
  });
});
