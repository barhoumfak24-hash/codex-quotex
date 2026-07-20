import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("../services/prisma.js", () => ({
  databaseConfigured: () => true,
  prisma: {
    $queryRaw: queryRaw,
  },
}));

import { authLimiter, resetRateLimitStateForTests, stateSyncLimiter } from "../middleware/rateLimits.js";

function mockRequest(ip: string): Request {
  return {
    headers: {},
    ip,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function mockResponse() {
  const state: { status: number; json: unknown; headers: Record<string, string | number> } = {
    status: 200,
    json: null,
    headers: {},
  };
  const response = {
    setHeader(name: string, value: string | number) {
      state.headers[name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      state.status = code;
      return response;
    },
    json(payload: unknown) {
      state.json = payload;
      return response;
    },
  };
  return { response: response as unknown as Response, state };
}

async function runLimiter(ip: string) {
  const request = mockRequest(ip);
  const { response, state } = mockResponse();
  const next = vi.fn() as unknown as NextFunction;
  await authLimiter(request, response, next);
  return { next, state };
}

async function runStateSyncLimiter(ip: string) {
  const request = mockRequest(ip);
  const { response, state } = mockResponse();
  const next = vi.fn() as unknown as NextFunction;
  await stateSyncLimiter(request, response, next);
  return { next, state };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RATE_LIMIT_STORE", "postgres");
  vi.stubEnv("RATE_LIMIT_STORE_RETRY_MS", "30000");
  queryRaw.mockReset();
  resetRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rate limit store resilience", () => {
  it("keeps high-volume state sync counters out of the database pool", async () => {
    const result = await runStateSyncLimiter("203.0.113.9");

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.state.headers["ratelimit-limit"]).toBe(120);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("keeps authentication available when the postgres counter cannot write", async () => {
    queryRaw.mockRejectedValueOnce(new Error("cannot execute INSERT in a read-only transaction"));

    const result = await runLimiter("203.0.113.10");

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.state.status).toBe(200);
    expect(result.state.json).toBeNull();
    expect(result.state.headers["ratelimit-limit"]).toBe(30);
  });

  it("uses the fallback cooldown instead of retrying a failed store on every request", async () => {
    queryRaw.mockRejectedValueOnce(new Error("postgres unavailable"));

    const first = await runLimiter("203.0.113.11");
    const second = await runLimiter("203.0.113.12");

    expect(first.next).toHaveBeenCalledTimes(1);
    expect(second.next).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("still enforces the configured request limit while using the fallback", async () => {
    queryRaw.mockRejectedValueOnce(new Error("postgres unavailable"));
    const ip = "203.0.113.13";

    for (let request = 0; request < 30; request += 1) {
      const result = await runLimiter(ip);
      expect(result.next).toHaveBeenCalledTimes(1);
    }

    const blocked = await runLimiter(ip);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.state.status).toBe(429);
    expect(blocked.state.json).toMatchObject({ error: "rate_limited" });
  });
});
