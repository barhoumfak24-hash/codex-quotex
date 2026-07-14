import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerAiGovernor } from "../services/ai/governor.js";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  resetServerAiGovernor();
  vi.stubEnv("AI_CACHE_TTL_MS", "0");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("CODEX_AGENT_MODEL", "codex-test-model");
  vi.stubEnv("AI_PROVIDER", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetServerAiGovernor();
});

describe("Codex ACORD mapping guardrails", () => {
  it("rejects model mappings that do not match the target field semantics", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Mapped one field.",
            confidence: 0.95,
            mappings: [
              {
                targetId: "property-address",
                targetField: "Property address",
                value: "Alexandra Whitford",
                sourceLabel: "Client profile",
                sourceKind: "client_intake",
                confidence: 0.99,
                verified: true,
                rationale: "Incorrect model guess.",
              },
            ],
            missingFields: [],
            webSources: [],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "ACORD test", fileName: "ACORD-test.pdf" },
      fields: [{ id: "property-address", label: "Property address", required: true }],
      dossier: {
        client: { name: "Alexandra Whitford" },
        asset: { address: "44 Sea Breeze Ln, Palm Beach, FL 33480" },
      },
    });

    expect(result.mappings).toEqual([]);
  });

  it("keeps source-backed address mappings that match address fields", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Mapped one field.",
            confidence: 0.95,
            mappings: [
              {
                targetId: "property-address",
                targetField: "Property address",
                value: "44 Sea Breeze Ln, Palm Beach, FL 33480",
                sourceLabel: "Client asset",
                sourceKind: "client_intake",
                confidence: 0.99,
                verified: true,
                rationale: "Exact asset address.",
              },
            ],
            missingFields: [],
            webSources: [],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "ACORD test", fileName: "ACORD-test.pdf" },
      fields: [{ id: "property-address", label: "Property address", required: true }],
      dossier: {
        client: { name: "Alexandra Whitford" },
        asset: { address: "44 Sea Breeze Ln, Palm Beach, FL 33480" },
      },
    });

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toMatchObject({
      targetId: "property-address",
      targetField: "Property address",
      value: "44 Sea Breeze Ln, Palm Beach, FL 33480",
    });
  });

  it("rejects estimate-only questionnaire mappings for editable review", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Estimated fields.",
            confidence: 0.88,
            mappings: [
              {
                targetId: "year-built",
                targetField: "Year built",
                value: "2018",
                sourceLabel: "AI public-data sweep estimate",
                sourceKind: "model_estimate",
                confidence: 0.96,
                verified: false,
                rationale: "Estimate only.",
              },
            ],
            missingFields: ["Year built"],
            webSources: [],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [{ id: "year-built", label: "Year built", required: true }],
      dossier: {
        asset: { address: "44 Sea Breeze Ln, Palm Beach, FL 33480" },
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings).toEqual([]);
    expect(result.missingFields).toContain("Year built");
  });

  it("batch researches the full questionnaire and rejects wrong field types", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Mapped source-backed questionnaire fields.",
            confidence: 0.82,
            mappings: [
              {
                targetId: "property-address",
                targetField: "Property address",
                value: "Quote Tester",
                sourceLabel: "Public profile",
                sourceUrl: "https://example.com/profile",
                sourceKind: "public_web",
                confidence: 0.8,
                verified: false,
                rationale: "Incorrect name/address mismatch.",
              },
              {
                targetId: "year-built",
                targetField: "Year built",
                value: "2148",
                sourceLabel: "County assessor",
                sourceUrl: "https://example.com/assessor",
                sourceKind: "public_web",
                confidence: 0.8,
                verified: false,
                rationale: "Incorrect square-footage/year mismatch.",
              },
              {
                targetId: "square-footage",
                targetField: "Square footage",
                value: "2148",
                sourceLabel: "County assessor",
                sourceUrl: "https://example.com/assessor",
                sourceKind: "public_web",
                confidence: 0.8,
                verified: false,
                rationale: "Public assessor living area.",
              },
              {
                targetId: "occupancy",
                targetField: "Occupancy",
                value: "Owner occupied",
                sourceLabel: "QuoteX dossier",
                sourceKind: "client_intake",
                confidence: 0.88,
                verified: true,
                rationale: "Known selected personal-home category.",
              },
              {
                targetId: "roof-age",
                targetField: "Roof age",
                value: "Unknown; if original, approx. 19 years",
                sourceLabel: "Public data sweep",
                sourceKind: "model_estimate",
                confidence: 0.72,
                verified: false,
                rationale: "Useful editable estimate that still needs verification.",
              },
              {
                targetId: "estimated-exposure-value",
                targetField: "Estimated exposure value",
                value: "$1.11M-$1.33M market-value range; replacement cost needed separately",
                sourceLabel: "Public data sweep",
                sourceKind: "model_estimate",
                confidence: 0.72,
                verified: false,
                rationale: "Useful editable value range, not final replacement cost.",
              },
              {
                targetId: "loss-history",
                targetField: "Losses, claims, or incidents in the last 5 years",
                value: "None",
                sourceLabel: "General web search",
                sourceKind: "public_web",
                confidence: 0.7,
                verified: false,
                rationale: "Unsafe private underwriting answer.",
              },
              {
                targetId: "loss-history",
                targetField: "Losses, claims, or incidents in the last 5 years",
                value: "Not public; requires applicant/CLUE/loss runs",
                sourceLabel: "Public data sweep",
                sourceKind: "public_web",
                confidence: 0.55,
                verified: false,
                rationale: "Honest non-public answer for editable questionnaire review.",
              },
            ],
            missingFields: ["Year built", "Losses, claims, or incidents in the last 5 years"],
            webSources: [{ title: "County assessor", url: "https://example.com/assessor", field: "Square footage" }],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [
        { id: "property-address", label: "Property address", required: true },
        { id: "occupancy", label: "Occupancy", required: true },
        { id: "year-built", label: "Year built", required: true },
        { id: "square-footage", label: "Square footage", required: true },
        { id: "roof-age", label: "Roof age", required: true },
        { id: "estimated-exposure-value", label: "Estimated exposure value", required: true },
        { id: "loss-history", label: "Losses, claims, or incidents in the last 5 years", required: true },
      ],
      dossier: {
        client: { name: "Quote Tester" },
        asset: { address: "3901 North Nora Avenue, Chicago, IL 60634" },
      },
      intent: "questionnaire_prefill",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      tools?: unknown;
      tool_choice?: unknown;
      max_output_tokens?: unknown;
      input?: Array<{ content?: string }>;
    };
    const systemContent = String(requestBody.input?.[0]?.content ?? "");
    const userContent = String(requestBody.input?.[1]?.content ?? "");

    expect(requestBody.tools).toEqual([{ type: "web_search" }]);
    expect(requestBody.tool_choice).toBe("required");
    expect(requestBody.max_output_tokens).toBe(10_000);
    expect(systemContent).toContain("return a mapping for every exact question id");
    expect(systemContent).toContain("Return mappings as a structured array only");
    expect(systemContent).toContain("Do not put 'unknown', 'not public', 'not found'");
    expect(userContent).toContain("Full questionnaire questions");
    expect(userContent).toContain("Losses, claims, or incidents in the last 5 years");
    expect(result.mappings.map((mapping) => mapping.targetId)).toEqual([
      "square-footage",
      "occupancy",
      "property-address",
    ]);
    expect(result.mappings.some((mapping) => mapping.value === "Quote Tester")).toBe(false);
    expect(result.mappings.find((mapping) => mapping.targetId === "year-built")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "roof-age")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "estimated-exposure-value")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "loss-history")).toBeUndefined();
    expect(result.missingFields).toEqual(
      expect.arrayContaining([
        "Year built",
        "Roof age",
        "Estimated exposure value",
        "Losses, claims, or incidents in the last 5 years",
      ])
    );
  });

  it("keeps pure not-public questionnaire notes blank and required", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Mapped questionnaire answers.",
            confidence: 0.88,
            mappings: [
              {
                targetId: "roof-material",
                targetField: "Roof material",
                value: "Not public; applicant attestation needed",
                sourceLabel: "Public data sweep",
                sourceKind: "public_web",
                confidence: 0.8,
                verified: false,
                rationale: "Roof material is not reliably public for this property.",
              },
            ],
            missingFields: ["roof-material", "Roof material"],
            webSources: [],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [{ id: "roof-material", label: "Roof material", required: true }],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings).toHaveLength(0);
    expect(result.missingFields).toEqual(["Roof material"]);
  });

  it("normalizes ChatGPT-style questionnaire answers into exact editable mappings", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Public sweep answer list.",
            confidence: 0.82,
            answers: {
              "Property address": {
                answer: "901 McDonald Dr, Northville, MI 48167",
                source: "Oakland County Property Gateway",
                sourceUrl: "https://example.com/property",
                confidence: 0.86,
              },
              "Year built": {
                answer: 2007,
                source: "Oakland County property record",
                sourceUrl: "https://example.com/property",
                confidence: 0.86,
              },
              "Square footage": {
                answer: "4,100 above grade / 6,500 total listed living area; verify exact insured area",
                source: "Oakland County property record",
                sourceUrl: "https://example.com/property",
                confidence: 0.82,
              },
              "Construction type": {
                answer: "2-story contemporary; brick, stone, vinyl siding, wood siding",
                source: "Oakland County property record",
                sourceUrl: "https://example.com/property",
                confidence: 0.78,
              },
              "Roof material": {
                answer: "Likely asphalt architectural shingle - verify",
                source: "Public listing",
                sourceUrl: "https://example.com/listing",
                confidence: 0.62,
              },
              "Roof age": {
                answer: "Unknown; if original, approx. 19 years",
                source: "Public listing",
                sourceUrl: "https://example.com/listing",
                confidence: 0.58,
              },
              "Lot size": {
                answer: "0.48 acres / 20,909 sq ft",
                source: "Oakland County property record",
                sourceUrl: "https://example.com/property",
                confidence: 0.86,
              },
              "Flood zone": {
                answer: "Minimal flood risk per public risk tool; verify official FEMA zone",
                source: "FEMA flood map",
                sourceUrl: "https://example.com/fema",
                confidence: 0.72,
              },
              "Losses, claims, or incidents in the last 5 years": "None",
            },
            webSources: [{ title: "Oakland County Property Gateway", url: "https://example.com/property", field: "Year built" }],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [
        { id: "property-address", label: "Property address", required: true },
        { id: "year-built", label: "Year built", required: true },
        { id: "square-footage", label: "Square footage", required: true },
        { id: "construction-type", label: "Construction type", required: true },
        { id: "roof-material", label: "Roof material", required: true },
        { id: "roof-age", label: "Roof age", required: true },
        { id: "lot-size", label: "Lot size", required: true },
        { id: "flood-zone", label: "Flood zone", required: true },
        { id: "loss-history", label: "Losses, claims, or incidents in the last 5 years", required: true },
      ],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings.map((mapping) => mapping.targetId)).toEqual([
      "property-address",
      "year-built",
      "square-footage",
      "construction-type",
      "roof-material",
      "roof-age",
      "lot-size",
      "flood-zone",
    ]);
    expect(result.mappings.find((mapping) => mapping.targetId === "year-built")).toMatchObject({
      targetField: "Year built",
      value: "2007",
    });
    expect(result.mappings.find((mapping) => mapping.targetId === "square-footage")?.value).toContain("6,500");
    expect(result.mappings.find((mapping) => mapping.targetId === "loss-history")).toBeUndefined();
    expect(result.missingFields).toContain("Losses, claims, or incidents in the last 5 years");
  });

  it("rejects OpenAI web-researched questionnaire answers when no source URL is captured", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "OpenAI public sweep found review-only property facts.",
            confidence: 0.82,
            mappings: [
              {
                targetId: "year-built",
                targetField: "Year built",
                value: "2007",
                sourceLabel: "OpenAI public data sweep - Oakland County property record",
                sourceUrl: "",
                sourceKind: "web_search",
                confidence: 0.78,
                verified: false,
                rationale: "County assessor/property record result found during OpenAI web search; review before binding.",
              },
              {
                targetId: "square-footage",
                targetField: "Square footage",
                value: "4,100 above grade / 6,500 total listed living area",
                sourceLabel: "OpenAI public data sweep - property listing",
                sourceUrl: "",
                sourceKind: "web_search",
                confidence: 0.76,
                verified: false,
                rationale: "Public listing and property record wording found during OpenAI web search.",
              },
            ],
            missingFields: [],
            webSources: [],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [
        { id: "year-built", label: "Year built", required: true },
        { id: "square-footage", label: "Square footage", required: true },
      ],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings).toEqual([]);
    expect(result.missingFields).toEqual(["Year built", "Square footage"]);
  });

  it("reports OpenAI quota failures instead of pretending mapping succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "You exceeded your current quota.",
              type: "insufficient_quota",
              code: "insufficient_quota",
            },
          }),
          { status: 429 }
        )
      )
    );

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [
        { id: "year-built", label: "Year built", required: true },
        { id: "square-footage", label: "Square footage", required: true },
      ],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings).toEqual([]);
    expect(result.missingFields).toEqual(["Year built", "Square footage"]);
    expect(result.providerErrorCode).toBe("insufficient_quota");
    expect(result.summary).toMatch(/quota/i);
  });

  it("maps universal document fields only when the value is sourced and semantically compatible", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            detectedFields: [
              {
                id: "Text1",
                label: "Property address",
                type: "text",
                page: 0,
                rect: { x: 100, y: 120, width: 240, height: 22 },
                confidence: 0.92,
              },
            ],
            mappings: [
              {
                targetId: "Text1",
                targetField: "Property address",
                value: "901 McDonald Dr, Northville, MI 48167",
                sourceLabel: "Quotex dossier",
                sourceUrl: "",
                sourceKind: "client_intake",
                confidence: 0.92,
                verified: true,
                rationale: "Exact address in dossier.",
              },
              {
                targetId: "Text2",
                targetField: "Remarks",
                value: "Looks good",
                sourceLabel: "AI guess",
                sourceUrl: "",
                sourceKind: "model_estimate",
                confidence: 0.99,
                verified: false,
                rationale: "Should be rejected.",
              },
            ],
            missingFields: ["Remarks"],
            webSources: [],
            summary: "Mapped universal document.",
            confidence: 0.9,
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapUniversalDocumentFields } = await import("../services/ai/index.js");
    const result = await aiMapUniversalDocumentFields({
      document: { fileName: "custom-form.pdf", fileType: "application/pdf" },
      fields: [
        { id: "Text1", label: "Property address", kind: "text", page: 0, rect: { x: 100, y: 120, width: 240, height: 22 } },
        { id: "Text2", label: "Remarks", kind: "text", page: 0, rect: { x: 100, y: 160, width: 240, height: 80 } },
      ],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
    });

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0]).toMatchObject({
      targetId: "Text1",
      targetField: "Property address",
      value: "901 McDonald Dr, Northville, MI 48167",
    });
    expect(result.missingFields).toContain("Remarks");
  });
});
