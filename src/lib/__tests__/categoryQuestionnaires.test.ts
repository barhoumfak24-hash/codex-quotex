import { beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

describe("category questionnaire templates", () => {
  it("keeps the primary home intake to homeowner-known essentials", async () => {
    const { api } = await import("../api");
    const { categoryQuestionnaire } = await import("../categoryQuestionnaires");

    const category = api.categories.get("cat_primary_home")!;
    const questions = categoryQuestionnaire(category);
    const keys = questions.map((question) => question.key);

    expect(keys).toContain("propertyAddress");
    expect(keys).toContain("occupancy");
    expect(keys).toContain("currentCoverage");
    expect(keys).toContain("targetEffectiveDate");
    expect(keys).not.toContain("priorLosses");
    expect(keys).not.toContain("nonPublicPropertyNotes");
    expect(keys).not.toContain("estimatedValue");
    expect(keys).not.toContain("yearBuilt");
    expect(keys).not.toContain("squareFootage");
    expect(keys).not.toContain("constructionType");
    expect(keys).not.toContain("roofAge");
    expect(keys).not.toContain("roofMaterial");
    expect(keys).not.toContain("floodZone");
    expect(keys).not.toContain("notes");
  });

  it("generates a public-data-oriented questionnaire for every active category", async () => {
    const { api } = await import("../api");
    const {
      categoryQuestionnaire,
      categoryQuestionPublicDataScore,
    } = await import("../categoryQuestionnaires");

    const categories = api.categories.listActive();
    expect(categories.length).toBeGreaterThan(100);
    const disallowedPublicDataKeys = new Set([
      "estimatedValue",
      "yearBuilt",
      "squareFootage",
      "constructionType",
      "roofAge",
      "roofMaterial",
      "floodZone",
      "distanceToWater",
      "year",
      "make",
      "model",
      "length",
      "dba",
      "fein",
      "riskAddress",
      "entityType",
      "yearsInBusiness",
      "employeeCount",
      "notes",
      "priorLosses",
      "nonPublicPropertyNotes",
      "nonPublicRiskNotes",
      "operationsNotObvious",
      "locationsNotInSearch",
      "protectionNotes",
      "professionalServicesNotObvious",
      "scheduleAndValues",
      "acreageOrAnimalNotes",
    ]);

    categories.forEach((category) => {
      const questions = categoryQuestionnaire(category);
      expect(questions.length).toBeGreaterThanOrEqual(3);
      expect(questions.length).toBeLessThanOrEqual(category.lineOfBusiness === "commercial" ? 9 : 8);
      expect(categoryQuestionPublicDataScore(category)).toBeGreaterThanOrEqual(70);
      expect(new Set(questions.map((question) => question.key)).size).toBe(questions.length);
      questions.forEach((question) => {
        expect(disallowedPublicDataKeys.has(question.key)).toBe(false);
      });
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
