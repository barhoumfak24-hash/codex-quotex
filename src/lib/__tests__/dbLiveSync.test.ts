// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

function dbStorageKey(): string {
  const key = Object.keys(window.localStorage).find((name) => name.startsWith("quotex.db."));
  if (!key) throw new Error("Expected Quotex db storage key");
  return key;
}

describe("db live sync", () => {
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
