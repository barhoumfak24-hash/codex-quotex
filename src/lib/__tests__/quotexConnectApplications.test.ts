import { describe, expect, it } from "vitest";
import { buildQuotexConnectCarrierApplication } from "@/lib/quotexConnectApplications";
import type { QuotingSession } from "@/types";

describe("buildQuotexConnectCarrierApplication", () => {
  it("builds a personal-auto submission from known questionnaire and asset facts only", () => {
    const application = buildQuotexConnectCarrierApplication({
      clientName: "Alexandra Whitford",
      session: session({
        assetType: "luxury_vehicle",
        selectedAssetMappings: [
          {
            label: "2023 Dodge Charger GT",
            assetType: "luxury_vehicle",
            estimatedValue: 0,
            assetDetails: {
              vin: "2c3cdxmg3ph675983",
              year: "2023",
              make: "Dodge",
              model: "Charger",
              trim: "GT",
              bodyStyle: "Sedan",
            },
            publicFields: {},
            missingFields: [],
            aiSummary: "",
          },
        ],
        questionnaireQuestions: [
          question("first_name", "Primary Applicant First Name"),
          question("last_name", "Primary Applicant Last Name"),
          question("collision", "Collision Deductible"),
        ],
        questionnaireResponses: {
          first_name: "Alexandra",
          last_name: "Whitford",
          collision: "1000",
        },
      }),
    });

    expect(application).toMatchObject({
      policyType: "auto",
      clientName: "Alexandra Whitford",
      drivers: [{ fullName: "Alexandra Whitford" }],
      vehicles: [
        {
          vin: "2C3CDXMG3PH675983",
          year: 2023,
          make: "Dodge",
          model: "Charger",
        },
      ],
      coverage: { collisionDeductible: 1000 },
    });
    expect(application).not.toHaveProperty("vehicles.0.trim");
    expect(application).not.toHaveProperty("vehicles.0.bodyStyle");
    expect(JSON.stringify(application)).not.toContain("social");
    expect(application).not.toHaveProperty("coverage.comprehensiveDeductible");
    expect(application).not.toHaveProperty("drivers.0.gender");
  });

  it("includes every selected vehicle with sufficient evidence", () => {
    const application = buildQuotexConnectCarrierApplication({
      clientName: "Alexandra Whitford",
      session: session({
        assetType: "luxury_vehicle",
        selectedAssetMappings: [
          vehicle("1HGCM82633A004352", "2003", "Honda", "Accord"),
          vehicle("1FTFW1E50JFA00001", "2018", "Ford", "F-150"),
        ],
      }),
    });

    expect(application?.vehicles).toEqual([
      expect.objectContaining({ vin: "1HGCM82633A004352", make: "Honda", model: "Accord" }),
      expect.objectContaining({ vin: "1FTFW1E50JFA00001", make: "Ford", model: "F-150" }),
    ]);
  });

  it("allows a valid VIN to reach a carrier that performs its own VIN decode", () => {
    const application = buildQuotexConnectCarrierApplication({
      clientName: "Alexandra Whitford",
      session: session({
        assetType: "luxury_vehicle",
        assetDetails: {
          vin: "1HGCM82633A004352",
        },
      }),
    });

    expect(application).toMatchObject({
      policyType: "auto",
      vehicles: [{ vin: "1HGCM82633A004352" }],
    });
    const vehicle = (application?.vehicles as Array<Record<string, unknown>> | undefined)?.[0];
    expect(vehicle).not.toHaveProperty("year");
    expect(vehicle).not.toHaveProperty("make");
    expect(vehicle).not.toHaveProperty("model");
  });

  it("still rejects a malformed VIN", () => {
    const application = buildQuotexConnectCarrierApplication({
      clientName: "Alexandra Whitford",
      session: session({
        assetType: "luxury_vehicle",
        assetDetails: { vin: "NOT-A-VIN" },
      }),
    });

    expect(application).toBeNull();
  });

  it("builds a homeowners submission without inventing occupancy or coverage defaults", () => {
    const application = buildQuotexConnectCarrierApplication({
      clientName: "Alexandra Whitford",
      session: session({
        assetType: "coastal_home",
        assetDetails: {
          propertyAddress: "901 McDonald Dr, Northville, MI 48167",
          yearBuilt: "2007",
          squareFootage: "4100",
          roofMaterial: "Asphalt shingle",
          roofReplacementYear: "2020",
        },
      }),
    });

    expect(application).toMatchObject({
      policyType: "homeowners",
      clientName: "Alexandra Whitford",
      property: {
        address: "901 McDonald Dr",
        city: "Northville",
        state: "MI",
        zip: "48167",
        yearBuilt: 2007,
        squareFootage: 4100,
        roofType: "Asphalt shingle",
        roofAge: new Date().getFullYear() - 2020,
      },
    });
    expect(application).not.toHaveProperty("property.roofReplacedYear");
    expect(application).not.toHaveProperty("occupancy.type");
    expect(application).not.toHaveProperty("coverage.dwellingAmount");
    expect(application).not.toHaveProperty("losses.count");
  });
});

function session(overrides: Partial<QuotingSession>): QuotingSession {
  return {
    id: "quote_session_test",
    tenantId: "tenant_test",
    assetType: "luxury_vehicle",
    estimatedValue: 0,
    status: "gathering_info",
    publicFields: {},
    missingFields: [],
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
    ...overrides,
  } as QuotingSession;
}

function question(id: string, label: string) {
  return {
    id,
    section: "Applicant",
    label,
    kind: "text" as const,
  };
}

function vehicle(
  vin: string,
  year: string,
  make: string,
  model: string
) {
  return {
    label: `${year} ${make} ${model}`,
    assetType: "luxury_vehicle" as const,
    estimatedValue: 0,
    assetDetails: { vin, year, make, model },
    publicFields: {},
    missingFields: [],
    aiSummary: "",
  };
}
