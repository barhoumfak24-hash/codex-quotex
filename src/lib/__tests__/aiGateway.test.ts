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

  it("treats quoted local env values the same as unquoted values", async () => {
    vi.stubEnv("VITE_AI_MODE", '"server"');
    vi.stubEnv("VITE_API_BASE_URL", '"/api/app/api"');
    const { aiApiBaseUrl, serverAiEnabled } = await import("../aiGateway");
    expect(serverAiEnabled()).toBe(true);
    expect(aiApiBaseUrl()).toBe("/api");
  });

  it("lets required server AI calls reach the server in local demo builds", async () => {
    vi.stubEnv("VITE_AI_MODE", "");
    vi.stubEnv("VITE_API_BASE_URL", "https://quotexinsurance.test/api/app/api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const { postServerAi, serverAiEnabled } = await import("../aiGateway");
    expect(serverAiEnabled()).toBe(true);
    await expect(postServerAi("/ai/acord-map", { fields: [] }, { requireServer: true })).resolves.toEqual({
      ok: true,
    });
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

  it("throws instead of silently skipping when a caller explicitly disables server AI", async () => {
    vi.stubEnv("VITE_AI_MODE", "off");
    const { postServerAi } = await import("../aiGateway");
    await expect(
      postServerAi("/ai/acord-map", { fields: [] }, { requireServer: true })
    ).rejects.toMatchObject({
      name: "AiGatewayUnavailableError",
      detail: { error: "server_ai_disabled" },
    });
  });

  it("requires server AI by default in production builds", async () => {
    vi.stubEnv("PROD", true);
    const { browserAiFallbacksAllowed, serverAiEnabled } = await import("../aiGateway");
    expect(serverAiEnabled()).toBe(true);
    expect(browserAiFallbacksAllowed()).toBe(false);
  });

  it("keeps browser fallbacks disabled in production even when the fallback flag is set", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_ALLOW_BROWSER_AI_FALLBACKS", "true");
    const { browserAiFallbacksAllowed, serverAiEnabled } = await import("../aiGateway");
    expect(serverAiEnabled()).toBe(true);
    expect(browserAiFallbacksAllowed()).toBe(false);
  });

  it("does not hide AI gateway failures behind local fallbacks in production", async () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "provider_unavailable" }), { status: 503 }))
    );
    const { postServerAi } = await import("../aiGateway");
    await expect(postServerAi("/ai/acord-map", { fields: [] })).rejects.toMatchObject({
      name: "AiGatewayUnavailableError",
    });
  });

  it("normalizes Vercel function timeout details before reporting them to callers", async () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            message:
              "An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT cle1::9vmpk-1783025119970-cd8433426528",
            error: "FUNCTION_INVOCATION_TIMEOUT",
          }),
          { status: 504, headers: { "content-type": "application/json" } }
        )
      )
    );
    const { postServerAi } = await import("../aiGateway");
    await expect(postServerAi("/ai/acord-map", { fields: [] })).rejects.toMatchObject({
      name: "AiGatewayUnavailableError",
      detail: {
        status: 504,
        message:
          "AI mapping is taking longer than expected. Any unanswered fields will stay blank for review.",
        error: "timeout",
      },
    });
  });
});

describe("client AI mapping guardrails", () => {
  it("rejects uncited public-web questionnaire mappings before they reach form state", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_API_BASE_URL", "https://quotexinsurance.test/api/app/api");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            mappings: [
              {
                targetId: "year-built",
                targetField: "Year built",
                value: "2007",
                sourceLabel: "OpenAI public data sweep",
                sourceKind: "web_search",
                confidence: 0.88,
                verified: true,
                rationale: "No citation URL was supplied.",
              },
            ],
            missingFields: [],
            webSources: [],
            summary: "Returned one uncited mapping.",
            confidence: 0.88,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const { aiMapAcordFields } = await import("../ai");
    const mapped = await aiMapAcordFields({
      tenantId: "agency_test",
      template: { documentName: "Personal questionnaire" },
      fields: [{ id: "year-built", label: "Year built", required: true }],
      dossier: { session: { publicFields: {} } },
      intent: "questionnaire_prefill",
    });

    expect(mapped.mappings).toEqual([]);
    expect(mapped.fields).toEqual({});
    expect(mapped.publicFieldEvidence).toEqual({});
  });
});
