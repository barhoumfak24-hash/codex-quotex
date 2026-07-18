import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeRemoteState } from "../services/supabaseState.js";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Supabase state compare-and-swap", () => {
  it("does not write or advance the revision when the snapshot is unchanged", async () => {
    const current = {
      id: "app_state:default",
      snapshot: { customers: [{ id: "customer_1", name: "Alex" }] },
      revision: 12,
      updated_at: "2026-07-17T12:00:00.000Z",
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") return jsonResponse([current]);
      return jsonResponse([], 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await writeRemoteState(
      "app_state:default",
      { customers: [{ name: "Alex", id: "customer_1" }] }
    );

    expect(result).toEqual({ ok: true, row: current });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(false);
  });

  it("does not create a missing row after a numeric revision PATCH misses", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return jsonResponse([]);
      if (init?.method === "GET") return jsonResponse([]);
      return jsonResponse([], 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await writeRemoteState("app_state:default", { customers: [] }, 4);

    expect(result).toEqual({ ok: false, conflict: true, current: null });
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it("reports a concurrent first insert as a conflict instead of upserting over it", async () => {
    const racedRow = {
      id: "app_state:default",
      snapshot: { customers: [{ id: "remote" }] },
      revision: 0,
    };
    let getCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "GET") {
        getCount += 1;
        return jsonResponse(getCount === 1 ? [] : [racedRow]);
      }
      if (init?.method === "POST") return jsonResponse({ error: "duplicate" }, 409);
      return jsonResponse([], 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await writeRemoteState("app_state:default", { customers: [{ id: "local" }] }, null);

    expect(result).toEqual({ ok: false, conflict: true, current: racedRow });
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect((postCall?.[1]?.headers as Record<string, string>).Prefer).toBe("return=representation");
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
