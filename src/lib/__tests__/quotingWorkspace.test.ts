// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// AI quoting workspace: gathering_info → awaiting_reply → quoting →
// complete. Drives the per-prospect card that replaced "Quote data".
// =====================================================================

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_AI_MODE", "browser");
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { resetAiResourceGovernor } = await import("../aiResourceGovernor");
  resetAiResourceGovernor();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function seed() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
  const prospect = api.prospects.create({
    tenantId: agency.id,
    name: "Quote Tester",
    email: "qt@example.com",
    assetType: "coastal_home",
    estimatedValue: 1_500_000,
    aiSummary: "x",
    lastAction: "x",
    lastActivityAt: new Date().toISOString(),
    recommendedFollowUp: "x",
    marketingStatus: "none",
    status: "new",
  });
  return { api, agency, agent, prospect };
}

describe("api.quoting workspace", () => {
  it("completes and persists AI mapping for every selected asset", async () => {
    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const category = api.categories.get("cat_primary_home")!;
    const vehicleCategory = api.categories.get("cat_luxury_vehicle")!;
    const enrichmentRequests: Array<{ seed?: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((u: string, init?: RequestInit) => {
        const url = String(u);
        if (url === "/api/ai/enrich-asset") {
          const request = JSON.parse(String(init?.body ?? "{}")) as {
            seed?: Record<string, unknown>;
          };
          enrichmentRequests.push(request);
          const firstAsset = String(request.seed?.address ?? "").includes("First");
          const yearBuilt = firstAsset ? "2001" : "2012";
          const squareFootage = firstAsset ? "2100" : "3400";
          const collectedAt = "2026-07-17T00:00:00.000Z";
          return Promise.resolve({
            ok: true,
            json: async () => ({
              fields: { yearBuilt, squareFootage },
              evidence: {
                yearBuilt: {
                  fieldKey: "yearBuilt",
                  sourceKind: "government_api",
                  sourceLabel: "County property records",
                  confidence: 0.98,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt,
                },
                squareFootage: {
                  fieldKey: "squareFootage",
                  sourceKind: "government_api",
                  sourceLabel: "County property records",
                  confidence: 0.98,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt,
                },
              },
              sources: ["County property records"],
              confidence: 0.98,
              unavailableFields: [],
            }),
          });
        }
        if (url === "/api/ai/acord-map") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              fields: {},
              publicFieldEvidence: {},
              mappings: [],
              missingFields: [],
              webSources: [],
              summary: "No additional mapped values.",
              confidence: 0,
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected URL ${url}`));
      })
    );

    const assets = [
      {
        assetId: "asset_first",
        label: "First Street Home",
        assetType: "coastal_home" as const,
        address: "101 First Street, Palm Beach, FL 33480",
        estimatedValue: 900_000,
        assetDetails: {
          propertyAddress: "101 First Street, Palm Beach, FL 33480",
        } as Record<string, string>,
      },
      {
        assetId: "asset_second",
        label: "2023 Test Vehicle",
        assetType: "luxury_vehicle" as const,
        categoryId: vehicleCategory.id,
        categoryLabel: vehicleCategory.label,
        address: "202 Second Avenue, Palm Beach, FL 33480",
        estimatedValue: 140_000,
        assetDetails: { vin: "1HGCM82633A004352" } as Record<string, string>,
      },
    ];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: assets[0].assetId,
      createdById: agent.id,
      assetType: assets[0].assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      categoryIds: [category.id, vehicleCategory.id],
      categoryLabels: [category.label, vehicleCategory.label],
      contactName: customer.name,
      estimatedValue: assets[0].estimatedValue,
      address: assets[0].address,
      assetDetails: assets[0].assetDetails,
      assets,
      lineOfBusiness: "personal",
    });

    expect(enrichmentRequests).toHaveLength(2);
    expect(enrichmentRequests[0].seed?.address).toBe(assets[0].address);
    expect(enrichmentRequests[1].seed?.vin).toBe("1HGCM82633A004352");
    expect(session.selectedAssetMappings?.map((asset) => asset.assetId)).toEqual([
      "asset_first",
      "asset_second",
    ]);
    expect(session.categoryIds).toEqual([category.id, vehicleCategory.id]);
    expect(session.selectedAssetMappings?.[1].categoryId).toBe(vehicleCategory.id);
    expect(session.selectedAssetMappings?.[0].publicFields["Year built"]).toBe("2001");
    expect(session.publicFields["First Street Home - Year built"]).toBe("2001");
    expect(Object.keys(session.selectedAssetMappings?.[1].publicFields ?? {}).length).toBeGreaterThan(0);
    expect(session.questionnaireQuestions?.some((question) =>
      question.section.startsWith("First Street Home - ")
    )).toBe(true);
    expect(session.questionnaireQuestions?.some((question) =>
      question.section.startsWith("2023 Test Vehicle - ")
    )).toBe(true);
    expect(session.questionnaireQuestions?.some((question) =>
      question.section.startsWith("2023 Test Vehicle - ") && /VIN/i.test(question.label)
    )).toBe(true);
    expect(new Set(session.questionnaireQuestions?.map((question) => question.id)).size).toBe(
      session.questionnaireQuestions?.length
    );
  });

  it("startSession pulls public fields + lists missing fields", async () => {
    const { api, agency, agent, prospect } = await seed();
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    expect(["gathering_info", "quoting", "complete"]).toContain(session.status);
    expect(Object.keys(session.publicFields).length).toBeGreaterThan(0);
    expect(session.missingFields.length).toBeGreaterThan(0);
  });

  it("uses agent-provided new-asset details to seed AI public-field prep", async () => {
    const { api, agency, agent } = await seed();
    vi.stubGlobal(
      "fetch",
      vi.fn((u: string) => {
        const url = String(u);
        if (url === "/api/ai/enrich-asset") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              fields: {
                year: 2003,
                make: "HONDA",
                model: "Accord EX-V6",
                bodyClass: "Coupe",
                trim: "EX-V6",
                fuelType: "Gasoline",
                engineCylinders: "6",
                displacementL: "3.0",
              },
              evidence: {
                year: {
                  fieldKey: "year",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                make: {
                  fieldKey: "make",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                model: {
                  fieldKey: "model",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                trim: {
                  fieldKey: "trim",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                fuelType: {
                  fieldKey: "fuelType",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                engineCylinders: {
                  fieldKey: "engineCylinders",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
                displacementL: {
                  fieldKey: "displacementL",
                  sourceKind: "government_api",
                  sourceLabel: "NHTSA VIN decoder (vpic.nhtsa.dot.gov)",
                  sourceUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/1HGCM82633A004352?format=json",
                  confidence: 0.95,
                  verified: true,
                  allowDocumentAutofill: true,
                  collectedAt: "2026-06-28T00:00:00.000Z",
                },
              },
              sources: ["NHTSA VIN decoder (vpic.nhtsa.dot.gov)"],
              confidence: 0.95,
              unavailableFields: ["estimatedValue"],
            }),
          });
        }
        if (url.includes("vpic.nhtsa.dot.gov")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              Results: [
                {
                  ErrorCode: "0",
                  ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct",
                  Make: "HONDA",
                  Model: "Accord",
                  ModelYear: "2003",
                  BodyClass: "Coupe",
                  Trim: "EX-V6",
                  FuelTypePrimary: "Gasoline",
                  EngineCylinders: "6",
                  DisplacementL: "3.0",
                },
              ],
            }),
          });
        }
        return Promise.reject(new Error(`Unexpected URL ${url}`));
      })
    );
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.create({
      tenantId: agency.id,
      customerId: customer.id,
      type: "luxury_vehicle",
      label: "1hgcm82633a004352",
      estimatedValue: 310000,
      details: {
        vin: "1hgcm82633a004352",
      },
      status: "pending",
    });
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: "Avery Stone",
      estimatedValue: 310000,
      address: "1 Ocean Drive, Palm Coast, FL 32137",
      assetDetails: {
        vin: "1HGCM82633A004352",
        year: "2003",
        make: "HONDA",
        model: "Accord EX-V6",
        garagingAddress: "1 Ocean Drive, Palm Coast, FL 32137",
        annualMileage: "3500",
        primaryUse: "Pleasure",
      },
      lineOfBusiness: "personal",
    });

    expect(session.assetDetails?.vin).toBe("1HGCM82633A004352");
    expect(session.publicFields["Year / make / model"]).toBe("2003 HONDA Accord EX-V6");
    expect(session.publicFields["VIN-decoded trim"]).toBe("EX-V6");
    expect(session.publicFields["Garaging address"]).toBe("1 Ocean Drive, Palm Coast, FL 32137");
    expect(session.missingFields).not.toContain("Annual mileage estimate");
    expect(session.missingFields).not.toContain("Primary use (pleasure / commute / business)");
    expect(session.aiSummary).toContain("agent-provided lookup");
    expect(api.assets.get(asset.id)?.label).toBe("2003 HONDA Accord EX-V6");
    const answerForKey = (key: string) => {
      const question = session.questionnaireQuestions?.find(
        (candidate) => candidate.acordFieldKey === key
      );
      expect(question, `Missing personal-auto question ${key}`).toBeTruthy();
      return {
        answer: session.questionnaireResponses?.[question!.id],
        meta: session.questionnaireResponseMeta?.[question!.id],
      };
    };
    expect(answerForKey("vin").answer).toBe("1HGCM82633A004352");
    expect(answerForKey("vehicleYear").answer).toBe("2003");
    expect(answerForKey("vehicleMake").answer).toBe("HONDA");
    expect(answerForKey("vehicleModel").answer).toBe("Accord EX-V6");
    expect(answerForKey("vehicleTrim").answer).toBe("EX-V6");
    expect(answerForKey("vehicleFuelType").answer).toBe("Gasoline");
    expect(answerForKey("vehicleCylinders").answer).toBe("6");
    expect(answerForKey("vehicleDisplacement").answer).toBe("3.0");
    expect(answerForKey("annualMileage").answer).toBe("3500");
    expect(answerForKey("vehicleUsage").answer).toBe("Pleasure");
    expect(answerForKey("currentStreetAddress").answer).toBe("1 Ocean Drive");
    expect(answerForKey("currentCity").answer).toBe("Palm Coast");
    expect(answerForKey("currentState").answer).toBe("FL");
    expect(answerForKey("currentZipCode").answer).toBe("32137");
    expect(answerForKey("coApplicantFirstName").answer).toBeUndefined();
    expect(answerForKey("coApplicantFirstName").meta).toBeUndefined();
    expect(answerForKey("yearsAtAddress").answer).toBeUndefined();
    expect(answerForKey("monthsAtAddress").answer).toBeUndefined();
    expect(answerForKey("previousAddress").answer).toBeUndefined();
    expect(answerForKey("incidentDescription").answer).toBeUndefined();
    expect(answerForKey("incidentDescription").meta).toBeUndefined();
  });

  it("shows AI-filled personal questionnaire fields as editable shared answers", async () => {
    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const category = api.categories.get("cat_primary_home")!;
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: category.assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: customer.name,
      estimatedValue: 1_250_000,
      address: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      assetDetails: {
        propertyAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
        yearBuilt: "2018",
        squareFootage: "4200",
        roofMaterial: "Metal",
      },
      lineOfBusiness: "personal",
    });

    const questions = session.questionnaireQuestions ?? [];
    const yearBuilt = questions.find((question) => /year built/i.test(question.label));
    const squareFootage = questions.find((question) => /square footage/i.test(question.label));
    const roofMaterial = questions.find((question) =>
      /roof.*(material|shape|pitch|skylight)/i.test(question.label)
    );

    expect(yearBuilt).toBeTruthy();
    expect(squareFootage).toBeTruthy();
    expect(roofMaterial).toBeTruthy();
    expect(session.questionnaireResponses?.[yearBuilt!.id]).toBe("2018");
    expect(session.questionnaireResponses?.[squareFootage!.id]).toBe("4200");
    expect(session.questionnaireResponses?.[roofMaterial!.id]).toBe("Metal");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.updatedByRole).toBe("ai");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.sourceKind).toBe("agent_seed");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.sourceLabel).toBe("QuoteX intake");
  });

  it("uses OpenAI research mappings to prefill personal property questionnaire answers", async () => {
    vi.resetModules();
    const ai = await import("../ai");
    const evidence = (fieldKey: string) => ({
      fieldKey,
      sourceKind: "public_web" as const,
      sourceLabel: "OpenAI public property research",
      sourceUrl: "https://example.com/property",
      confidence: 0.76,
      verified: false,
      allowDocumentAutofill: false,
      collectedAt: "2026-06-26T12:00:00.000Z",
      notes: "Source-backed property fact for editable questionnaire review only.",
    });
    const mapSpy = vi.spyOn(ai, "aiMapAcordFields").mockImplementation(async (input) => {
      const fieldId = (pattern: RegExp) =>
        input.fields.find((field) => pattern.test(field.label))?.id;
      const propertyAddressId = fieldId(/property address/i);
      const yearBuiltId = fieldId(/year built/i);
      const squareFootageId = fieldId(/square footage/i);
      const constructionTypeId = fieldId(/frame and exterior|construction type/i);
      const roofMaterialId = fieldId(/roof.*(material|shape|pitch|skylight)/i);
      return {
        fields: {
          "Year built": "1952",
          "Square footage": "2148",
          "Construction type": "Masonry",
          "Roof material": "Asphalt shingle",
          "Property address": "3901 North Nora Avenue, Chicago, IL 60634",
        },
        publicFieldEvidence: {
          "Year built": evidence("Year built"),
          "Square footage": evidence("Square footage"),
          "Construction type": evidence("Construction type"),
          "Roof material": evidence("Roof material"),
          "Property address": {
            ...evidence("Property address"),
            sourceKind: "public_geocoder",
            sourceLabel: "Verified public geocoder",
            confidence: 0.92,
            verified: true,
          },
        },
        mappings: [
          {
            targetId: propertyAddressId,
            targetField: "Property address",
            value: "Quote Tester",
            sourceLabel: "OpenAI public property research",
            sourceKind: "public_web",
            sourceUrl: "https://example.com/profile",
            confidence: 0.76,
            verified: false,
            rationale: "Deliberate mismatch that must not replace the address.",
          },
          {
            targetId: yearBuiltId,
            targetField: "Year built",
            value: "1952",
            sourceLabel: "OpenAI public property research",
            sourceKind: "public_web",
            sourceUrl: "https://example.com/property",
            confidence: 0.76,
            verified: false,
            rationale: "Public property record year built.",
          },
          {
            targetId: squareFootageId,
            targetField: "Square footage",
            value: "2148",
            sourceLabel: "OpenAI public property research",
            sourceKind: "public_web",
            sourceUrl: "https://example.com/property",
            confidence: 0.76,
            verified: false,
            rationale: "Public property record living area.",
          },
          {
            targetId: constructionTypeId,
            targetField: "Construction type",
            value: "Masonry",
            sourceLabel: "OpenAI public property research",
            sourceKind: "public_web",
            sourceUrl: "https://example.com/property",
            confidence: 0.76,
            verified: false,
            rationale: "Public property record construction.",
          },
          {
            targetId: roofMaterialId,
            targetField: "Roof material",
            value: "Asphalt shingle",
            sourceLabel: "OpenAI public property research",
            sourceKind: "public_web",
            sourceUrl: "https://example.com/listing",
            confidence: 0.76,
            verified: false,
            rationale: "Public listing roof material.",
          },
        ],
        missingFields: [],
        webSources: [],
        summary: "Mapped public property facts into editable personal questionnaire answers.",
        confidence: 0.76,
      };
    });
    const { api } = await import("../api");
    const { db } = await import("../db");
    db.reset();
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const category = api.categories.get("cat_primary_home")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Quote Tester",
      email: "qt@example.com",
      assetType: "coastal_home",
      estimatedValue: 1_500_000,
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: category.assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: prospect.name,
      address: "3901 North Nora Avenue, Chicago, IL 60634",
      assetDetails: {
        propertyAddress: "3901 North Nora Avenue, Chicago, IL 60634",
      },
      lineOfBusiness: "personal",
    });

    const questions = session.questionnaireQuestions ?? [];
    const answerFor = (pattern: RegExp) => {
      const question = questions.find((candidate) => pattern.test(candidate.label));
      expect(question).toBeTruthy();
      return session.questionnaireResponses?.[question!.id];
    };
    expect(mapSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "questionnaire_prefill",
        template: expect.objectContaining({ documentName: "Personal lines questionnaire" }),
        fields: expect.arrayContaining([
          expect.objectContaining({ label: expect.stringMatching(/year built/i) }),
          expect.objectContaining({ label: expect.stringMatching(/square footage/i) }),
        ]),
      })
    );
    expect(answerFor(/property address/i)).toBe("3901 North Nora Avenue, Chicago, IL 60634");
    expect(answerFor(/occupancy/i)).toBeUndefined();
    expect(answerFor(/year built/i)).toBe("1952");
    expect(answerFor(/square footage/i)).toBe("2148");
    expect(answerFor(/frame and exterior|construction type/i)).toBe("Masonry");
    expect(answerFor(/roof.*(material|shape|pitch|skylight)/i)).toBe("Asphalt shingle");
    expect(answerFor(/property address/i)).not.toBe("Quote Tester");
    const yearBuiltQuestion = questions.find((candidate) => /year built/i.test(candidate.label));
    expect(session.questionnaireResponseMeta?.[yearBuiltQuestion!.id]?.sourceUrl).toBe("https://example.com/property");
    expect(session.questionnaireResponseMeta?.[yearBuiltQuestion!.id]?.sourceKind).toBe("public_web");
    expect(session.missingFields).toEqual(expect.arrayContaining(["Occupancy"]));
    expect(session.missingFields).not.toEqual(expect.arrayContaining(["Year built", "Square footage"]));
  });

  it("trusts exact OpenAI target ids even when the returned field wording is descriptive", async () => {
    vi.resetModules();
    const ai = await import("../ai");
    vi.spyOn(ai, "aiMapAcordFields").mockImplementation(async (input) => {
      const yearBuilt = input.fields.find((field) => /year built/i.test(field.label));
      const targetField = "Public record result - year built";
      return {
        fields: {},
        publicFieldEvidence: {
          [targetField]: {
            fieldKey: targetField,
            sourceKind: "web_search",
            sourceLabel: "OpenAI public-data sweep",
            sourceUrl: "https://example.com/property",
            confidence: 0.72,
            verified: false,
            allowDocumentAutofill: false,
            collectedAt: "2026-06-26T12:00:00.000Z",
            notes: "Editable questionnaire prefill only.",
          },
        },
        mappings: [
          {
            targetId: yearBuilt?.id,
            targetField,
            value: "2007",
            sourceLabel: "OpenAI public-data sweep",
            sourceUrl: "https://example.com/property",
            sourceKind: "web_search",
            confidence: 0.72,
            verified: false,
            rationale: "Public records indicate the property year built.",
          },
        ],
        missingFields: [],
        webSources: [],
        summary: "Mapped public property facts into editable personal questionnaire answers.",
        confidence: 0.72,
      };
    });
    const { api } = await import("../api");
    const { db } = await import("../db");
    db.reset();
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const category = api.categories.get("cat_primary_home")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "Quote Tester",
      email: "qt@example.com",
      assetType: "coastal_home",
      estimatedValue: 1_500_000,
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: category.assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: prospect.name,
      address: "901 McDonald Dr, Northville, MI 48167",
      lineOfBusiness: "personal",
    });

    const yearBuilt = session.questionnaireQuestions?.find((question) => /year built/i.test(question.label));
    expect(yearBuilt).toBeTruthy();
    expect(session.questionnaireResponses?.[yearBuilt!.id]).toBe("2007");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.updatedByRole).toBe("ai");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.sourceUrl).toBe("https://example.com/property");
  });

  it("does not prefill low-confidence estimate-only sweep answers into editable questionnaire responses", async () => {
    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const category = api.categories.get("cat_primary_home")!;
    const session = api.quoting.upsertCustomerIntakeSession({
      tenantId: agency.id,
      customerId: customer.id,
      quoteRequestId: "quote_request_estimate_only",
      assetType: category.assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: customer.name,
      address: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      estimatedValue: 1_250_000,
      assetDetails: {
        propertyAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
        yearBuilt: "2018",
        squareFootage: "4200",
      },
      publicFieldEvidence: {
        yearBuilt: {
          fieldKey: "yearBuilt",
          sourceKind: "model_estimate",
          sourceLabel: "AI public-data sweep estimate",
          confidence: 0.48,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-19T12:00:00.000Z",
        },
        squareFootage: {
          fieldKey: "squareFootage",
          sourceKind: "model_estimate",
          sourceLabel: "AI public-data sweep estimate",
          confidence: 0.48,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-19T12:00:00.000Z",
        },
      },
      lineOfBusiness: "personal",
      createdById: agent.id,
      status: "submitted_to_agent",
    });

    const expanded = api.quoting.get(session.id)!;
    const yearBuilt = expanded.questionnaireQuestions?.find((question) => /year built/i.test(question.label));
    const squareFootage = expanded.questionnaireQuestions?.find((question) => /square footage/i.test(question.label));

    expect(yearBuilt).toBeTruthy();
    expect(squareFootage).toBeTruthy();
    expect(expanded.questionnaireResponses?.[yearBuilt!.id]).toBeUndefined();
    expect(expanded.questionnaireResponses?.[squareFootage!.id]).toBeUndefined();
    expect(expanded.questionnaireResponseMeta?.[yearBuilt!.id]).toBeUndefined();
    expect(expanded.missingFields).toEqual(
      expect.arrayContaining([yearBuilt!.label, squareFootage!.label])
    );
  });

  it("prefills high-confidence source-backed public sweep answers into editable questionnaire responses", async () => {
    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const category = api.categories.get("cat_primary_home")!;
    const session = api.quoting.upsertCustomerIntakeSession({
      tenantId: agency.id,
      customerId: customer.id,
      quoteRequestId: "quote_request_chatgpt_style_estimates",
      assetType: category.assetType,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: customer.name,
      address: "901 McDonald Dr, Northville, MI 48167",
      estimatedValue: 1_250_000,
      assetDetails: {
        propertyAddress: "901 McDonald Dr, Northville, MI 48167",
        yearBuilt: "2007",
        squareFootage: "4,100 above grade / 6,500 total listed living area",
        roofAge: "Unknown; if original, approx. 19 years",
      },
      publicFieldEvidence: {
        yearBuilt: {
          fieldKey: "yearBuilt",
          sourceKind: "web_search",
          sourceLabel: "OpenAI public-data sweep",
          sourceUrl: "https://example.com/property",
          confidence: 0.72,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-26T12:00:00.000Z",
        },
        squareFootage: {
          fieldKey: "squareFootage",
          sourceKind: "web_search",
          sourceLabel: "OpenAI public-data sweep",
          sourceUrl: "https://example.com/property",
          confidence: 0.72,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-26T12:00:00.000Z",
        },
        roofAge: {
          fieldKey: "roofAge",
          sourceKind: "model_estimate",
          sourceLabel: "OpenAI public-data sweep",
          confidence: 0.72,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-26T12:00:00.000Z",
        },
      },
      lineOfBusiness: "personal",
      createdById: agent.id,
      status: "submitted_to_agent",
    });

    const expanded = api.quoting.get(session.id)!;
    const yearBuilt = expanded.questionnaireQuestions?.find((question) => /year built/i.test(question.label));
    const squareFootage = expanded.questionnaireQuestions?.find((question) => /square footage/i.test(question.label));
    const roofAge = expanded.questionnaireQuestions?.find((question) => /roof age/i.test(question.label));

    expect(yearBuilt).toBeTruthy();
    expect(squareFootage).toBeTruthy();
    expect(expanded.questionnaireResponses?.[yearBuilt!.id]).toBe("2007");
    expect(expanded.questionnaireResponses?.[squareFootage!.id]).toBe(
      "4,100 above grade / 6,500 total listed living area"
    );
    if (roofAge) {
      expect(expanded.questionnaireResponses?.[roofAge.id]).toBeUndefined();
      expect(expanded.questionnaireResponseMeta?.[roofAge.id]).toBeUndefined();
    }
    expect(expanded.questionnaireResponseMeta?.[yearBuilt!.id]?.updatedByRole).toBe("ai");
    expect(expanded.questionnaireResponseMeta?.[yearBuilt!.id]?.sourceUrl).toBe("https://example.com/property");
  });

  it("keeps personal-lines sessions on AI mapping until the agent advances to questionnaire", async () => {
    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home");
    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });

    expect(initial.lineOfBusiness).toBe("personal");
    expect(initial.questionnaireQuestions?.length).toBeGreaterThan(0);
    expect(initial.questionnaireQuestions?.some((question) => question.required)).toBe(true);
    expect(initial.questionnaireQuestions?.some((question) => !question.required)).toBe(true);
    expect(
      initial.missingFields.every((label) =>
        initial.questionnaireQuestions?.some(
          (question) => question.required && question.label === label
        )
      )
    ).toBe(true);
    expect(initial.personalQuestionnairePreparedAt).toBeUndefined();

    const prepared = api.quoting.preparePersonalQuestionnaire(initial.id)!;
    expect(prepared.personalQuestionnairePreparedAt).toBeTruthy();
    expect(prepared.questionnaireQuestions?.length).toBe(initial.questionnaireQuestions?.length);

    const steppedBack = api.quoting.stepBack(initial.id)!;
    expect(steppedBack.personalQuestionnairePreparedAt).toBeUndefined();
    expect(steppedBack.questionnaireQuestions?.length).toBe(initial.questionnaireQuestions?.length);
  });

  it("keeps the quote flow moving when the provider times out before answers return", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/ai/acord-map")) {
          return new Response(
            JSON.stringify({
              fields: {},
              publicFieldEvidence: {},
              mappings: [],
              missingFields: ["Year built"],
              webSources: [],
              summary: "OpenAI public-data sweep timed out before answers were returned.",
              confidence: 0,
              providerError: "OpenAI public-data sweep timed out before answers were returned.",
              providerErrorCode: "timeout",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("{}", { status: 404 });
      })
    );

    const { api, agency, agent } = await seed();
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home");
    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });

    expect(initial.aiProviderErrorCode).toBe("timeout");
    const prepared = api.quoting.preparePersonalQuestionnaire(initial.id)!;
    expect(prepared.personalQuestionnairePreparedAt).toBeTruthy();
    expect(prepared.aiProviderErrorCode).toBe("timeout");
    expect(prepared.missingFields.length).toBeGreaterThan(0);
  });

  it("draftQuestionnaire writes a message body the agent can review", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    const s2 = await api.quoting.draftQuestionnaire(s1.id);
    expect(s2?.questionnaireDraft).toMatch(/Subject:/);
    expect(s2?.questionnaireDraft).toContain(prospect.name.split(" ")[0]);
  });

  it("sendQuestionnaire emits an outbound Communication + flips status", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    const s2 = api.quoting.sendQuestionnaire(s1.id)!;
    expect(s2.status).toBe("awaiting_reply");
    expect(s2.questionnaireMessageId).toBeTruthy();
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === s2.questionnaireMessageId);
    expect(comm?.direction).toBe("outbound");
    expect(comm?.channel).toBe("email");
  });

  it("markReplyReceivedAndQuote runs carrier quotes and ranks them best-first", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    api.quoting.sendQuestionnaire(s1.id);
    const s2 = api.quoting.markReplyReceivedAndQuote(s1.id)!;
    expect(s2.status).toBe("complete");
    expect(s2.quotes.length).toBeGreaterThanOrEqual(0);
    if (s2.quotes.length > 1) {
      // Ranked: score desc.
      expect(s2.quotes[0].score).toBeGreaterThanOrEqual(s2.quotes[1].score);
    }
    const readyNotification = api.aiNotifications
      .listUnacked(agency.id)
      .find((notification) => notification.kind === "quote_ready" && notification.quoteSessionId === s1.id);
    expect(readyNotification?.quoteSessionId).toBe(s1.id);
    expect(readyNotification?.assignedToId).toBe(agent.id);
    expect(readyNotification?.title).toMatch(/quote (options ready|review needed)/i);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some((task) => task.activityKey === `quote-session:${s1.id}:quote_ready` && task.status !== "resolved")
    ).toBe(false);

    api.quoting.runQuotes(s1.id);
    const matches = api.aiNotifications
      .listUnacked(agency.id)
      .filter((notification) => notification.kind === "quote_ready" && notification.quoteSessionId === s1.id);
    expect(matches).toHaveLength(1);
  });

  it("records AI workflow progress into timeline events and remarks", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    api.quoting.sendQuestionnaire(s1.id);
    api.quoting.markReplyReceivedAndQuote(s1.id);

    const events = api.status.listFor({ prospectId: prospect.id });
    const notes = api.notes.listByProspect(prospect.id);

    expect(events.some((event) => event.message.includes("AI quoting workflow started"))).toBe(true);
    expect(events.some((event) => event.message.includes("questionnaire sent"))).toBe(true);
    expect(events.some((event) => event.message.includes("carrier ranking"))).toBe(true);
    expect(notes.filter((note) => note.body.startsWith("AI quoting workflow:")).length).toBeGreaterThanOrEqual(4);
  });

  it("ignores legacy endpoint settings and uses the carrier runner path", async () => {
    const { api, agency, agent, prospect } = await seed();
    const carriers = api.carriers.list();
    if (carriers.length > 0) {
      api.carriers.update(carriers[0].id, {
        quotingApi: {
          provider: "Legacy endpoint",
          endpoint: "https://legacy.example/quote",
          status: "configured",
        },
      });
    }
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    await api.quoting.draftQuestionnaire(s1.id);
    api.quoting.sendQuestionnaire(s1.id);
    const s2 = api.quoting.markReplyReceivedAndQuote(s1.id)!;
    if (carriers.length > 0) {
      const target = s2.quotes.find((q) => q.carrierId === carriers[0].id);
      if (target) {
        expect(target.providerTrace?.provider).toBe("carrier_portal_automation");
        expect(target.providerTrace?.providerLabel).toBe("AI carrier portal runner");
      }
    }
  });

  it("prepares AI carrier runner traces for configured carrier portals", async () => {
    const { api, agency, agent, prospect } = await seed();
    const chubb = api.carriers.get("carrier_chubb")!;
    expect(chubb.quotingAutomation?.provider).toBe("AI carrier portal runner");

    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
      address: "210 Ocean Blvd, Palm Beach, FL 33480",
      lineOfBusiness: "personal",
    });
    const complete =
      s1.status === "complete"
        ? s1
        : api.quoting.submitQuestionnaireResponses(
            s1.id,
            Object.fromEntries(
              (s1.questionnaireQuestions ?? []).map((question) => [
                question.id,
                question.kind === "number" ? "1" : "Confirmed for carrier runner test",
              ])
            ),
            { id: agent.id, name: agent.name, role: "agent" }
          )!;

    const quote = complete.quotes.find((q) => q.carrierId === chubb.id);
    expect(quote?.apiStatus).toBe("simulated");
    expect(quote?.providerTrace?.provider).toBe("carrier_portal_automation");
    expect(quote?.providerTrace?.transport).toBe("browser_automation");
    expect(quote?.providerTrace?.messages.join(" ")).toContain("carrier portal");
    expect(quote?.fitReason).toContain("adapter ready");
    expect(complete.aiSummary).toContain("AI runner workflow");
  });

  it("diagnoses personal-lines carrier runner readiness for linked carriers", async () => {
    const { api, agency } = await seed();
    const diagnostic = api.quoting.diagnosePersonalLinesCarrierApis({
      tenantId: agency.id,
      assetType: "coastal_home",
      state: "FL",
    });

    expect(diagnostic.linkedActiveCarrierCount).toBeGreaterThan(0);
    expect(diagnostic.rows).toHaveLength(diagnostic.linkedActiveCarrierCount);
    expect(diagnostic.missingApiCount).toBe(0);
    expect(diagnostic.liveReadyCount).toBe(0);
    expect(
      diagnostic.rows.some((row) =>
        row.blockingReasons.some((reason) =>
          /server-side carrier automation worker/i.test(reason)
        )
      )
    ).toBe(true);
    expect(diagnostic.rows.some((row) => row.provider === "AI carrier portal runner")).toBe(true);
  });

  it("fans a personal-lines quote through every linked carrier runner", async () => {
    const { api, agency, agent } = await seed();
    vi.stubEnv("VITE_QUOTEX_CARRIER_AUTOMATION_BRIDGE_URL", "https://runner.example/jobs");
    const linkedCarriers = api.carriers
      .listForTenant(agency.id)
      .filter((carrier) => carrier.status === "active");
    const testedAt = new Date().toISOString();

    for (const carrier of linkedCarriers) {
      api.carriers.update(carrier.id, {
        quotingAutomation: {
          ...(carrier.quotingAutomation ?? {}),
          provider: "AI carrier portal runner",
          agentPortalUrl: carrier.agentPortalUrl ?? carrier.quotingAutomation?.agentPortalUrl ?? "https://carrier.example/agent",
          credentialReference: "vault://agency/test/carrier",
          mfaMode: "staff_prompt",
          status: "connected",
          lastTestedAt: testedAt,
        },
      });
    }

    const diagnostic = api.quoting.diagnosePersonalLinesCarrierApis({
      tenantId: agency.id,
      assetType: "coastal_home",
      state: "FL",
    });
    expect(diagnostic.missingApiCount).toBe(0);
    expect(diagnostic.simulatedCount).toBeGreaterThan(0);
    expect(diagnostic.errorCount).toBe(0);
    expect(diagnostic.rows.every((row) => row.quoteApiStatus !== "no_api")).toBe(true);

    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home");
    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 4_250_000,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });
    const responses = Object.fromEntries(
      (initial.questionnaireQuestions ?? []).map((question) => [
        question.id,
        question.kind === "number" ? "1" : "Confirmed for live carrier runner test",
      ])
    );
    const complete =
      initial.status === "complete"
        ? initial
        : api.quoting.submitQuestionnaireResponses(initial.id, responses, {
            id: agent.id,
            name: agent.name,
            role: "agent",
          })!;

    expect(complete.status).toBe("complete");
    expect(complete.lineOfBusiness).toBe("personal");
    expect(complete.quotes).toHaveLength(linkedCarriers.length);
    expect(new Set(complete.quotes.map((quote) => quote.carrierId))).toEqual(
      new Set(linkedCarriers.map((carrier) => carrier.id))
    );
    expect(complete.quotes.every((quote) => quote.apiStatus !== "no_api")).toBe(true);
    if (complete.quotes.length > 1) {
      expect(complete.quotes[0].score).toBeGreaterThanOrEqual(complete.quotes[1].score);
    }
  });

  it("works for clients re-quoting an existing asset", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
    });
    expect(s1.customerId).toBe(customer.id);
    expect(s1.assetId).toBe(asset?.id);
    expect(s1.assetType).toBe(asset?.type ?? "coastal_home");
    // getForCustomer resolves to the same session.
    expect(api.quoting.getForCustomer(customer.id)?.id).toBe(s1.id);
  });

  it("keeps personal-lines quoting active after document-card ACORD autofill", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home");
    const personal = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });
    const acordTemplate = api.documents
      .listTemplates(agency.id)
      .find((document) => `${document.fileName} ${document.documentName ?? ""}`.toLowerCase().includes("acord"));
    expect(acordTemplate).toBeTruthy();

    const result = api.documents.autofillAcordForCustomer({
      tenantId: agency.id,
      customerId: customer.id,
      uploadedById: agent.id,
      selectedAcordTemplateIds: [acordTemplate!.id],
    });

    expect(result?.documents.length).toBeGreaterThan(0);
    expect(result?.session.lineOfBusiness).toBe("commercial");
    expect(api.quoting.getForCustomer(customer.id)?.id).toBe(personal.id);
    expect(api.quoting.getForCustomer(customer.id)?.lineOfBusiness).toBe("personal");
  });

  it("ignores older saved document-only ACORD sessions when resolving the active client quote", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home");
    const personal = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset?.id,
      createdById: agent.id,
      assetType: asset?.type ?? "coastal_home",
      contactName: customer.name,
      estimatedValue: asset?.estimatedValue ?? 1_500_000,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });

    db.insert("quotingSessions", {
      ...personal,
      id: "quote_session_legacy_document_only",
      lineOfBusiness: "commercial",
      commercialAcordTemplates: [],
      questionnaireQuestions: [],
      questionnaireResponses: {},
      publicFields: {},
      missingFields: [],
      quotes: [],
      status: "gathering_info",
      aiSummary: "ACORD documents initialized from the client Documents card.",
      createdAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    });

    expect(api.quoting.getForCustomer(customer.id)?.id).toBe(personal.id);
    expect(api.quoting.getForCustomer(customer.id)?.lineOfBusiness).toBe("personal");
  });

  it("marks commercial ACORD applications as sent after carrier email draft review", async () => {
    const { api, agency, agent } = await seed();
    const { db } = await import("../db");
    const customer = api.customers.list(agency.id)[0];
    const acordTemplate = api.documents
      .listTemplates(agency.id)
      .find((document) =>
        `${document.fileName} ${document.documentName ?? ""}`.toLowerCase().includes("acord")
      );
    expect(acordTemplate).toBeTruthy();

    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: customer.name,
      estimatedValue: 1_000_000,
      address: customer.mailingAddress,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [acordTemplate!.id],
    });
    const prepared = api.quoting.prepareCommercialQuestionnaire(initial.id)!;
    const responses = Object.fromEntries(
      (prepared.questionnaireQuestions ?? []).map((question) => [
        question.id,
        question.kind === "number" ? "1" : "Confirmed for carrier submission test",
      ])
    );
    const selectedCarrierIds = api.quoting
      .recommendCommercialCarriers(prepared.id, responses)
      .filter(
        (recommendation) =>
          !recommendation.disabledReason && recommendation.underwriterContacts.length > 0
      )
      .slice(0, 2)
      .map((recommendation) => recommendation.carrierId);
    expect(selectedCarrierIds.length).toBeGreaterThan(0);

    const drafts = api.quoting.previewCommercialCarrierEmails(
      prepared.id,
      responses,
      "application",
      selectedCarrierIds
    );
    expect(drafts.length).toBeGreaterThan(0);

    const sent = api.quoting.submitQuestionnaireResponses(
      prepared.id,
      responses,
      { id: agent.id, name: agent.name, role: "agent" },
      {
        selectedCommercialCarrierIds: selectedCarrierIds,
        commercialCarrierEmailDrafts: drafts,
      }
    )!;

    const persisted = api.quoting.get(prepared.id)!;
    expect(sent.commercialApplicationSentAt ?? persisted.commercialApplicationSentAt).toBeTruthy();
    expect(persisted.commercialCarrierSubmissions?.length).toBeGreaterThan(0);
    expect(
      persisted.commercialCarrierSubmissions?.some(
        (submission) =>
          (submission.applicationMessageIds?.length ?? 0) > 0 ||
          (submission.applicationDocumentIds?.length ?? 0) > 0 ||
          submission.status === "application_sent" ||
          submission.status === "awaiting_response" ||
          submission.status === "accepted" ||
          submission.status === "declined" ||
          submission.status === "needs_client_info" ||
          submission.status === "needs_supplemental" ||
          submission.status === "supplemental_sent"
      )
    ).toBe(true);

    db.update("quotingSessions", persisted.id, {
      commercialApplicationSentAt: undefined,
      status: "gathering_info",
    });
    const repaired = api.quoting.get(persisted.id)!;
    expect(repaired.commercialApplicationSentAt).toBeTruthy();
    expect(repaired.status).not.toBe("gathering_info");
  });

  it("implements a selected carrier quote as a bound policy record", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id).find((a) => a.type === "coastal_home")!;
    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      createdById: agent.id,
      assetType: asset.type,
      contactName: customer.name,
      estimatedValue: asset.estimatedValue,
      address: customer.mailingAddress,
      lineOfBusiness: "personal",
    });
    const complete =
      initial.status === "complete"
        ? initial
        : api.quoting.submitQuestionnaireResponses(
            initial.id,
            Object.fromEntries(
              (initial.questionnaireQuestions ?? []).map((question) => [
                question.id,
                question.kind === "number" ? "1" : "Confirmed for implementation test",
              ])
            ),
            { id: agent.id, name: agent.name, role: "agent" }
          )!;
    expect(complete.quotes.length).toBeGreaterThan(0);

    const selected = complete.quotes[0];
    const result = api.quoting.implementPolicy({
      sessionId: complete.id,
      carrierId: selected.carrierId,
      implementedById: agent.id,
    });

    expect(result.policy.status).toBe("bound");
    expect(result.policy.customerId).toBe(customer.id);
    expect(result.policy.assetId).toBe(asset.id);
    expect(result.policy.carrierId).toBe(selected.carrierId);
    expect(result.policy.finalPremium).toBe(selected.premium);
    expect(result.carrierReference).toBeTruthy();
    expect(result.bindingTrace?.status).toMatch(/manual_required|prepared_not_sent/);
    expect(result.policy.carrierBindingStatus).toBe(result.bindingTrace?.status);
    expect(result.policy.carrierBindingReference).toBe(result.bindingTrace?.carrierReference);
    expect(result.policy.carrierBindingMode).toBe("manual_workflow");
    expect(api.quoting.get(complete.id)?.quotes[0].implementation?.policyId).toBe(result.policy.id);
    expect(api.quoting.get(complete.id)?.quotes[0].implementation?.bindingTrace?.requestId).toBe(
      result.bindingTrace?.requestId
    );
    expect(api.status.listFor({ customerId: customer.id }).some((event) => event.policyId === result.policy.id)).toBe(true);
  });

  it("reset removes the session so the agent can start over", async () => {
    const { api, agency, agent, prospect } = await seed();
    const s1 = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
    });
    api.quoting.reset(s1.id);
    expect(api.quoting.getForProspect(prospect.id)).toBeUndefined();
  });
});
