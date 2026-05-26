import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// /api/smarty-validate — Vercel serverless function tests.
//
// Locks in the contract with Smarty's US Street API:
//   - URL shape (auth-id + auth-token + license + match + candidates)
//   - Body parsing (freeform OR structured)
//   - Response shape (standardized + lat/lon + county + zip4)
//   - Error handling (500 / 502 / 429 / missing-config)
//   - In-memory LRU dedupes repeated identical queries
// =====================================================================

const SMARTY_NORTHVILLE: unknown[] = [
  {
    delivery_line_1: "901 McDonald Dr",
    delivery_line_2: "Apt 4B",
    components: {
      primary_number: "901",
      street_name: "McDonald",
      street_suffix: "Dr",
      secondary_designator: "Apt",
      secondary_number: "4B",
      city_name: "Northville",
      state_abbreviation: "MI",
      zipcode: "48167",
      plus4_code: "2241",
    },
    metadata: {
      county_name: "Wayne",
      latitude: 42.4314,
      longitude: -83.483,
      time_zone: "Eastern",
      utc_offset: -5,
      dst: true,
      rdi: "Residential",
    },
    analysis: {
      dpv_match_code: "Y",
      active: "Y",
      vacant: "N",
    },
  },
];

// Minimal Vercel-style res shape
function mockRes() {
  const state: { status: number; json: unknown } = { status: 200, json: null };
  return {
    state,
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
  vi.stubEnv("SMARTY_AUTH_ID", "auth-id-test");
  vi.stubEnv("SMARTY_AUTH_TOKEN", "auth-token-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/smarty-validate — happy path", () => {
  it("rejects non-POST methods with 405", async () => {
    const handler = (await import("../smarty-validate")).default;
    const res = mockRes();
    await handler({ method: "GET", body: {} }, res);
    expect(res.state.status).toBe(405);
  });

  it("returns 500 when SMARTY credentials are missing", async () => {
    vi.unstubAllEnvs();
    const handler = (await import("../smarty-validate")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, res);
    expect(res.state.status).toBe(500);
    expect((res.state.json as { error: string }).error).toBe("smarty_not_configured");
  });

  it("returns 400 when neither freeform nor street is provided", async () => {
    const handler = (await import("../smarty-validate")).default;
    const res = mockRes();
    await handler({ method: "POST", body: {} }, res);
    expect(res.state.status).toBe(400);
  });

  it("calls Smarty with auth params + freeform input and parses the response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => SMARTY_NORTHVILLE,
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler(
      { method: "POST", body: { freeform: "901 McDonald Dr, Northville, MI 48167" } },
      res
    );
    expect(res.state.status).toBe(200);
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("us-street.api.smarty.com/street-address");
    expect(calledUrl).toContain("auth-id=auth-id-test");
    expect(calledUrl).toContain("auth-token=auth-token-test");
    expect(calledUrl).toContain("license=us-core-cloud");
    expect(calledUrl).toContain("match=strict");
    expect(calledUrl).toContain("candidates=5");
    expect(calledUrl).toContain("street=901+McDonald+Dr%2C+Northville%2C+MI+48167");
    const payload = res.state.json as { result: Record<string, unknown> };
    expect(payload.result).toEqual({
      deliverable: true,
      dpvCode: "Y",
      standardized: {
        street: "901 McDonald Dr",
        apt: "Apt 4B",
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
      composed: "901 McDonald Dr Apt 4B, Northville, MI 48167-2241",
      cached: false,
    });
  });

  it("respects structured street/city/state/zip when freeform is absent", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => SMARTY_NORTHVILLE,
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler(
      {
        method: "POST",
        body: { street: "901 McDonald Dr", city: "Northville", state: "MI", zip: "48167" },
      },
      res
    );
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("street=901+McDonald+Dr");
    expect(calledUrl).toContain("city=Northville");
    expect(calledUrl).toContain("state=MI");
    expect(calledUrl).toContain("zipcode=48167");
  });

  it("clamps candidates to 1..10 inclusive", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => SMARTY_NORTHVILLE,
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "abc", candidates: 99 } }, res);
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("candidates=10");
  });
});

describe("/api/smarty-validate — caching", () => {
  it("serves repeat lookups from the in-memory LRU without calling Smarty twice", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => SMARTY_NORTHVILLE,
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res1 = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald Dr" } }, res1);
    const res2 = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald Dr" } }, res2);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const payload = res2.state.json as { result: { cached: boolean } };
    expect(payload.result.cached).toBe(true);
  });

  it("normalizes whitespace / case so '901 McDonald' and '  901 mcdonald  ' share a cache entry", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => SMARTY_NORTHVILLE,
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, mockRes());
    await handler({ method: "POST", body: { freeform: "  901 mcdonald  " } }, mockRes());
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

describe("/api/smarty-validate — error handling", () => {
  it("returns 502 when Smarty is unreachable (network error)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ECONNRESET"));
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, res);
    expect(res.state.status).toBe(502);
    expect((res.state.json as { error: string }).error).toBe("smarty_unreachable");
  });

  it("returns 429 when Smarty itself is rate limited", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({}),
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, res);
    expect(res.state.status).toBe(429);
  });

  it("returns 502 with status when Smarty returns 5xx", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, res);
    expect(res.state.status).toBe(502);
    expect((res.state.json as { status: number }).status).toBe(503);
  });

  it("returns 200 with result=null when Smarty has zero candidates", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "asdf asdf" } }, res);
    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({ result: null });
  });

  it("does not leak the Smarty credentials in any error response body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ secret: "leaked" }),
    });
    const { default: handler, __resetCacheForTest } = await import("../smarty-validate");
    __resetCacheForTest();
    const res = mockRes();
    await handler({ method: "POST", body: { freeform: "901 McDonald" } }, res);
    const serialized = JSON.stringify(res.state.json);
    expect(serialized).not.toContain("auth-id-test");
    expect(serialized).not.toContain("auth-token-test");
  });
});