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
  vi.stubEnv("SMARTY_AUTH_ID", "auth-id-test");
  vi.stubEnv("SMARTY_AUTH_TOKEN", "auth-token-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/smarty-autocomplete", () => {
  it("signs Smarty autocomplete server-side and returns normalized suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            street_line: "901 McDonald Dr",
            secondary: "",
            city: "Northville",
            state: "MI",
            zipcode: "48167",
          },
        ],
      }),
    });

    const handler = (await import("../smarty-autocomplete")).default;
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
        body: { query: "901 McDonald", maxResults: 10 },
      },
      res
    );

    expect(res.state.status).toBe(200);
    const [calledUrl, fetchOptions] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = String(calledUrl);
    expect(url).toContain("us-autocomplete-pro.api.smarty.com/lookup");
    expect(url).toContain("auth-id=auth-id-test");
    expect(url).toContain("auth-token=auth-token-test");
    expect(url).toContain("search=901+McDonald");
    expect(fetchOptions.headers["X-Forwarded-For"]).toBe("203.0.113.10");
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "901_McDonald_Dr,_Northville,_MI_48167",
          description: "901 McDonald Dr, Northville, MI 48167",
        },
      ],
    });
  });

  it("does not leak Smarty credentials when upstream fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const handler = (await import("../smarty-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "901 McDonald" } }, res);

    expect(res.state.status).toBe(502);
    const serialized = JSON.stringify(res.state.json);
    expect(serialized).not.toContain("auth-id-test");
    expect(serialized).not.toContain("auth-token-test");
  });

  it("allows two-character searches so the UI can show early suggestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            street_line: "9070 7 Mile Rd",
            city: "Northville",
            state: "MI",
            zipcode: "48167",
          },
        ],
      }),
    });

    const handler = (await import("../smarty-autocomplete")).default;
    const res = mockRes();
    await handler({ method: "POST", body: { query: "90" } }, res);

    expect(res.state.status).toBe(200);
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("search=90");
    expect(res.state.json).toEqual({
      suggestions: [
        {
          id: "9070_7_Mile_Rd,_Northville,_MI_48167",
          description: "9070 7 Mile Rd, Northville, MI 48167",
        },
      ],
    });
  });
});
