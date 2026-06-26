import type { Request, Response } from "express";
import { pbkdf2Sync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBodyTenantMatchesAuth,
  assertRequestTenantMatchesAuth,
  requireAuth,
} from "../middleware/auth.js";
import { issueSessionJwt, verifyPasswordHashForLogin as verifyRoutePasswordHash } from "../routes/auth.js";

type MockRequest = Partial<Request> & {
  auth?: Request["auth"];
  body?: unknown;
};

function mockReq(headers: Record<string, string | undefined> = {}, body?: unknown): MockRequest {
  return {
    body,
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

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-with-more-than-32-characters");
  vi.stubEnv("JWT_ISSUER", "");
  vi.stubEnv("JWT_AUDIENCE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server auth middleware", () => {
  it("rejects spoofable identity headers in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_AUTH_HEADERS", "true");
    const req = mockReq({
      "x-user-id": "user_1",
      "x-user-role": "agent",
      "x-tenant-id": "tenant_a",
    });
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as Request, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.state.status).toBe(401);
    expect(res.state.json).toEqual({ error: "unauthorized" });
  });

  it("allows development header auth only when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_AUTH_HEADERS", "true");
    const req = mockReq({
      "x-user-id": "user_1",
      "x-user-role": "agent",
      "x-tenant-id": "tenant_a",
      "x-user-permissions": "quotes:run,documents:read",
    });
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      userId: "user_1",
      role: "agent",
      tenantId: "tenant_a",
      permissions: ["quotes:run", "documents:read"],
    });
  });

  it("accepts a signed tenant-scoped JWT in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ISSUER", "quotex");
    vi.stubEnv("JWT_AUDIENCE", "quotex-api");
    const token = jwt.sign(
      {
        userId: "user_1",
        role: "agent",
        tenantId: "tenant_a",
        permissions: ["quotes:run"],
      },
      process.env.JWT_SECRET!,
      { algorithm: "HS256", issuer: "quotex", audience: "quotex-api" }
    );
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      userId: "user_1",
      role: "agent",
      tenantId: "tenant_a",
      permissions: ["quotes:run"],
    });
  });

  it("rejects tenant IDs in the body that do not match the authenticated tenant", () => {
    const req = mockReq({}, { session: { tenantId: "tenant_b" } });
    req.auth = {
      userId: "user_1",
      role: "agent",
      tenantId: "tenant_a",
      permissions: [],
    };
    const res = mockRes();

    const ok = assertBodyTenantMatchesAuth(req as Request, res as unknown as Response);

    expect(ok).toBe(false);
    expect(res.state.status).toBe(403);
    expect(res.state.json).toEqual({ error: "tenant_mismatch" });
  });

  it("rejects tenant IDs in query strings that do not match the authenticated tenant", () => {
    const req = mockReq({}, undefined);
    req.query = { tenantId: "tenant_b" };
    req.params = {};
    req.originalUrl = "/api/customers?tenantId=tenant_b";
    req.auth = {
      userId: "user_1",
      role: "agent",
      tenantId: "tenant_a",
      permissions: [],
    };
    const res = mockRes();

    const ok = assertRequestTenantMatchesAuth(req as Request, res as unknown as Response);

    expect(ok).toBe(false);
    expect(res.state.status).toBe(403);
    expect(res.state.json).toEqual({ error: "tenant_mismatch" });
  });

  it("rejects agency ids in tenant route paths for non-platform users", () => {
    const req = mockReq({}, undefined);
    req.query = {};
    req.params = {};
    req.originalUrl = "/api/tenants/tenant_b";
    req.auth = {
      userId: "user_1",
      role: "manager",
      tenantId: "tenant_a",
      permissions: [],
    };
    const res = mockRes();

    const ok = assertRequestTenantMatchesAuth(req as Request, res as unknown as Response);

    expect(ok).toBe(false);
    expect(res.state.status).toBe(403);
    expect(res.state.json).toEqual({ error: "tenant_mismatch" });
  });

  it("allows platform admins to inspect another tenant", () => {
    const req = mockReq({}, { tenantId: "tenant_b" });
    req.query = { agencyId: "tenant_c" };
    req.params = {};
    req.originalUrl = "/api/tenants/tenant_b";
    req.auth = {
      userId: "platform_1",
      role: "master_admin",
      tenantId: null,
      permissions: [],
    };
    const res = mockRes();

    const ok = assertRequestTenantMatchesAuth(req as Request, res as unknown as Response);

    expect(ok).toBe(true);
    expect(res.state.status).toBe(200);
  });
});

describe("server auth login helpers", () => {
  it("verifies PBKDF2 password hashes and rejects plain text", () => {
    const salt = "test-login-salt";
    const expected = pbkdf2Sync("correct horse battery staple", salt, 150_000, 32, "sha256").toString("hex");
    const encoded = `pbkdf2$sha256$150000$${salt}$${expected}`;

    expect(verifyRoutePasswordHash("correct horse battery staple", encoded)).toBe(true);
    expect(verifyRoutePasswordHash("wrong", encoded)).toBe(false);
    expect(verifyRoutePasswordHash("correct horse battery staple", "correct horse battery staple")).toBe(false);
  });

  it("issues a JWT accepted by production auth middleware", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ISSUER", "quotex");
    vi.stubEnv("JWT_AUDIENCE", "quotex-api");
    const token = issueSessionJwt({
      userId: "user_login",
      role: "manager",
      tenantId: "tenant_login",
      branchId: "branch_1",
      permissions: ["documents:read"],
    });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth).toMatchObject({
      userId: "user_login",
      role: "manager",
      tenantId: "tenant_login",
      branchId: "branch_1",
      permissions: ["documents:read"],
    });
  });
});
