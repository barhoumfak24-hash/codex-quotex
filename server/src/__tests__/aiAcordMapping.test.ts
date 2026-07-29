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

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const requestBody = JSON.parse(String(requestInit?.body)) as {
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
    expect(systemContent).toContain(
      "Never put 'unknown', 'not public', 'not found', 'likely', 'estimated'"
    );
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

  it("runs a bounded completeness audit when the first research pass leaves most questions unresolved", async () => {
    let requestNumber = 0;
    const fetchMock = vi.fn(async () => {
      requestNumber += 1;
      const response =
        requestNumber === 1
          ? {
              summary: "Initial public sweep.",
              confidence: 0.78,
              mappings: [
                {
                  targetId: "square-footage",
                  targetField: "Square footage",
                  value: "2,148",
                  sourceLabel: "County assessor",
                  sourceUrl: "https://example.com/assessor",
                  sourceKind: "public_web",
                  confidence: 0.82,
                  verified: false,
                  rationale: "Assessor living area.",
                },
              ],
              missingFields: ["Year built"],
              webSources: [
                {
                  title: "County assessor",
                  url: "https://example.com/assessor",
                  field: "Square footage",
                },
              ],
            }
          : {
              summary: "Completed unresolved public research.",
              confidence: 0.86,
              mappings: [
                {
                  targetId: "year-built",
                  targetField: "Year built",
                  value: "2007",
                  sourceLabel: "County property record",
                  sourceUrl: "https://example.com/property-record",
                  sourceKind: "public_web",
                  confidence: 0.84,
                  verified: false,
                  rationale: "Exact property record.",
                },
              ],
              missingFields: [],
              webSources: [
                {
                  title: "County property record",
                  url: "https://example.com/property-record",
                  field: "Year built",
                },
              ],
            };
      return new Response(JSON.stringify({ output_text: JSON.stringify(response) }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal questionnaire", fileName: "personal-questionnaire" },
      fields: [
        { id: "property-address", label: "Property address", required: true },
        { id: "square-footage", label: "Square footage", required: true },
        { id: "year-built", label: "Year built", required: true },
        { id: "roof-material", label: "Roof material", required: true },
        { id: "roof-year", label: "Roof year", required: true },
        { id: "construction-type", label: "Construction type", required: true },
        { id: "lot-size", label: "Lot size", required: true },
        { id: "flood-zone", label: "Flood zone", required: true },
        { id: "number-stories", label: "Number of stories", required: true },
        { id: "bedrooms", label: "Bedrooms", required: true },
        { id: "bathrooms", label: "Bathrooms", required: true },
        { id: "distance-coast", label: "Distance to coast", required: true },
      ],
      dossier: {
        asset: { address: "901 McDonald Dr, Northville, MI 48167" },
      },
      intent: "questionnaire_prefill",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondRequestInit] = fetchMock.mock.calls[1] as unknown as [unknown, RequestInit];
    const secondRequestBody = JSON.parse(String(secondRequestInit?.body)) as {
      input?: Array<{ content?: string }>;
      tools?: unknown;
      tool_choice?: unknown;
    };
    const secondUserContent = String(secondRequestBody.input?.[1]?.content ?? "");
    expect(secondRequestBody.tools).toEqual([{ type: "web_search" }]);
    expect(secondRequestBody.tool_choice).toBe("required");
    expect(secondUserContent).toContain("mandatory completeness audit");
    expect(secondUserContent).toContain("Still unresolved questionnaire questions");
    expect(secondUserContent).toContain("year-built");
    expect(secondUserContent).toContain("Already accepted answers");
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "square-footage", value: "2,148" }),
        expect.objectContaining({ targetId: "year-built", value: "2007" }),
        expect.objectContaining({
          targetId: "property-address",
          value: "901 McDonald Dr, Northville, MI 48167",
        }),
      ])
    );
    expect(result.webSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://example.com/assessor" }),
        expect.objectContaining({ url: "https://example.com/property-record" }),
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
      "construction-type",
      "lot-size",
    ]);
    expect(result.mappings.find((mapping) => mapping.targetId === "year-built")).toMatchObject({
      targetField: "Year built",
      value: "2007",
    });
    expect(result.mappings.find((mapping) => mapping.targetId === "square-footage")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "roof-material")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "roof-age")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "flood-zone")).toBeUndefined();
    expect(result.mappings.find((mapping) => mapping.targetId === "loss-history")).toBeUndefined();
    expect(result.missingFields).toEqual(
      expect.arrayContaining([
        "Square footage",
        "Roof material",
        "Roof age",
        "Flood zone",
        "Losses, claims, or incidents in the last 5 years",
      ])
    );
  });

  it("rejects uncited OpenAI research instead of presenting it as an answer", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "OpenAI public sweep found review-only property facts.",
            confidence: 0.82,
            answers: {
              "Year built": {
                answer: "2007",
                confidence: 0.78,
              },
              "Square footage": {
                answer: "4,100 above grade / 6,500 total listed living area",
                confidence: 0.76,
              },
            },
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

  it("fills every exact personal-auto fact already present in the Quotex dossier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              summary: "No additional public facts were needed.",
              confidence: 0,
              mappings: [],
              missingFields: [],
              webSources: [],
            }),
          }),
          { status: 200 }
        )
      )
    );

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal auto questionnaire", fileName: "personal-auto-questionnaire" },
      fields: [
        { id: "primaryFirstName", label: "Primary applicant first name", required: true },
        { id: "primaryLastName", label: "Primary applicant last name", required: true },
        { id: "primaryDateOfBirth", label: "Primary applicant date of birth", required: true },
        { id: "cellPhone", label: "Cell phone", required: true },
        { id: "emailAddress", label: "Email address", required: true },
        { id: "currentlyInsured", label: "Are you currently insured?", required: true, options: ["Yes", "No"] },
        { id: "currentCarrier", label: "Current carrier", required: false },
        { id: "currentPolicyNumber", label: "Current policy number", required: false },
        { id: "policyTerm", label: "Policy term", required: true, options: ["6 Months", "12 Months"] },
        { id: "driverFirstName", label: "Driver first name", required: true },
        { id: "driverLastName", label: "Driver last name", required: true },
        { id: "driverStatus", label: "Driver status", required: true, options: ["Rated", "Excluded", "Permit", "Non-driver", "Other"] },
        { id: "driverLicenseState", label: "Driver license state issued", required: true },
        { id: "driverLicenseNumber", label: "Driver license number", required: true },
        { id: "vin__asset_vehicle", label: "VIN", required: true },
        { id: "vehicleYear__asset_vehicle", label: "Vehicle year", required: true },
        { id: "vehicleMake__asset_vehicle", label: "Vehicle make", required: true },
        { id: "vehicleModel__asset_vehicle", label: "Vehicle model", required: true },
        { id: "vehicleTrim__asset_vehicle", label: "Vehicle trim", required: true },
        { id: "collisionDeductible__asset_vehicle", label: "Collision deductible", required: true },
      ],
      dossier: {
        contact: {
          name: "Abe Fakhoury",
          email: "abe@example.com",
          phone: "5172942671",
        },
        session: {
          state: "MI",
          selectedAssets: [
            {
              assetId: "vehicle",
              assetType: "luxury_vehicle",
              assetDetails: {
                vin: "1HGCM82633A004352",
                year: "2003",
                make: "Honda",
                model: "Accord",
                trim: "EX",
              },
            },
          ],
        },
        policies: [
          {
            assetId: "vehicle",
            carrierId: "carrier-chubb",
            status: "active",
            policyNumber: "AUTO-123",
            effectiveDate: "2026-01-01",
            renewalDate: "2027-01-01",
            participants: [
              {
                name: "Abe Fakhoury",
                participantType: "driver",
                status: "primary",
                assignedAssetId: "vehicle",
                dateOfBirth: "1990-01-02",
                relationship: "Self",
                licenseNumber: "F123456789",
                licenseState: "MI",
              },
            ],
            coverages: [
              { name: "Collision", deductible: "1000" },
            ],
          },
        ],
        carriers: [{ id: "carrier-chubb", name: "Chubb" }],
      },
      intent: "questionnaire_prefill",
    });

    const mapped = Object.fromEntries(
      result.mappings.map((mapping) => [mapping.targetId, mapping.value])
    );
    expect(mapped).toMatchObject({
      primaryFirstName: "Abe",
      primaryLastName: "Fakhoury",
      primaryDateOfBirth: "1990-01-02",
      cellPhone: "5172942671",
      emailAddress: "abe@example.com",
      currentlyInsured: "Yes",
      currentCarrier: "Chubb",
      currentPolicyNumber: "AUTO-123",
      policyTerm: "12 Months",
      driverFirstName: "Abe",
      driverLastName: "Fakhoury",
      driverStatus: "Rated",
      driverLicenseState: "MI",
      driverLicenseNumber: "F123456789",
      vin__asset_vehicle: "1HGCM82633A004352",
      vehicleYear__asset_vehicle: "2003",
      vehicleMake__asset_vehicle: "Honda",
      vehicleModel__asset_vehicle: "Accord",
      vehicleTrim__asset_vehicle: "EX",
      collisionDeductible__asset_vehicle: "1000",
    });
  });

  it("never leaks another selected asset's facts into a scoped questionnaire field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              summary: "No additional facts.",
              confidence: 0,
              mappings: [],
              missingFields: [],
              webSources: [],
            }),
          }),
          { status: 200 }
        )
      )
    );

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal auto questionnaire", fileName: "personal-auto-questionnaire" },
      fields: [
        { id: "vin__asset_two", label: "VIN", required: true },
        { id: "vehicleMake__asset_two", label: "Vehicle make", required: true },
        { id: "vehicleModel__asset_two", label: "Vehicle model", required: true },
        { id: "vehicleTrim__asset_two", label: "Vehicle trim", required: true },
      ],
      dossier: {
        session: {
          assetDetails: {
            vin: "1HGCM82633A004352",
            make: "Honda",
            model: "Accord",
            trim: "EX",
          },
          selectedAssets: [
            {
              assetId: "one",
              assetType: "luxury_vehicle",
              assetDetails: {
                vin: "1HGCM82633A004352",
                make: "Honda",
                model: "Accord",
                trim: "EX",
              },
            },
            {
              assetId: "two",
              assetType: "luxury_vehicle",
              assetDetails: {
                vin: "1FTFW1E50JFA00001",
                make: "Ford",
                model: "F-150",
              },
            },
          ],
        },
      },
      intent: "questionnaire_prefill",
    });

    const mapped = Object.fromEntries(
      result.mappings.map((mapping) => [mapping.targetId, mapping.value])
    );
    expect(mapped).toEqual({
      vin__asset_two: "1FTFW1E50JFA00001",
      vehicleMake__asset_two: "Ford",
      vehicleModel__asset_two: "F-150",
    });
    expect(result.missingFields).toContain("Vehicle trim");
  });

  it("does not claim current insurance from an unrelated asset policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              summary: "No additional facts.",
              confidence: 0,
              mappings: [],
              missingFields: [],
              webSources: [],
            }),
          }),
          { status: 200 }
        )
      )
    );

    const { aiMapAcordFields } = await import("../services/ai/index.js");
    const result = await aiMapAcordFields({
      template: { documentName: "Personal auto questionnaire", fileName: "personal-auto-questionnaire" },
      fields: [
        {
          id: "currentlyInsured__asset_asset-two",
          label: "Are you currently insured?",
          required: true,
          options: ["Yes", "No"],
        },
        {
          id: "currentPolicyNumber__asset_asset-two",
          label: "Current policy number",
          required: false,
        },
      ],
      dossier: {
        session: {
          selectedAssets: [
            {
              assetId: "asset-two",
              assetType: "luxury_vehicle",
              assetDetails: { vin: "1FTFW1E50JFA00001" },
            },
          ],
        },
        policies: [
          {
            assetId: "asset-one",
            status: "active",
            policyNumber: "WRONG-ASSET-POLICY",
          },
        ],
      },
      intent: "questionnaire_prefill",
    });

    expect(result.mappings).toEqual([]);
    expect(result.missingFields).toContain("Are you currently insured?");
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

  it("uses model-detected universal fields that were not supplied by the caller", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            detectedFields: [
              {
                id: "DetectedAddress1",
                label: "Property address",
                type: "text",
                page: 1,
                rect: { x: 80, y: 140, width: 260, height: 24 },
                confidence: 0.94,
              },
            ],
            mappings: [
              {
                targetId: "DetectedAddress1",
                targetField: "Property address",
                value: "901 McDonald Dr, Northville, MI 48167",
                sourceLabel: "Quotex dossier",
                sourceUrl: "",
                sourceKind: "client_intake",
                confidence: 0.93,
                verified: true,
                rationale: "Exact address in dossier.",
              },
            ],
            missingFields: [],
            webSources: [],
            summary: "Detected and mapped one field.",
            confidence: 0.93,
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiMapUniversalDocumentFields } = await import("../services/ai/index.js");
    const result = await aiMapUniversalDocumentFields({
      document: { fileName: "unflattened-form.pdf", fileType: "application/pdf" },
      fields: [],
      dossier: { asset: { address: "901 McDonald Dr, Northville, MI 48167" } },
      attachments: [
        {
          fileName: "unflattened-form.pdf",
          mimeType: "application/pdf",
          dataUrl: "data:application/pdf;base64,Zm9ybQ==",
        },
      ],
    });

    expect(result.detectedFields).toEqual([
      expect.objectContaining({
        id: "DetectedAddress1",
        label: "Property address",
        page: 1,
        confidence: 0.94,
      }),
    ]);
    expect(result.mappings).toEqual([
      expect.objectContaining({
        targetId: "DetectedAddress1",
        targetField: "Property address",
        value: "901 McDonald Dr, Northville, MI 48167",
      }),
    ]);
  });

  it("returns no policy facts when no readable document evidence is supplied", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { aiExtractPolicyFromFile } = await import("../services/ai/index.js");
    const result = await aiExtractPolicyFromFile({
      fileName: "Chubb-Dec-Page.pdf",
      fileType: "application/pdf",
      carrierNames: ["Chubb"],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      policyNumber: "",
      confidence: 0,
    });
    expect(result.carrierName).toBeUndefined();
    expect(result.finalPremium).toBeUndefined();
    expect(result.effectiveDate).toBeUndefined();
  });

  it("keeps only policy values with matching field-level document evidence", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            policyNumber: "CH-12345",
            carrierName: "Chubb",
            premiumEstimate: 99_999,
            finalPremium: 1_250,
            effectiveDate: "2026-01-01",
            renewalDate: "2027-01-01",
            assetHint: "Coastal home",
            summary: "Model summary is not trusted as evidence.",
            confidence: 0.96,
            sources: ["Model assertion"],
            fieldEvidence: [
              {
                fieldKey: "policyNumber",
                value: "CH-12345",
                sourceKind: "document_text",
                evidence: "Policy Number: CH-12345",
                confidence: 0.96,
              },
              {
                fieldKey: "carrierName",
                value: "Chubb",
                sourceKind: "document_text",
                evidence: "Carrier: Chubb",
                confidence: 0.95,
              },
              {
                fieldKey: "premiumEstimate",
                value: "99999",
                sourceKind: "document_text",
                evidence: "Estimated premium: $99,999",
                confidence: 0.99,
              },
              {
                fieldKey: "finalPremium",
                value: "$1,250",
                sourceKind: "document_text",
                evidence: "Annual Premium: $1,250",
                confidence: 0.94,
              },
              {
                fieldKey: "effectiveDate",
                value: "01/01/2026",
                sourceKind: "document_text",
                evidence: "Effective Date: 01/01/2026",
                confidence: 0.93,
              },
            ],
          }),
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiExtractPolicyFromFile } = await import("../services/ai/index.js");
    const result = await aiExtractPolicyFromFile({
      fileName: "declarations.pdf",
      fileType: "application/pdf",
      text: [
        "Carrier: Chubb",
        "Policy Number: CH-12345",
        "Annual Premium: $1,250",
        "Effective Date: 01/01/2026",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      policyNumber: "CH-12345",
      carrierName: "Chubb",
      finalPremium: 1_250,
      effectiveDate: "2026-01-01",
    });
    expect(result.premiumEstimate).toBeUndefined();
    expect(result.renewalDate).toBeUndefined();
    expect(result.assetHint).toBeUndefined();
    expect(result.sources).not.toContain("Model assertion");
  });

  it("does not use browser-exposed VITE Google keys on the server", async () => {
    vi.stubEnv("GOOGLE_GEOCODING_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "browser-key");
    vi.stubEnv("VITE_GOOGLE_PLACES_API_KEY", "browser-places-key");
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("maps.googleapis.com")) {
        throw new Error("Browser-exposed Google key reached a server request.");
      }
      if (url.includes("geocoding.geo.census.gov")) {
        return new Response(JSON.stringify({ result: { addressMatches: [] } }), { status: 200 });
      }
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              fieldEntries: [],
              unavailableFields: [],
              sources: [],
              notes: "No source-backed public fields found.",
            }),
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { aiEnrichAsset } = await import("../services/ai/index.js");
    await aiEnrichAsset({
      assetType: "coastal_home",
      seed: { address: "901 McDonald Dr, Northville, MI 48167" },
    });

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("maps.googleapis.com"))).toBe(false);
    expect(urls.some((url) => url.includes("geocoding.geo.census.gov"))).toBe(true);
  });

  it("keeps visible pool, trampoline, and roof observations advisory with honest image dates", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-maps-key");
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/streetview/metadata")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            date: "2024-05",
            location: { lat: 42.4, lng: -83.5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("maps.googleapis.com/maps/api/streetview") || url.includes("/staticmap")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (url.includes("api.openai.com")) {
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              findings: [
                {
                  feature: "pool",
                  value: "Rectangular in-ground pool visible in rear yard",
                  confidence: 0.91,
                  sourceImage: "aerial",
                  captureDate: "2099-01",
                  notDeterminable: false,
                  rationale: "Clearly visible water-filled rectangle.",
                },
                {
                  feature: "roof covering",
                  value: "Dark segmented roof covering visible",
                  confidence: 0.78,
                  sourceImage: "aerial",
                  captureDate: "2099-01",
                  notDeterminable: false,
                  rationale: "Visible from above; material is not confirmed.",
                },
                {
                  feature: "trampoline",
                  value: "Round trampoline visible beside the house",
                  confidence: 0.88,
                  sourceImage: "ground",
                  captureDate: "2099-01",
                  notDeterminable: false,
                  rationale: "Visible at the side of the property.",
                },
              ],
              summary: "Advisory visible observations only.",
            }),
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { aiAnalyzePropertyImagery } = await import("../services/ai/index.js");
    const result = await aiAnalyzePropertyImagery({
      address: "901 McDonald Dr, Northville, MI 48167",
      lat: 42.4,
      lon: -83.5,
      displayName: "901 McDonald Dr, Northville, MI 48167",
      provider: "google",
    });

    const findings = result.fields.imageryFindings as Array<{
      feature: string;
      sourceImage: string;
      captureDate: string;
      confidence: number;
    }>;
    expect(findings.find((finding) => finding.feature === "pool")?.captureDate).toBe("");
    expect(findings.find((finding) => finding.feature === "pool")?.confidence).toBe(0.75);
    expect(findings.find((finding) => finding.feature === "trampoline")?.captureDate).toBe("2024-05");
    expect(result.fields.detachedStructuresAndRecreation).toBeUndefined();
    expect(result.evidence?.["imagery.pool"]).toMatchObject({
      sourceKind: "imagery_vision",
      verified: false,
      allowDocumentAutofill: false,
    });
    expect(result.evidence?.["imagery.pool"].observedDate).toBeUndefined();
    expect(result.evidence?.["imagery.trampoline"].observedDate).toBe("2024-05");

    const openAiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("api.openai.com"));
    const requestBody = JSON.parse(String(openAiCall?.[1]?.body)) as { input?: Array<{ content?: unknown }> };
    const prompt = JSON.stringify(requestBody.input?.[1]?.content ?? "");
    expect(prompt).toContain("visible pools or trampolines");
    expect(prompt).toContain("Never invent a date");
  });
});
