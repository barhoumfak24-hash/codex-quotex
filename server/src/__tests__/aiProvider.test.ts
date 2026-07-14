import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerAiGovernor } from "../services/ai/governor.js";

describe("server AI provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resetServerAiGovernor();
    vi.stubEnv("AI_CACHE_TTL_MS", "0");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("AI_PROVIDER", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetServerAiGovernor();
  });

  it("uses OpenAI automatically when only OPENAI_API_KEY is configured", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await import("../services/ai/provider.js");
    const result = await provider.completeJson<{ ok: boolean }>({
      system: "Return JSON.",
      user: "Return {\"ok\":true}.",
      schemaName: "provider_default_test",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  });

  it("fails closed when no server-side OpenAI key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await import("../services/ai/provider.js");
    await expect(
      provider.completeJson({
        system: "Return JSON.",
        user: "Return {\"ok\":true}.",
      })
    ).rejects.toThrow(/OPENAI_API_KEY is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-OpenAI provider configuration", async () => {
    vi.stubEnv("AI_PROVIDER", "stub");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await import("../services/ai/provider.js");
    await expect(
      provider.completeJson({
        system: "Return JSON.",
        user: "Return {\"ok\":true}.",
      })
    ).rejects.toThrow(/Quotex AI is OpenAI-only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes forced web-search tool choice to OpenAI", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { provider } = await import("../services/ai/provider.js");
    await provider.completeJson({
      system: "Return JSON.",
      user: "Search then return JSON.",
      schemaName: "provider_web_search_test",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      tools: [{ type: "web_search" }],
      toolChoice: "required",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      tools?: unknown;
      tool_choice?: unknown;
    };
    expect(requestBody.tools).toEqual([{ type: "web_search" }]);
    expect(requestBody.tool_choice).toBe("required");
  });
});
