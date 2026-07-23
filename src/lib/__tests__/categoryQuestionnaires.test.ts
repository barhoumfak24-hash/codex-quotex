import { beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

describe("category questionnaire templates", () => {
  it("builds the primary home intake from the home quote sheet", async () => {
    const { api } = await import("../api");
    const { categoryQuestionnaire } = await import("../categoryQuestionnaires");

    const category = api.categories.get("cat_primary_home")!;
    const questions = categoryQuestionnaire(category);
    const keys = questions.map((question) => question.key);

    expect(keys).toContain("propertyAddress");
    expect(keys).toContain("occupancy");
    expect(keys).toContain("yearBuilt");
    expect(keys).toContain("squareFootageAndUnits");
    expect(keys).toContain("foundationDetails");
    expect(keys).toContain("roofShapePitchMaterial");
    expect(keys).toContain("heatingCoolingSystems");
    expect(keys).toContain("electricalAndSafetySystems");
    expect(keys).toContain("priorCarrierAndLosses");
    expect(keys).toContain("requestedHomeEndorsements");
    expect(keys).toContain("homeDiscountsAndProtection");
    expect(keys).toContain("currentCoverage");
    expect(keys).toContain("targetEffectiveDate");
    expect(questions.length).toBeGreaterThanOrEqual(24);
  });

  it("builds the standard auto intake from the auto quote sheet", async () => {
    const { api } = await import("../api");
    const { categoryQuestionnaire } = await import("../categoryQuestionnaires");

    const category = api.categories.get("cat_standard_auto")!;
    const questions = categoryQuestionnaire(category);
    const keys = questions.map((question) => question.key);

    expect(keys).toContain("vin");
    expect(keys).toContain("primaryFirstName");
    expect(keys).toContain("preferredContactMethod");
    expect(keys).toContain("authorizeMvr");
    expect(keys).toContain("currentStreetAddress");
    expect(keys).toContain("ratingState");
    expect(keys).toContain("currentlyInsured");
    expect(keys).toContain("multiPolicyDiscount");
    expect(keys).toContain("recommendedRepairShops");
    expect(keys).toContain("driverLicenseNumber");
    expect(keys).toContain("vehicleYear");
    expect(keys).toContain("bodilyInjuryLimits");
    expect(keys).toContain("comprehensiveDeductible");
    expect(keys).toContain("incidentType");
    expect(keys).toContain("applicantInformationVerified");
    expect(keys).toContain("targetEffectiveDate");
    expect(new Set(questions.map((question) => question.section)).size).toBe(14);
    expect(questions.length).toBeGreaterThanOrEqual(130);
  });

  it("generates a bounded questionnaire for every active category", async () => {
    const { api } = await import("../api");
    const {
      categoryQuestionnaire,
      categoryQuestionPublicDataScore,
    } = await import("../categoryQuestionnaires");

    const categories = api.categories.listActive();
    expect(categories.length).toBeGreaterThan(100);

    categories.forEach((category) => {
      const questions = categoryQuestionnaire(category);
      const maxQuestions =
        category.lineOfBusiness === "commercial"
          ? 9
          : category.assetType === "coastal_home"
          ? 30
          : category.assetType === "luxury_vehicle"
          ? 160
          : 8;
      expect(questions.length).toBeGreaterThanOrEqual(3);
      expect(questions.length).toBeLessThanOrEqual(maxQuestions);
      expect(categoryQuestionPublicDataScore(category)).toBeGreaterThanOrEqual(70);
      expect(new Set(questions.map((question) => question.key)).size).toBe(questions.length);
    });
  });

  it("creates a linked agent quote session, remark, and activity task from a customer-started quote", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const category = api.categories.get("cat_com_restaurant")!;

    const quoteRequest = api.quotes.recordIncompleteWorkflow({
      tenantId: agency.id,
      customerId: customer.id,
      assetType: category.assetType,
      lineOfBusiness: category.lineOfBusiness,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: customer.name,
      contactEmail: customer.email,
      contactPhone: customer.phone,
      assetIdentifier: "123 Ocean Ave, Palm Beach, FL 33480",
      currentStep: "category questionnaire",
      completionPercent: 88,
      assignedAgentId: customer.assignedAgentId,
      createdById: "customer_demo",
      parsedData: {
        legalBusinessName: "Shoreline Grill LLC",
        alcoholSalesPercent: 35,
      },
    });

    const session = api.quoting.upsertCustomerIntakeSession({
      tenantId: agency.id,
      customerId: customer.id,
      quoteRequestId: quoteRequest.id,
      assetType: category.assetType,
      lineOfBusiness: category.lineOfBusiness,
      categoryId: category.id,
      categoryLabel: category.label,
      contactName: customer.name,
      address: "123 Ocean Ave, Palm Beach, FL 33480",
      assetDetails: {
        legalBusinessName: "Shoreline Grill LLC",
        alcoholSalesPercent: "35",
      },
      questionnaireAnswers: {
        legalBusinessName: "Shoreline Grill LLC",
        alcoholSalesPercent: "35",
      },
      assignedAgentId: customer.assignedAgentId,
      createdById: "customer_demo",
      status: "quote_started",
    });

    expect(api.quotes.get(quoteRequest.id)?.quoteSessionId).toBe(session.id);
    expect(session.questionnaireQuestions?.some((question) => /alcohol sales/i.test(question.label))).toBe(true);
    expect(session.questionnaireResponses?.[`category-${category.id}-legalBusinessName`]).toBe("Shoreline Grill LLC");

    const task = api.tasks.listByTenant(agency.id).find((row) => row.id === quoteRequest.recoveryTaskId);
    expect(task?.quoteSessionId).toBe(session.id);

    const note = api.notes.listByCustomer(customer.id).find((row) =>
      row.body.includes("Customer started quote flow")
    );
    expect(note?.body).toContain(category.label);
  });
});
