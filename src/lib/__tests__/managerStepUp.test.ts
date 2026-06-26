import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/types";

const manager = {
  id: "user_manager",
  role: "manager",
  tenantId: "agency_1",
  branchId: "branch_1",
  email: "manager@example.com",
  businessEmail: "manager@example.com",
} as User;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("manager step-up 2FA", () => {
  it("retries the direct auth mount when the configured API mount returns 404", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api/app/api");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "not_found" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          challengeId: "challenge_12345",
          expiresAt: "2026-06-25T17:00:00.000Z",
          maskedEmail: "m*****r@example.com",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { requestManagerStepUp } = await import("../managerStepUp");
    const result = await requestManagerStepUp({
      user: manager,
      tenantId: "agency_1",
      email: "manager@example.com",
      customerId: "customer_1",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/app/api/auth/manager-2fa/request");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/manager-2fa/request");
  });
});
