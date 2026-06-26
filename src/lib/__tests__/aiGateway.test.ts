import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ai gateway routing", () => {
  it("routes AI requests to the direct /api mount when the app API base is nested", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api/app/api");
    const { aiApiBaseUrl } = await import("../aiGateway");
    expect(aiApiBaseUrl()).toBe("/api");
  });

  it("preserves full hostnames while removing only the app API nesting for AI routes", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://quotexinsurance.com/api/app/api");
    const { aiApiBaseUrl } = await import("../aiGateway");
    expect(aiApiBaseUrl()).toBe("https://quotexinsurance.com/api");
  });

  it("does not try a relative AI fetch from a non-browser runtime", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_API_BASE_URL", "/api/app/api");
    const { postServerAi } = await import("../aiGateway");
    const result = await postServerAi("/ai/acord-map", { fields: [] });
    expect(result).toBeNull();
  });
});
