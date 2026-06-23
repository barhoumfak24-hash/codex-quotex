import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockRes() {
  const state: { status: number; json: unknown; headers: Record<string, string | number> } = {
    status: 200,
    json: null,
    headers: {},
  };
  return {
    state,
    setHeader(name: string, value: string | number) {
      state.headers[name] = value;
    },
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
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/__diag", () => {
  it("allows diagnostics outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const handler = (await import("../__diag")).default;
    const res = mockRes();

    await handler({ method: "GET", headers: {}, query: {} }, res);

    expect(res.state.status).toBe(200);
    expect((res.state.json as { ok: boolean }).ok).toBe(true);
  });

  it("hides diagnostics in production without DIAG_TOKEN", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    stubSharedRateLimit();
    const handler = (await import("../__diag")).default;
    const res = mockRes();

    await handler({ method: "GET", headers: {}, query: {} }, res);

    expect(res.state.status).toBe(404);
  });

  it("allows production diagnostics with the configured bearer token", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DIAG_TOKEN", "diagnostic-token");
    stubSharedRateLimit();
    const handler = (await import("../__diag")).default;
    const res = mockRes();

    await handler(
      { method: "GET", headers: { authorization: "Bearer diagnostic-token" }, query: {} },
      res
    );

    expect(res.state.status).toBe(200);
    expect((res.state.json as { ok: boolean }).ok).toBe(true);
  });
});

function stubSharedRateLimit() {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 1 }],
    })
  );
}
