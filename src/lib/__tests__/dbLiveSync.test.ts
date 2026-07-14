// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function dbStorageKey(): string {
  const key = Object.keys(window.localStorage).find((name) => /^quotex\.db\.v\d+$/.test(name));
  if (!key) throw new Error("Expected Quotex db storage key");
  return key;
}

function wait(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fetchMethod(call: unknown[]) {
  return String((call[1] as RequestInit | undefined)?.method ?? "GET");
}

describe("db live sync", () => {
  it("migrates the latest legacy local DB without dropping client records", async () => {
    const { SEED_CUSTOMERS } = await import("../seed");
    const preservedCustomer = {
      ...SEED_CUSTOMERS[0],
      id: "customer_refresh_preserved",
      name: "Refresh Preserved",
      email: "refresh-preserved@example.com",
    };

    window.localStorage.setItem(
      "quotex.db.v30",
      JSON.stringify({ customers: [preservedCustomer] })
    );

    vi.resetModules();
    const { db } = await import("../db");

    expect(db.snapshot().customers.some((customer) => customer.id === preservedCustomer.id)).toBe(
      true
    );
    expect(window.localStorage.getItem("quotex.db.v30")).toBeNull();
    expect(dbStorageKey()).toMatch(/^quotex\.db\.v\d+$/);
  });

  it("migrates v31 into v32 instead of reseeding or deleting live rows", async () => {
    const { SEED_CUSTOMERS } = await import("../seed");
    const preservedCustomer = {
      ...SEED_CUSTOMERS[0],
      id: "customer_v31_preserved",
      name: "V31 Preserved",
      email: "v31-preserved@example.com",
    };

    window.localStorage.setItem("quotex.db.v31", JSON.stringify({ customers: [preservedCustomer] }));

    vi.resetModules();
    const { db } = await import("../db");

    expect(db.snapshot().customers.some((customer) => customer.id === preservedCustomer.id)).toBe(
      true
    );
    expect(window.localStorage.getItem("quotex.db.v31")).toBeNull();
    expect(dbStorageKey()).toBe("quotex.db.v32");
  });

  it("restores client records from the safety snapshot if the main cache is missing", async () => {
    const { db } = await import("../db");
    db.reset();
    const preservedCustomer = {
      ...db.snapshot().customers[0],
      id: "customer_safety_snapshot",
      name: "Safety Snapshot Client",
      email: "snapshot@example.com",
    };
    db.insert("customers", preservedCustomer);

    const storageKey = dbStorageKey();
    const criticalKey = `${storageKey}.critical`;
    expect(window.localStorage.getItem(criticalKey)).toContain(preservedCustomer.id);

    window.localStorage.removeItem(storageKey);
    vi.resetModules();
    const { db: reloadedDb } = await import("../db");

    expect(
      reloadedDb.snapshot().customers.some((customer) => customer.id === preservedCustomer.id)
    ).toBe(true);
  });

  it("merges remote live-state hydration instead of replacing local client data", async () => {
    const { SEED_CUSTOMERS } = await import("../seed");
    const preservedCustomer = {
      ...SEED_CUSTOMERS[0],
      id: "customer_remote_merge_preserved",
      name: "Remote Merge Preserved",
      email: "remote-merge@example.com",
    };

    window.localStorage.setItem(
      "quotex.db.v30",
      JSON.stringify({ customers: [preservedCustomer] })
    );
    vi.stubEnv("VITE_STATE_SYNC_MODE", "supabase");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          found: true,
          snapshot: { customers: [SEED_CUSTOMERS[0]] },
        }),
      }))
    );

    vi.resetModules();
    const { db } = await import("../db");
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(db.snapshot().customers.some((customer) => customer.id === preservedCustomer.id)).toBe(
      true
    );
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  });

  it("does not PUT local or seed data before a successful cloud hydrate", async () => {
    vi.stubEnv("VITE_STATE_SYNC_MODE", "supabase");
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { db } = await import("../db");
    db.insert("customers", {
      ...db.snapshot().customers[0],
      id: "customer_queued_until_hydrate",
      name: "Queued Until Hydrate",
      email: "queued@example.com",
    });

    await wait(500);

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every((call) => fetchMethod(call) !== "PUT")).toBe(true);
    expect(db.syncStatus()).toMatchObject({ status: "saving" });
  });

  it("retries cloud writes after a revision conflict and keeps both rows", async () => {
    const { SEED_CUSTOMERS } = await import("../seed");
    const remoteCustomer = {
      ...SEED_CUSTOMERS[0],
      id: "customer_remote_conflict_survives",
      name: "Remote Conflict Survives",
      email: "remote-conflict@example.com",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    vi.stubEnv("VITE_STATE_SYNC_MODE", "supabase");
    let conflictReturned = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: true,
          json: async () => ({ found: true, revision: 1, snapshot: { customers: [SEED_CUSTOMERS[0]] } }),
        };
      }
      const body = JSON.parse(String(init?.body));
      if (!conflictReturned) {
        conflictReturned = true;
        return {
          ok: false,
          status: 409,
          json: async () => ({
            ok: false,
            revision: 2,
            snapshot: { customers: [remoteCustomer] },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          revision: 3,
          snapshot: body.snapshot,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { db } = await import("../db");
    await wait(250);
    fetchMock.mockClear();
    conflictReturned = false;
    db.insert("customers", {
      ...SEED_CUSTOMERS[0],
      id: "customer_local_conflict_survives",
      name: "Local Conflict Survives",
      email: "local-conflict@example.com",
    });

    await wait(650);

    expect(db.snapshot().customers.some((customer) => customer.id === remoteCustomer.id)).toBe(true);
    expect(
      db.snapshot().customers.some((customer) => customer.id === "customer_local_conflict_survives")
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter((call) => fetchMethod(call) === "PUT")
    ).toHaveLength(2);
    expect(db.syncStatus()).toMatchObject({ status: "synced" });
  });

  it("adds updatedAt centrally and tombstones deleted rows", async () => {
    const { db } = await import("../db");
    db.reset();
    const customer = {
      ...db.snapshot().customers[0],
      id: "customer_timestamp_tombstone",
      name: "Timestamp Tombstone",
      email: "timestamp@example.com",
    };
    db.insert("customers", customer);
    const inserted = db.snapshot().customers.find((row) => row.id === customer.id);
    expect(inserted).toHaveProperty("createdAt");
    expect(inserted).toHaveProperty("updatedAt");

    const updated = db.update("customers", customer.id, { name: "Timestamp Updated" });
    expect(updated).toMatchObject({ name: "Timestamp Updated" });
    expect((updated as typeof updated & { updatedAt?: string })?.updatedAt).toBeTruthy();

    expect(db.remove("customers", customer.id)).toBe(true);
    expect(db.snapshot().deletedRows).toContainEqual(
      expect.objectContaining({ id: `customers:${customer.id}`, table: "customers", rowId: customer.id })
    );
  });

  it("does not expose localStorage quota failures as cloud-save errors", async () => {
    const { db } = await import("../db");
    const originalSetItem = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (/^quotex\.db\.v\d+$/.test(key)) throw new DOMException("full", "QuotaExceededError");
        return Reflect.apply(originalSetItem, window.localStorage, [key, value]);
      });

    db.insert("customers", {
      ...db.snapshot().customers[0],
      id: "customer_quota_visible",
      name: "Quota Visible",
      email: "quota@example.com",
    });

    expect(db.syncStatus()).toMatchObject({ status: "local-only", reason: "local_quota" });
    spy.mockRestore();
  });

  it("does not PUT oversized inline document bytes into the cloud snapshot", async () => {
    vi.stubEnv("VITE_STATE_SYNC_MODE", "supabase");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: true,
          json: async () => ({ found: true, revision: 1, snapshot: {} }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, revision: 2, snapshot: {} }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { db } = await import("../db");
    await wait(250);
    fetchMock.mockClear();
    db.insert("documents", {
      id: "document_huge_data_url",
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      name: "Huge.pdf",
      type: "ACORD",
      status: "complete",
      downloadUrl: `data:application/pdf;base64,${"A".repeat(3_000_000)}`,
      createdAt: new Date().toISOString(),
    } as never);

    await wait(850);

    const stateWrites = fetchMock.mock.calls.filter(
      (call) => fetchMethod(call) === "PUT" && String(call[0]).includes("/state/")
    );
    expect(
      stateWrites.some((call) =>
        String((call[1] as RequestInit | undefined)?.body ?? "").includes("data:application/pdf")
      )
    ).toBe(false);
    expect(db.syncStatus().message ?? "").not.toMatch(/data:application\/pdf|local_quota|Browser storage/i);
  });

  it("moves oversized document bytes to state blobs before writing the cloud snapshot", async () => {
    vi.stubEnv("VITE_STATE_SYNC_MODE", "supabase");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: true,
          json: async () => ({ found: true, revision: 1, snapshot: {} }),
        };
      }
      if (String(url).includes("/state-blobs")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            ref: "blob:2026-07-10/document_huge_data_url.pdf",
          }),
        };
      }
      const body = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, revision: 2, snapshot: body.snapshot }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { db } = await import("../db");
    await wait(250);
    fetchMock.mockClear();
    db.insert("documents", {
      id: "document_blob_migrated",
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      name: "Huge migrated.pdf",
      type: "ACORD",
      status: "complete",
      downloadUrl: `data:application/pdf;base64,${"A".repeat(150_000)}`,
      createdAt: new Date().toISOString(),
    } as never);

    await db.syncNow();

    const blobPosts = fetchMock.mock.calls.filter(
      (call) => fetchMethod(call) === "POST" && String(call[0]).includes("/state-blobs")
    );
    const puts = fetchMock.mock.calls.filter((call) => fetchMethod(call) === "PUT");
    expect(blobPosts).toHaveLength(1);
    expect(puts).toHaveLength(1);
    const putBody = JSON.parse(String(puts[0][1]?.body));
    const persistedDocument = putBody.snapshot.documents.find(
      (document: { id: string }) => document.id === "document_blob_migrated"
    );
    expect(persistedDocument.downloadUrl).toBe("blob:2026-07-10/document_huge_data_url.pdf");
    expect(JSON.stringify(putBody)).not.toContain("data:application/pdf;base64");
    expect(db.syncStatus()).toMatchObject({ status: "synced" });
  });

  it("ingests localStorage changes from another tab and notifies subscribers", async () => {
    const { db, subscribeToDbChanges } = await import("../db");
    db.reset();
    const key = dbStorageKey();
    const next = structuredClone(db.snapshot());
    next.customers[0] = {
      ...next.customers[0],
      name: "Live Sync Customer",
    };

    let ticks = 0;
    const unsubscribe = subscribeToDbChanges(() => {
      ticks += 1;
    });

    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: JSON.stringify(next),
      })
    );

    unsubscribe();
    expect(db.snapshot().customers[0].name).toBe("Live Sync Customer");
    expect(ticks).toBeGreaterThan(0);
  });
});
