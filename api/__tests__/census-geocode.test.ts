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
  vi.restoreAllMocks();
});

describe("/api/census-geocode", () => {
  it("returns Census matched addresses as clean dropdown suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          addressMatches: [
            {
              matchedAddress: "4600 SILVER HILL RD, WASHINGTON, DC, 20233",
            },
          ],
        },
      }),
    });

    const handler = (await import("../census-geocode")).default;
    const res = mockRes();
    await handler(
      { method: "POST", body: { query: "4600 Silver Hill Rd, Washington, DC 20233" } },
      res
    );

    expect(res.state.status).toBe(200);
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    expect(calledUrl).toContain("benchmark=Public_AR_Current");
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "4600_Silver_Hill_Rd,_Washington,_DC_20233",
          description: "4600 Silver Hill Rd, Washington, DC 20233",
        },
      ],
    });
  });
});
