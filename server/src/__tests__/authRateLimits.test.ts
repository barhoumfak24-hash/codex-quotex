import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authIdentityLimiter, resetRateLimitStateForTests } from "../middleware/rateLimits.js";

function mockRequest(identifier: string): Request {
  return {
    body: { identifier },
    headers: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
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
  return { state, response: response as unknown as Response };
}

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_STORE", "memory");
  resetRateLimitStateForTests();
});

afterEach(() => {
  resetRateLimitStateForTests();
  vi.unstubAllEnvs();
});

describe("canonical authentication rate limiting", () => {
  it("allows ten attempts per identifier and names the eleventh failure", async () => {
    const next = vi.fn() as unknown as NextFunction;

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const { state, response } = mockResponse();
      await authIdentityLimiter(mockRequest("Person@Example.com"), response, next);
      if (attempt <= 10) {
        expect(state.status).toBe(200);
      } else {
        expect(state.status).toBe(429);
        expect(state.json).toMatchObject({
          ok: false,
          reason: "rate_limited",
          error: "rate_limited",
        });
      }
    }

    expect(next).toHaveBeenCalledTimes(10);
  });
});
