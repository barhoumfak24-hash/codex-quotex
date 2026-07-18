import type { Request, Response } from "express";
import { scryptSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockRequest = Partial<Request> & {
  body?: unknown;
};

function mockReq(body?: unknown): MockRequest {
  return {
    body,
    header() {
      return undefined;
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

describe("employee login repair", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reactivates an inactive server staff row when the agency is active and the password hash is valid", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "test-jwt-secret-with-more-than-32-characters");
    vi.stubEnv("JWT_ISSUER", "");
    vi.stubEnv("JWT_AUDIENCE", "");

    const password = "same-password-123";
    const agencyId = "agency_server_reactivated";
    const email = "manager@server-reactivated.example";
    const agencyRow = {
      id: agencyId,
      name: "Server Reactivated Agency",
      contactEmail: "owner@server-reactivated.example",
      phone: null,
      address: null,
      website: null,
      websiteSlug: null,
      websiteEnabled: false,
      agencyCodeHash: null,
      agencyCodePreview: null,
      tier: "starter",
      active: true,
      allowedUsers: 3,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inactiveUser = {
      id: "user_server_reactivated_manager",
      tenantId: agencyId,
      branchId: null,
      name: "Server Reactivated Manager",
      email,
      phone: null,
      role: "manager",
      status: "inactive",
      passwordHash: testScryptHash(password),
      passwordChangedAt: new Date(),
      authVersion: 0,
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: agencyRow,
    };

    const { authRoutes } = await import("../routes/auth.js");
    const { prisma } = await import("../services/prisma.js");

    vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([inactiveUser] as any);
    let currentStatus = "inactive";
    vi.spyOn(prisma.user, "update").mockImplementation(async ({ data }: any) => {
      if (data.status) currentStatus = data.status;
      return {
        ...inactiveUser,
        ...data,
        status: currentStatus,
        agency: agencyRow,
      };
    });

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/employee/login");
    const handler = layer?.route?.stack?.[0]?.handle;
    expect(typeof handler).toBe("function");

    const req = mockReq({ identifier: email, password });
    const res = mockRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(200);
    const body = res.state.json as { ok?: boolean; token?: string; user?: { email?: string; tenantId?: string } };
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({ email, tenantId: agencyId });
    expect(typeof body.token).toBe("string");
    expect((prisma.user.update as any).mock.calls[0][0].data).toMatchObject({ status: "active" });
  });

  it("does not let a stale snapshot password reactivate staff while the agency is inactive", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "test-jwt-secret-with-more-than-32-characters");
    vi.stubEnv("JWT_ISSUER", "");
    vi.stubEnv("JWT_AUDIENCE", "");
    const password = "same-password-123";
    const agencyId = "agency_reactivated";
    const email = "manager@reactivated.example";
    const agencyRow = {
      id: agencyId,
      name: "Reactivated Agency",
      contactEmail: "owner@reactivated.example",
      phone: null,
      address: null,
      website: null,
      websiteSlug: null,
      websiteEnabled: false,
      agencyCodeHash: null,
      agencyCodePreview: null,
      tier: "starter",
      active: true,
      allowedUsers: 3,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const inactiveUser = {
      id: "user_reactivated_manager",
      tenantId: agencyId,
      branchId: null,
      name: "Reactivated Manager",
      email,
      phone: null,
      role: "manager",
      status: "inactive",
      passwordHash: testScryptHash("current-server-password"),
      passwordChangedAt: new Date(),
      authVersion: 0,
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: { ...agencyRow, active: false },
    };

    const { authRoutes } = await import("../routes/auth.js");
    const { prisma } = await import("../services/prisma.js");

    vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([inactiveUser] as any);
    const updateSpy = vi.spyOn(prisma.user, "update");

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/employee/login");
    const handler = layer?.route?.stack?.[0]?.handle;
    expect(typeof handler).toBe("function");

    const req = mockReq({ identifier: email, password });
    const res = mockRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(403);
    expect(res.state.json).toMatchObject({ ok: false, reason: "agency_inactive" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("creates a staff account when the hidden agency snapshot has no contact email", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://test");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "test-jwt-secret-with-more-than-32-characters");
    vi.stubEnv("JWT_ISSUER", "");
    vi.stubEnv("JWT_AUDIENCE", "");

    const agencyCode = "TA2U6YR";
    const agencyId = "agency_blank_contact";
    const email = "manager@blank-contact.example";
    const agencyRow = {
      id: agencyId,
      name: "Blank Contact Agency",
      contactEmail: email,
      phone: null,
      address: null,
      website: null,
      websiteSlug: null,
      websiteEnabled: false,
      agencyCodeHash: null,
      agencyCodePreview: agencyCode.slice(-4),
      tier: "starter",
      active: true,
      allowedUsers: 3,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const createdUser = {
      id: "user_blank_contact_manager",
      tenantId: agencyId,
      branchId: null,
      name: "Abe Fakhoury",
      email,
      phone: "5172942671",
      role: "manager",
      status: "active",
      passwordHash: "created-hash",
      passwordChangedAt: new Date(),
      authVersion: 0,
      mfaEnabled: false,
      profile: {},
      permissions: {},
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: agencyRow,
    };

    const { authRoutes } = await import("../routes/auth.js");
    const { prisma } = await import("../services/prisma.js");

    vi.spyOn(prisma.agency, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.agency, "upsert").mockResolvedValue(agencyRow as any);
    vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null as any);
    vi.spyOn(prisma.user, "count").mockResolvedValue(0);
    vi.spyOn(prisma.user, "create").mockResolvedValue(createdUser as any);
    vi.spyOn(prisma.user, "update").mockResolvedValue(createdUser as any);

    const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === "/employee/register");
    const handler = layer?.route?.stack?.[0]?.handle;
    expect(typeof handler).toBe("function");

    const req = mockReq({
      agencyCode,
      role: "manager",
      firstName: "Abe",
      lastName: "Fakhoury",
      phone: "5172942671",
      businessEmail: email,
      password: "same-password-123",
      agency: {
        id: agencyId,
        name: agencyRow.name,
        contactEmail: "",
        active: true,
        allowedUsers: 3,
        agencyCode,
        agencyCodePreview: agencyCode.slice(-4),
      },
    });
    const res = mockRes();

    await handler(req as Request, res as unknown as Response);

    expect(res.state.status).toBe(200);
    const body = res.state.json as { ok?: boolean; token?: string; user?: { email?: string; tenantId?: string } };
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({ email, tenantId: agencyId });
    expect(typeof body.token).toBe("string");
    expect(prisma.user.create).toHaveBeenCalled();
  });
});

function testScryptHash(password: string): string {
  const salt = "0123456789abcdef0123456789abcdef";
  const n = 16_384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 32, { N: n, r, p }).toString("hex");
  return `scrypt$${n}$${r}$${p}$${salt}$${hash}`;
}
