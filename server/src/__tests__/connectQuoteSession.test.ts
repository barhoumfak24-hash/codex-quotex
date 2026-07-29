import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  readRemoteState: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  prisma: {
    quotingSession: {
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
  },
}));

vi.mock("../services/supabaseState.js", () => ({
  readRemoteState: mocks.readRemoteState,
}));

import type { AuthContext } from "../middleware/auth.js";
import { ensureConnectQuoteSession } from "../services/connectQuoteSession.js";

const auth: AuthContext = {
  userId: "user_1",
  role: "agent",
  tenantId: "tenant_1",
  permissions: [],
  authVersion: 1,
};

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.create.mockReset();
  mocks.readRemoteState.mockReset();
});

describe("Connect quote-session recovery", () => {
  it("accepts an existing session only for the signed-in tenant", async () => {
    mocks.findUnique.mockResolvedValue({ tenantId: "tenant_1" });

    await expect(ensureConnectQuoteSession(auth, "quote_1")).resolves.toBe(true);
    expect(mocks.readRemoteState).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue({ tenantId: "tenant_2" });
    await expect(ensureConnectQuoteSession(auth, "quote_1")).resolves.toBe(false);
  });

  it("materializes a tenant-scoped cloud session for a Connect job", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 8,
      snapshot: {
        agencies: [
          { id: "tenant_1", name: "Agency One" },
          { id: "tenant_2", name: "Agency Two" },
        ],
        users: [
          { id: "user_1", tenantId: "tenant_1" },
          { id: "user_2", tenantId: "tenant_2" },
        ],
        quotingSessions: [
          {
            id: "quote_1",
            tenantId: "tenant_1",
            assetType: "luxury_vehicle",
            estimatedValue: 45000,
            assetDetails: { vin: "1HGCM82633A004352" },
            categoryId: "personal_auto",
            categoryLabel: "Personal Auto",
            state: "MI",
            lineOfBusiness: "personal",
            status: "quoting",
          },
          {
            id: "quote_other",
            tenantId: "tenant_2",
            assetType: "other",
            status: "quoting",
          },
        ],
      },
    });
    mocks.create.mockResolvedValue({ id: "quote_1" });

    await expect(ensureConnectQuoteSession(auth, "quote_1")).resolves.toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        id: "quote_1",
        tenantId: "tenant_1",
        assetType: "luxury_vehicle",
        estimatedValue: 45000,
        assetDetails: { vin: "1HGCM82633A004352" },
        categoryId: "personal_auto",
        categoryLabel: "Personal Auto",
        state: "MI",
        lineOfBusiness: "personal",
        createdById: "user_1",
        status: "quoting",
      },
    });
  });

  it("does not recover a session owned by another tenant", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 3,
      snapshot: {
        agencies: [
          { id: "tenant_1", name: "Agency One" },
          { id: "tenant_2", name: "Agency Two" },
        ],
        users: [
          { id: "user_1", tenantId: "tenant_1" },
          { id: "user_2", tenantId: "tenant_2" },
        ],
        quotingSessions: [
          {
            id: "quote_other",
            tenantId: "tenant_2",
            assetType: "other",
            status: "quoting",
          },
        ],
      },
    });

    await expect(ensureConnectQuoteSession(auth, "quote_other")).resolves.toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("treats a bundled Prisma P2002 race as an idempotent success", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ tenantId: "tenant_1" });
    mocks.readRemoteState.mockResolvedValue({
      id: "app_state:default",
      revision: 9,
      snapshot: {
        agencies: [{ id: "tenant_1", name: "Agency One" }],
        users: [{ id: "user_1", tenantId: "tenant_1" }],
        quotingSessions: [
          {
            id: "quote_1",
            tenantId: "tenant_1",
            assetType: "luxury_vehicle",
            status: "quoting",
          },
        ],
      },
    });
    mocks.create.mockRejectedValue({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["id"] },
    });

    await expect(ensureConnectQuoteSession(auth, "quote_1")).resolves.toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});
