import type { Request, Response } from "express";
import { pbkdf2Sync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBodyTenantMatchesAuth,
  assertRequestTenantMatchesAuth,
  requireAuth,
} from "../middleware/auth.js";
import { authRoutes, issueSessionJwt, verifyPasswordHashForLogin as verifyRoutePasswordHash } from "../routes/auth.js";
import { prisma } from "../services/prisma.js";

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
  const state: { status: number; json: unknown; headers: Record<string, string> } = { status: 200, json: null, headers: {} };
  const res = {
    state,
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return res;
    },
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
  it("marks auth responses as no-store so browsers cannot reuse stale session checks", () => {
    const cacheLayer = (authRoutes as any).stack.find((layer: any) => !layer.route);
    expect(typeof cacheLayer?.handle).toBe("function");
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    cacheLayer.handle(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.state.headers["cache-control"]).toContain("no-store");
    expect(res.state.headers.pragma).toBe("no-cache");
    expect(res.state.headers.expires).toBe("0");
  });

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

  it("creates a server-backed master account with a platform-scoped JWT", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_ISSUER", "quotex");
    vi.stubEnv("JWT_AUDIENCE", "quotex-api");
    vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null);
    vi.spyOn(prisma.agency, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.agency, "create").mockImplementation(async ({ data }: any) => ({
      ...data,
      logoUrl: null,
      brandColor: null,
      address: null,
      websiteSlug: null,
      agencyCodeHash: null,
      agencyCodePreview: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.spyOn(prisma.user, "create").mockImplementation(async ({ data }: any) => ({
      ...data,
      branchId: null,
      mfaEnabled: false,
      profile: data.profile ?? {},
      permissions: data.permissions ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/master/create");
    const handler = layer?.route?.stack?.[0]?.handle;
    expect(typeof handler).toBe("function");

    const req = mockReq({}, {
      name: "Founder",
      email: "contact@quotexinsurance.com",
      password: "correct horse battery staple",
    });
    const res = mockRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(200);
    const body = res.state.json as { token?: string; user?: { role?: string; tenantId?: string | null } };
    expect(body.user).toMatchObject({ role: "master_admin", tenantId: null });
    expect(typeof body.token).toBe("string");

    const authReq = mockReq({ authorization: `Bearer ${body.token}` });
    const authRes = mockRes();
    const next = vi.fn();
    requireAuth(authReq as Request, authRes as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(authReq.auth).toMatchObject({
      role: "master_admin",
      tenantId: null,
      userId: expect.any(String),
    });
  });

  it("lets the existing master owner enter from create account when the same email and passphrase match", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    const salt = "existing-master-salt";
    const hash = pbkdf2Sync("correct horse battery staple", salt, 150_000, 32, "sha256").toString("hex");
    const existingMaster = {
      id: "user_master_existing",
      tenantId: "agency_quotex_platform",
      branchId: null,
      name: "Founder",
      email: "contact@quotexinsurance.com",
      phone: null,
      role: "master_admin",
      status: "active",
      passwordHash: `pbkdf2$sha256$150000$${salt}$${hash}`,
      passwordChangedAt: new Date(),
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
    vi.spyOn(prisma.user, "findFirst").mockResolvedValue(existingMaster);
    vi.spyOn(prisma.user, "update").mockResolvedValue({ ...existingMaster, lastLoginAt: new Date() });

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/master/create");
    const handler = layer?.route?.stack?.[0]?.handle;
    expect(typeof handler).toBe("function");

    const req = mockReq({}, {
      name: "Founder",
      email: "contact@quotexinsurance.com",
      password: "correct horse battery staple",
    });
    const res = mockRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(200);
    expect(res.state.json).toMatchObject({
      ok: true,
      user: {
        id: "user_master_existing",
        tenantId: null,
        role: "master_admin",
        email: "contact@quotexinsurance.com",
      },
    });
  });

  it("returns the current master session from /me", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    const token = issueSessionJwt({
      userId: "user_master",
      role: "master_admin",
      tenantId: null,
      branchId: null,
      permissions: [],
    });
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user_master",
      tenantId: "agency_quotex_platform",
      branchId: null,
      name: "Founder",
      email: "founder@quotexinsurance.com",
      phone: null,
      role: "master_admin",
      status: "active",
      passwordHash: "hash",
      passwordChangedAt: new Date(),
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: null,
    } as any);

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/me");
    const authMiddleware = layer?.route?.stack?.[0]?.handle;
    const handler = layer?.route?.stack?.[1]?.handle;
    expect(typeof authMiddleware).toBe("function");
    expect(typeof handler).toBe("function");

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(200);
    expect(res.state.json).toMatchObject({
      ok: true,
      user: {
        id: "user_master",
        tenantId: null,
        role: "master_admin",
        email: "founder@quotexinsurance.com",
      },
    });
  });

  it("rejects the current staff session when the agency is deactivated", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    const token = issueSessionJwt({
      userId: "user_manager",
      role: "manager",
      tenantId: "agency_suspended",
      branchId: null,
      permissions: [],
    });
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user_manager",
      tenantId: "agency_suspended",
      branchId: null,
      name: "Manager",
      email: "manager@suspended.example",
      phone: null,
      role: "manager",
      status: "active",
      passwordHash: "hash",
      passwordChangedAt: new Date(),
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: {
        id: "agency_suspended",
        name: "Suspended Agency",
        active: false,
      },
    } as any);

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/me");
    const authMiddleware = layer?.route?.stack?.[0]?.handle;
    const handler = layer?.route?.stack?.[1]?.handle;
    expect(typeof authMiddleware).toBe("function");
    expect(typeof handler).toBe("function");

    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(403);
    expect(res.state.json).toMatchObject({ ok: false, error: "inactive_agency" });
  });
});
