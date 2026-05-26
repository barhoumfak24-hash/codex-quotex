// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// Smarty browser-side helper tests.
//
// The helper hits our own /api/smarty-validate proxy (not Smarty
// directly — the Auth Token is server-only). These mock the fetch
// response shape the proxy returns: `{ result: SmartyValidatedAddress
// | null, cached?: boolean }`.
// =====================================================================

const SMARTY_RESULT = {
  deliverable: true,
  dpvCode: "Y",
  standardized: {
    street: "901 McDonald Dr",
    apt: "",
    city: "Northville",
    state: "MI",
    zip: "48167",
    zip4: "2241",
  },
  lat: 42.4314,
  lon: -83.483,
  county: "Wayne",
  timezone: "Eastern",
  rdi: "Residential",
  composed: "901 McDonald Dr, Northville, MI 48167-2241",
  cached: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  // jsdom provides sessionStorage; just clear it between tests.
  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.clear();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("validateAddress (browser-side helper)", () => {
  it("POSTs to /api/smarty-validate with the freeform payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: SMARTY_RESULT }),
    });
    const { validateAddress } = await import("../smartyValidation");
    const out = await validateAddress("901 McDonald Drive, Northville, MI 48167");
    expect(out).toEqual({ ...SMARTY_RESULT, cached: false });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe("/api/smarty-validate");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ freeform: "901 McDonald Drive, Northville, MI 48167" });
  });

  it("returns null when the helper receives 404 (proxy not deployed)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const { validateAddress } = await import("../smartyValidation");
    const out = await validateAddress("anything");
    expect(out).toBeNull();
  });

  it("returns null when Smarty has no candidates", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: null }),
    });
    const { validateAddress } = await import("../smartyValidation");
    const out = await validateAddress("asdf asdf");
    expect(out).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Failed to fetch"));
    const { validateAddress } = await import("../smartyValidation");
    const out = await validateAddress("901 McDonald");
    expect(out).toBeNull();
  });

  it("returns null on HTTP 429 (rate limit) without throwing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({}),
    });
    const { validateAddress } = await import("../smartyValidation");
    const out = await validateAddress("901 McDonald");
    expect(out).toBeNull();
  });

  it("caches a successful result in sessionStorage so a second call skips the network", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: SMARTY_RESULT }),
    });
    const { validateAddress } = await import("../smartyValidation");
    await validateAddress("901 McDonald Drive, Northville, MI 48167");
    const second = await validateAddress("901 McDonald Drive, Northville, MI 48167");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(second?.cached).toBe(true);
  });

  it("caches a null (not-found) result so we don't re-query unknown addresses", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: null }),
    });
    const { validateAddress } = await import("../smartyValidation");
    await validateAddress("asdf asdf");
    await validateAddress("asdf asdf");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("normalizes whitespace + case for cache key", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: SMARTY_RESULT }),
    });
    const { validateAddress } = await import("../smartyValidation");
    await validateAddress("901 McDonald");
    await validateAddress("  901  mcdonald  ");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});