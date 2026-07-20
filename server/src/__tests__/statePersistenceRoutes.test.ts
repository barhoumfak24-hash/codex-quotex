import express, { type Router } from "express";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stateRoutes } from "../routes/state.js";
import { stateBlobRoutes } from "../routes/stateBlobs.js";
import { scopeStateSnapshotForAuth } from "../services/stateSnapshotScope.js";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}));

vi.mock("../services/prisma.js", () => ({
  databaseConfigured: () => true,
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

const nativeFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ALLOW_DEV_AUTH_HEADERS", "true");
  vi.stubEnv("SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.stubEnv("JWT_SECRET", "state-persistence-test-secret");
  mocks.userFindUnique.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
    role: where.id.startsWith("customer_") ? "customer" : where.id === "user_a_2" ? "csr" : "agent",
    tenantId: where.id === "user_b" ? "agency_b" : "agency_a",
    branchId: null,
    authVersion: 0,
    status: "active",
    agency: { active: true },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("state persistence routes", () => {
  it("rejects state access immediately when the agency is inactive", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user_a",
      role: "agent",
      tenantId: "agency_a",
      branchId: null,
      authVersion: 0,
      status: "active",
      agency: { active: false },
    });
    const supabaseFetch = vi.fn(async () => jsonResponse([stateRow()]));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      headers: authHeaders("agent", "agency_a", "user_a"),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "agency_inactive" });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it("rejects state access immediately when the account is disabled", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user_a",
      role: "agent",
      tenantId: "agency_a",
      branchId: null,
      authVersion: 0,
      status: "banned",
      agency: { active: true },
    });
    const supabaseFetch = vi.fn(async () => jsonResponse([stateRow()]));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      headers: authHeaders("agent", "agency_a", "user_a"),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "account_disabled" });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it("does not accept the unscoped operational state token in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STATE_SYNC_TOKEN", "state-sync-test-token");
    const supabaseFetch = vi.fn(async () => jsonResponse([stateRow()]));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      headers: { "x-state-sync-token": "state-sync-test-token" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it("returns a controlled temporary response when Supabase state times out", async () => {
    vi.stubEnv("SUPABASE_STATE_TIMEOUT_MS", "5");
    const supabaseFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    );
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      headers: authHeaders("agent", "agency_a", "user_a"),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      found: false,
      error: "state_sync_temporarily_unavailable",
    });
  });

  it("returns only the authenticated customer's snapshot", async () => {
    const supabaseFetch = vi.fn(async () => jsonResponse([stateRow()]));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      headers: authHeaders("customer", "agency_a", "customer_user_a"),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.scoped).toBe(true);
    expect(payload.snapshot.customers.map((row: { id: string }) => row.id)).toEqual(["customer_a"]);
    expect(payload.snapshot.communications.map((row: { id: string }) => row.id)).toEqual(["communication_a"]);
    expect(payload.snapshot.users.every((row: { email?: string }) => row.email === undefined)).toBe(true);
  });

  it("accepts a customer reply without replacing staff or other-customer messages", async () => {
    const supabaseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return jsonResponse([stateRow()]);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return jsonResponse([{ id: "app_state:default", ...body }]);
      }
      return jsonResponse([], 500);
    });
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...authHeaders("customer", "agency_a", "customer_user_a"),
      },
      body: JSON.stringify({
        baseRevision: 7,
        snapshot: {
          communications: [
            {
              id: "communication_customer_reply",
              tenantId: "agency_a",
              customerId: "customer_a",
              body: "Customer reply",
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);
    const patchCall = supabaseFetch.mock.calls.find((call) => call[1]?.method === "PATCH");
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    expect(patchBody.snapshot.communications.map((row: { id: string }) => row.id)).toEqual([
      "communication_a",
      "communication_b",
      "communication_customer_reply",
    ]);
  });

  it("rejects a stale tenant base revision without issuing a Supabase PATCH", async () => {
    const supabaseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return jsonResponse([stateRow()]);
      return jsonResponse([], 500);
    });
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...authHeaders("agent", "agency_a", "user_a"),
      },
      body: JSON.stringify({
        baseRevision: 6,
        snapshot: { customers: [{ id: "customer_a", tenantId: "agency_a", name: "Updated A" }] },
      }),
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: "state_revision_conflict",
      scoped: true,
      revision: 7,
    });
    expect(payload.snapshot.customers.map((row: { id: string }) => row.id)).toEqual(["customer_a"]);
    expect(payload.snapshot.users.map((row: { id: string }) => row.id)).toEqual(["user_a", "user_a_2"]);
    expect(supabaseFetch.mock.calls.some((call) => (call[1]?.method ?? "GET") === "PATCH")).toBe(false);
  });

  it("uses the tenant client's matching base revision for the merged CAS write", async () => {
    const supabaseFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return jsonResponse([stateRow()]);
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        return jsonResponse([{ id: "app_state:default", ...body }]);
      }
      return jsonResponse([], 500);
    });
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateRoutes, "/default", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...authHeaders("agent", "agency_a", "user_a"),
      },
      body: JSON.stringify({
        baseRevision: 7,
        snapshot: { customers: [{ id: "customer_a", tenantId: "agency_a", name: "Updated A" }] },
      }),
    });

    expect(response.status).toBe(200);
    const patchCall = supabaseFetch.mock.calls.find((call) => (call[1]?.method ?? "GET") === "PATCH");
    expect(String(patchCall?.[0])).toContain("revision=eq.7");
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    expect(patchBody.snapshot.customers).toEqual([
      { id: "customer_a", userId: "customer_user_a", tenantId: "agency_a", name: "Updated A" },
      { id: "customer_b", userId: "customer_user_b", tenantId: "agency_b", name: "Customer B" },
    ]);
  });

  it("acknowledges an unchanged tenant snapshot without issuing a Supabase PATCH", async () => {
    const supabaseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return jsonResponse([stateRow()]);
      return jsonResponse([], 500);
    });
    installSupabaseFetch(supabaseFetch);
    const scoped = scopeStateSnapshotForAuth(stateRow().snapshot, {
      userId: "user_a",
      role: "agent",
      tenantId: "agency_a",
      permissions: [],
    }).snapshot;

    const response = await requestRoute(stateRoutes, "/default", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...authHeaders("agent", "agency_a", "user_a"),
      },
      body: JSON.stringify({
        baseRevision: 7,
        snapshot: scoped,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, unchanged: true, revision: 7 });
    expect(supabaseFetch.mock.calls.some((call) => (call[1]?.method ?? "GET") === "PATCH")).toBe(false);
  });
});

describe("state blob routes", () => {
  it("stores blobs under a tenant-owned key", async () => {
    const supabaseFetch = vi.fn(async () => new Response(null, { status: 200 }));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(stateBlobRoutes, "/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders("agent", "agency_a", "user_a"),
      },
      body: JSON.stringify({ dataUrl: "data:text/plain;base64,aGVsbG8=" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ref: string; key: string };
    expect(payload.ref).toBe(`blob:${payload.key}`);
    expect(payload.key).toMatch(/^tenant\/[a-f0-9]{32}\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.txt$/);
    expect(payload.key).not.toContain("agency_a");
  });

  it("allows same-agency staff and denies other tenants for the same blob key", async () => {
    const supabaseFetch = vi.fn(async () =>
      new Response(Buffer.from("hello"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
    installSupabaseFetch(supabaseFetch);
    const key = "tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/11111111-1111-4111-8111-111111111111.txt";

    const sameTenant = await requestRoute(stateBlobRoutes, `/${key}`, {
      headers: authHeaders("csr", "agency_a", "user_a_2"),
    });
    const otherTenant = await requestRoute(stateBlobRoutes, `/${key}`, {
      headers: authHeaders("agent", "agency_b", "user_b"),
    });

    expect(sameTenant.status).toBe(200);
    expect(await sameTenant.text()).toBe("hello");
    expect(otherTenant.status).toBe(403);
    expect(await otherTenant.json()).toEqual({ error: "forbidden" });
    expect(supabaseFetch).toHaveBeenCalledTimes(1);
  });

  it("requires authentication to read a blob", async () => {
    const supabaseFetch = vi.fn(async () => new Response(Buffer.from("secret"), { status: 200 }));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(
      stateBlobRoutes,
      "/tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/11111111-1111-4111-8111-111111111111.txt"
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it("denies customer sessions before reading a tenant blob", async () => {
    const supabaseFetch = vi.fn(async () => new Response(Buffer.from("secret"), { status: 200 }));
    installSupabaseFetch(supabaseFetch);

    const response = await requestRoute(
      stateBlobRoutes,
      "/tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/11111111-1111-4111-8111-111111111111.txt",
      { headers: authHeaders("customer", "agency_a", "customer_user_a") }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it("authenticates render-time session tokens and keeps their tenant boundary", async () => {
    const supabaseFetch = vi.fn(async () => new Response(Buffer.from("hello"), { status: 200 }));
    installSupabaseFetch(supabaseFetch);
    const agencyAToken = jwt.sign(
      { userId: "user_a", role: "agent", tenantId: "agency_a", permissions: [], authVersion: 0 },
      "state-persistence-test-secret",
      { algorithm: "HS256" }
    );
    const agencyBToken = jwt.sign(
      { userId: "user_b", role: "agent", tenantId: "agency_b", permissions: [], authVersion: 0 },
      "state-persistence-test-secret",
      { algorithm: "HS256" }
    );
    const key = "tenant/d35c52dd173c5dece653039406b089d3/2026-07-15/11111111-1111-4111-8111-111111111111.txt";

    const sameTenant = await requestRoute(stateBlobRoutes, `/${key}?access_token=${encodeURIComponent(agencyAToken)}`);
    const otherTenant = await requestRoute(stateBlobRoutes, `/${key}?access_token=${encodeURIComponent(agencyBToken)}`);

    expect(sameTenant.status).toBe(200);
    expect(otherTenant.status).toBe(403);
    expect(supabaseFetch).toHaveBeenCalledTimes(1);
  });

  it("serves a legacy key only when the authenticated tenant snapshot references it", async () => {
    const supabaseFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/rest/v1/")) return jsonResponse([stateRow()]);
      if (String(input).includes("/storage/v1/object/")) {
        return new Response(Buffer.from("legacy document"), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return jsonResponse([], 500);
    });
    installSupabaseFetch(supabaseFetch);
    const legacyKey = "2026-07-10/11111111-1111-4111-8111-111111111111.pdf";
    const path = `/${legacyKey}?state_id=default`;

    const owner = await requestRoute(stateBlobRoutes, path, {
      headers: authHeaders("agent", "agency_a", "user_a"),
    });
    const otherTenant = await requestRoute(stateBlobRoutes, path, {
      headers: authHeaders("agent", "agency_b", "user_b"),
    });
    const customer = await requestRoute(stateBlobRoutes, path, {
      headers: authHeaders("customer", "agency_a", "customer_user_a"),
    });
    vi.stubEnv("STATE_SYNC_TOKEN", "state-sync-test-token");
    const systemToken = await requestRoute(stateBlobRoutes, path, {
      headers: { "x-state-sync-token": "state-sync-test-token" },
    });

    expect(owner.status).toBe(200);
    expect(await owner.text()).toBe("legacy document");
    expect(otherTenant.status).toBe(403);
    expect(customer.status).toBe(403);
    expect(systemToken.status).toBe(403);
    expect(
      supabaseFetch.mock.calls.filter((call) => String(call[0]).includes("/rest/v1/"))
    ).toHaveLength(2);
    expect(
      supabaseFetch.mock.calls.filter((call) => String(call[0]).includes("/storage/v1/object/"))
    ).toHaveLength(1);
  });
});

function stateRow() {
  return {
    id: "app_state:default",
    revision: 7,
    updated_at: "2026-07-15T12:00:00.000Z",
    snapshot: {
      agencies: [
        { id: "agency_a", name: "Agency A" },
        { id: "agency_b", name: "Agency B" },
      ],
      users: [
        { id: "user_a", tenantId: "agency_a", role: "agent" },
        { id: "user_a_2", tenantId: "agency_a", role: "csr" },
        { id: "user_b", tenantId: "agency_b", role: "agent" },
      ],
      customers: [
        { id: "customer_a", userId: "customer_user_a", tenantId: "agency_a", name: "Customer A" },
        { id: "customer_b", userId: "customer_user_b", tenantId: "agency_b", name: "Customer B" },
      ],
      communications: [
        { id: "communication_a", tenantId: "agency_a", customerId: "customer_a", body: "A" },
        { id: "communication_b", tenantId: "agency_b", customerId: "customer_b", body: "B" },
      ],
      documents: [
        {
          id: "document_a_legacy",
          tenantId: "agency_a",
          downloadUrl: "blob:2026-07-10/11111111-1111-4111-8111-111111111111.pdf",
        },
        {
          id: "document_b_legacy",
          tenantId: "agency_b",
          downloadUrl: "blob:2026-07-10/22222222-2222-4222-8222-222222222222.pdf",
        },
      ],
      carriers: [],
      categories: [],
    },
  };
}

function authHeaders(role: string, tenantId: string, userId: string): Record<string, string> {
  return {
    "x-user-id": userId,
    "x-user-role": role,
    "x-tenant-id": tenantId,
  };
}

function installSupabaseFetch(supabaseFetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("http://127.0.0.1:")) return nativeFetch(input, init);
      return supabaseFetch(input, init);
    })
  );
}

async function requestRoute(router: Router, path: string, init?: RequestInit): Promise<Response> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/", router);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
