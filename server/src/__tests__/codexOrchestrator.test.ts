import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerAiGovernor } from "../services/ai/governor.js";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  resetServerAiGovernor();
  vi.stubEnv("AI_CACHE_TTL_MS", "0");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("CODEX_AGENT_MODEL", "gpt-4o-mini");
  vi.stubEnv("AI_PROVIDER", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetServerAiGovernor();
});

describe("Codex orchestrator", () => {
  it("wraps AI calls with Codex specialist instructions and the configured Codex model", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { codexAgentCompleteJson } = await import("../services/ai/codexOrchestrator.js");
    const result = await codexAgentCompleteJson<{ ok: boolean }>({
      task: "portal_assistant",
      agent: "portal_assistant",
      system: "Return ok true.",
      user: "Return ok true.",
      schemaName: "orchestrator_test",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });

    expect(result).toEqual({ ok: true });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      model?: string;
      input?: Array<{ role: string; content: string }>;
      reasoning?: { effort?: string };
      text?: { format?: { name?: string } };
    };
    expect(requestBody.model).toBe("gpt-4o-mini");
    expect(requestBody.reasoning).toBeUndefined();
    expect(requestBody.text?.format?.name?.length).toBeLessThanOrEqual(64);
    expect(requestBody.input?.[0]?.content).toContain("server-side Codex Orchestrator");
    expect(requestBody.input?.[0]?.content).toContain("Dedicated agent: Portal Assistant Agent");
    expect(requestBody.input?.[0]?.content).toContain("Evidence auditor");
  });

  it("shortens long schema names before sending structured output requests to OpenAI", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { codexAgentCompleteJson } = await import("../services/ai/codexOrchestrator.js");
    await codexAgentCompleteJson<{ ok: boolean }>({
      task: "public_data_sweep",
      agent: "questionnaire_public_sweep",
      system: "Return ok true.",
      user: "Return ok true.",
      schemaName: "acord_field_mapping_with_questionnaire_prefill_full_public_sweep",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      text?: { format?: { name?: string } };
    };
    expect(requestBody.text?.format?.name).toMatch(/^codex_questionnaire_public_sweep_public_data_sweep_/);
    expect(requestBody.text?.format?.name?.length).toBeLessThanOrEqual(64);
  });

  it("does not let a generic fast OPENAI_MODEL downgrade maximum-reasoning Codex agents", async () => {
    vi.stubEnv("CODEX_AGENT_MODEL", "");
    vi.stubEnv("OPENAI_CODEX_MODEL", "");
    vi.stubEnv("OPENAI_MAX_REASONING_MODEL", "");
    vi.stubEnv("AI_REASONING_MODEL", "");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { codexAgentCompleteJson } = await import("../services/ai/codexOrchestrator.js");
    await codexAgentCompleteJson<{ ok: boolean }>({
      task: "public_data_sweep",
      agent: "questionnaire_public_sweep",
      system: "Return ok true.",
      user: "Return ok true.",
      schemaName: "maximum_route_test",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      quality: "maximum",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model?: string };
    expect(requestBody.model).toBe("gpt-5");
  });
});
