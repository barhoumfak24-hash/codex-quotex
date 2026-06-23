import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitForTest, applyRateLimit } from "../_rateLimit";

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
  __resetRateLimitForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applyRateLimit", () => {
  it("allows requests inside the memory bucket and rejects the next request", async () => {
    const req = { headers: { "x-forwarded-for": "203.0.113.10" } };

    expect(await applyRateLimit(req, mockRes(), "unit", { windowMs: 60_000, limit: 2 })).toBe(
      true
    );
    expect(await applyRateLimit(req, mockRes(), "unit", { windowMs: 60_000, limit: 2 })).toBe(
      true
    );

    const blocked = mockRes();
    expect(await applyRateLimit(req, blocked, "unit", { windowMs: 60_000, limit: 2 })).toBe(
      false
    );
    expect(blocked.state.status).toBe(429);
    expect(blocked.state.headers["Retry-After"]).toBeTypeOf("number");
    expect(blocked.state.json).toEqual({
      error: "rate_limited",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("uses the shared Upstash bucket when configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ result: 1 }, { result: 1 }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ result: 2 }, { result: 1 }],
        })
    );

    const req = { headers: { "x-real-ip": "198.51.100.22" } };
    const allowed = mockRes();
    const blocked = mockRes();

    expect(await applyRateLimit(req, allowed, "shared", { windowMs: 60_000, limit: 1 })).toBe(
      true
    );
    expect(await applyRateLimit(req, blocked, "shared", { windowMs: 60_000, limit: 1 })).toBe(
      false
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://redis.example/pipeline",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer redis-token" }),
      })
    );
    expect(blocked.state.status).toBe(429);
  });

  it("fails closed in production when no shared store is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const res = mockRes();
    expect(
      await applyRateLimit({ headers: {} }, res, "shared", { windowMs: 60_000, limit: 1 })
    ).toBe(false);
    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "rate_limit_store_required" });
  });

  it("fails closed when the shared store is unavailable", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "redis-token");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network down")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = mockRes();
    expect(
      await applyRateLimit({ headers: {} }, res, "shared", { windowMs: 60_000, limit: 1 })
    ).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("[rate-limit] shared store failed", expect.any(Error));
    expect(res.state.status).toBe(503);
    expect(res.state.json).toEqual({ error: "rate_limit_unavailable" });
  });
});
