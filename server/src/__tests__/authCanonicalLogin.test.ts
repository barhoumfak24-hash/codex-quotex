import { pbkdf2Sync } from "node:crypto";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRoutes, verifyPasswordHashForLogin } from "../routes/auth.js";
import { prisma } from "../services/prisma.js";

type MockRequest = Partial<Request> & {
  auth?: Request["auth"];
  body?: unknown;
};

function mockReq(body?: unknown, auth?: Request["auth"]): MockRequest {
  return {
    body,
    auth,
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

function routeHandler(path: string, position = 0) {
  const layer = (authRoutes as any).stack.find((candidate: any) => candidate.route?.path === path);
  const handler = layer?.route?.stack?.[position]?.handle;
  expect(typeof handler).toBe("function");
  return handler as (req: Request, res: Response) => Promise<unknown>;
}

function passwordHash(password: string): string {
  const salt = "canonical-auth-test-salt";
  const expected = pbkdf2Sync(password, salt, 150_000, 32, "sha256").toString("hex");
  return `pbkdf2$sha256$150000$${salt}$${expected}`;
}

function agency(active = true) {
  return {
    id: "agency_auth_test",
    name: "Canonical Auth Agency",
    contactEmail: "owner@canonical-auth.example",
    phone: null,
    address: null,
    website: null,
    websiteSlug: null,
    websiteEnabled: false,
    serviceAreas: [],
    agencyCodeHash: null,
    agencyCodePreview: "AUTH",
    tier: "starter",
    active,
    allowedUsers: 10,
    allowedProspectsPerMonth: 100,
    allowedAiMessagesPerMonth: 500,
    allowedCarriers: 10,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function user(input: {
  id: string;
  email: string;
  role: "manager" | "customer" | "master_admin";
  status?: string;
  password?: string;
  agencyActive?: boolean;
}) {
  const tenantId = input.role === "master_admin" ? "agency_quotex_platform" : "agency_auth_test";
  return {
    id: input.id,
    tenantId,
    branchId: null,
    name: input.email.split("@")[0],
    email: input.email,
    phone: null,
    role: input.role,
    status: input.status ?? "active",
    passwordHash: passwordHash(input.password ?? "correct-password-123"),
    passwordChangedAt: new Date(),
    mfaEnabled: false,
    profile: {},
    permissions: {},
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    agency: input.role === "master_admin" ? undefined : agency(input.agencyActive ?? true),
  };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "test-jwt-secret-with-more-than-32-characters");
  vi.stubEnv("JWT_ISSUER", "");
  vi.stubEnv("JWT_AUDIENCE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("canonical production login", () => {
  it("accepts correct server credentials for staff, customers, and the master portal", async () => {
    const rows = {
      staff: user({ id: "staff_1", email: "staff@canonical-auth.example", role: "manager" }),
      customer: user({ id: "customer_1", email: "customer@canonical-auth.example", role: "customer" }),
      master: user({ id: "master_1", email: "master@canonical-auth.example", role: "master_admin" }),
    };
    vi.spyOn(prisma.user, "findFirst").mockImplementation(async ({ where }: any) => {
      if (where.role === "master_admin") return rows.master as any;
      if (where.role === "customer") return rows.customer as any;
      if (where.role?.in) return rows.staff as any;
      return null;
    });
    vi.spyOn(prisma.user, "update").mockImplementation(async ({ where, data }: any) => {
      const row = Object.values(rows).find((candidate) => candidate.id === where.id)!;
      return { ...row, ...data } as any;
    });

    const handler = routeHandler("/login");
    const attempts = [
      { scope: "staff", identifier: rows.staff.email },
      { scope: "customer", identifier: rows.customer.email },
      { scope: "master", identifier: rows.master.email },
    ];

    for (const attempt of attempts) {
      const res = mockRes();
      await handler(
        mockReq({ ...attempt, password: "correct-password-123" }) as Request,
        res as unknown as Response
      );
      expect(res.state.status).toBe(200);
      expect(res.state.json).toMatchObject({ ok: true, user: { email: attempt.identifier } });
    }
  });

  it("blocks staff while their agency is inactive", async () => {
    const row = user({
      id: "staff_inactive_agency",
      email: "blocked@canonical-auth.example",
      role: "manager",
      agencyActive: false,
    });
    vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(row as any);
    const updateSpy = vi.spyOn(prisma.user, "update");
    const res = mockRes();

    await routeHandler("/login")(
      mockReq({ scope: "staff", identifier: row.email, password: "correct-password-123" }) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(403);
    expect(res.state.json).toMatchObject({ ok: false, reason: "agency_inactive" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("reactivates an inactive staff account after the agency is reactivated", async () => {
    const row = user({
      id: "staff_reactivated",
      email: "reactivated@canonical-auth.example",
      role: "manager",
      status: "inactive",
    });
    vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(row as any);
    const updateSpy = vi.spyOn(prisma.user, "update").mockImplementation(async ({ data }: any) => ({
      ...row,
      ...data,
      agency: row.agency,
    }) as any);
    const res = mockRes();

    await routeHandler("/login")(
      mockReq({ scope: "staff", identifier: row.email, password: "correct-password-123" }) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(200);
    expect(updateSpy.mock.calls[0]?.[0]?.data).toMatchObject({ status: "active" });
  });

  it("returns wrong_portal when staff credentials are entered in the customer portal", async () => {
    const staff = user({ id: "staff_wrong_portal", email: "wrong-portal@canonical-auth.example", role: "manager" });
    vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(null).mockResolvedValueOnce(staff as any);
    const res = mockRes();

    await routeHandler("/login")(
      mockReq({ scope: "customer", identifier: staff.email, password: "correct-password-123" }) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(403);
    expect(res.state.json).toMatchObject({ ok: false, reason: "wrong_portal" });
  });

  it("never lets a stale local generatedPassword replace an existing server password hash", async () => {
    const row = user({ id: "staff_server_hash", email: "hashed@canonical-auth.example", role: "manager" });
    const findSpy = vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(row as any);
    const updateSpy = vi.spyOn(prisma.user, "update");
    const res = mockRes();

    await routeHandler("/login")(
      mockReq({ scope: "staff", identifier: row.email, password: "stale-local-password" }) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(401);
    expect(res.state.json).toMatchObject({ ok: false, reason: "invalid_credentials" });
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the production authentication database is unreachable", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const findSpy = vi.spyOn(prisma.user, "findFirst");
    const res = mockRes();

    await routeHandler("/login")(
      mockReq({ scope: "staff", identifier: "staff@canonical-auth.example", password: "correct-password-123" }) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(503);
    expect(res.state.json).toMatchObject({ ok: false, reason: "server_unreachable" });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("changes passwords only after verifying the current server hash", async () => {
    const row = user({ id: "staff_change_password", email: "change@canonical-auth.example", role: "manager" });
    vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(row as any);
    const updateSpy = vi.spyOn(prisma.user, "update").mockImplementation(async ({ data }: any) => ({
      ...row,
      ...data,
    }) as any);
    const res = mockRes();

    await routeHandler("/password/change", 1)(
      mockReq(
        { currentPassword: "correct-password-123", newPassword: "new-secure-password-456" },
        { userId: row.id, tenantId: row.tenantId, branchId: null, role: row.role, permissions: [] }
      ) as Request,
      res as unknown as Response
    );

    expect(res.state.status).toBe(200);
    expect(res.state.json).toEqual({ ok: true });
    const stored = updateSpy.mock.calls[0]?.[0]?.data.passwordHash as string;
    expect(stored).not.toBe("new-secure-password-456");
    expect(verifyPasswordHashForLogin("new-secure-password-456", stored)).toBe(true);
  });
});
