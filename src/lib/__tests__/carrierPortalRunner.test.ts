// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("carrier portal runner", () => {
  it("does not create a synthetic personal quote before Quotex Connect returns verified carrier evidence", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: customer.name,
      estimatedValue: 245_000,
      address: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      assetDetails: {
        vin: "WP0AD2A92PS257111",
        year: "2023",
        make: "Porsche",
        model: "911 Turbo S",
        garagingAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      },
      lineOfBusiness: "personal",
    });
    const complete =
      session.status === "complete"
        ? session
        : api.quoting.submitQuestionnaireResponses(
            session.id,
            Object.fromEntries(
              (session.questionnaireQuestions ?? []).map((question) => [
                question.id,
                question.kind === "number" ? "1" : "Confirmed for runner test",
              ])
            ),
            { id: agent.id, name: agent.name, role: "agent" }
          )!;

    expect(complete.quotes).toEqual([]);
    expect(
      complete.quotes.some(
        (quote) =>
          quote.providerTrace?.provider === "carrier_portal_automation" ||
          quote.carrierReference?.startsWith("QT-")
      )
    ).toBe(false);
  });

  it("attaches runner traces to commercial carrier portal submissions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 750_000,
      lineOfBusiness: "commercial",
      assetDetails: {
        vehicleCount: "8",
        garagingAddress: "210 Ocean Blvd, Palm Beach, FL 33480",
      },
    });
    const recommendation = api.quoting
      .recommendCommercialCarriers(session.id, {
        "base-legal-business-name-as-registered": "Coastal Logistics LLC",
        "base-federal-ein": "12-3456789",
      })
      .find((row) => row.automationAvailable);

    expect(recommendation).toBeTruthy();
    const submitted = api.quoting.submitQuestionnaireResponses(
      session.id,
      {
        "base-legal-business-name-as-registered": "Coastal Logistics LLC",
        "base-federal-ein": "12-3456789",
      },
      { id: agent.id, name: agent.name, role: "agent" },
      { selectedCommercialCarrierIds: [recommendation!.carrierId] }
    );

    const submission = submitted?.commercialCarrierSubmissions?.find(
      (row) => row.carrierId === recommendation!.carrierId
    );
    expect(submission).toBeTruthy();
    expect(submission?.submissionMethod).toBe("carrier_portal_automation");
    expect(submission?.automationJobId).toBe(submission?.automationTrace?.jobId);
    expect(submission?.automationTrace?.fieldMappings.some((field) => field.carrierField === "Legal Business Name")).toBe(true);
    expect(submission?.automationTrace?.fieldMappings.some((field) => field.carrierField === "FEIN")).toBe(true);
  });
});
