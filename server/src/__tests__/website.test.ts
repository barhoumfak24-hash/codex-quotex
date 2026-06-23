import type { Request, Response } from "express";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireWebsiteSignature } from "../routes/website.js";

const SECRET = "website-secret-with-more-than-thirty-two-characters";

function mockReq(headers: Record<string, string | undefined>, rawBody: Buffer): Partial<Request> {
  return {
    rawBody,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function mockRes() {
  const state: { status: number; json: unknown } = { status: 200, json: null };
  const res = {
    state,
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.json = payload;
      return res;
    },
  };
  return res;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("website webhook signatures", () => {
  it("allows unsigned website payloads in local development when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WEBSITE_WEBHOOK_SECRET", "");
    const next = vi.fn();

    requireWebsiteSignature(mockReq({}, Buffer.from("{}")) as Request, mockRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails closed in production when the webhook secret is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBSITE_WEBHOOK_SECRET", "");
    const res = mockRes();

    requireWebsiteSignature(mockReq({}, Buffer.from("{}")) as Request, res as unknown as Response, vi.fn());

    expect(res.state.status).toBe(500);
    expect(res.state.json).toEqual({ error: "website_webhook_secret_not_configured" });
  });

  it("rejects invalid signatures", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBSITE_WEBHOOK_SECRET", SECRET);
    const res = mockRes();

    requireWebsiteSignature(
      mockReq({ "x-quotex-signature": `sha256=${"0".repeat(64)}` }, Buffer.from('{"agencyId":"agency_1"}')) as Request,
      res as unknown as Response,
      vi.fn()
    );

    expect(res.state.status).toBe(401);
    expect(res.state.json).toEqual({ error: "invalid_website_signature" });
  });

  it("accepts valid HMAC SHA-256 signatures", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEBSITE_WEBHOOK_SECRET", SECRET);
    const payload = Buffer.from('{"agencyId":"agency_1"}');
    const signature = createHmac("sha256", SECRET).update(payload).digest("hex");
    const next = vi.fn();

    requireWebsiteSignature(
      mockReq({ "x-quotex-signature": `sha256=${signature}` }, payload) as Request,
      mockRes() as unknown as Response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
