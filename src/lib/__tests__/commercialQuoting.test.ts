// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// Commercial quoting flow. AI infers line of business from the
// contact name, generates one shared commercial intake, and ships
// it to the client through a portal link instead of an inline email
// body. Carrier-specific supplementals happen only after carrier
// replies request them.
// Submitting answers auto-fires the carrier ranking + an agent task.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("aiInferLineOfBusiness", () => {
  it("flags LLC / Inc / Corp suffixes as commercial", async () => {
    const { aiInferLineOfBusiness } = await import("../ai");
    expect(
      aiInferLineOfBusiness({
        contactName: "Acme Holdings LLC",
        assetType: "other",
      })
    ).toBe("commercial");
    expect(
      aiInferLineOfBusiness({
        contactName: "Bayside Ventures, Inc.",
        assetType: "other",
      })
    ).toBe("commercial");
  });

  it("treats individual names as personal", async () => {
    const { aiInferLineOfBusiness } = await import("../ai");
    expect(
      aiInferLineOfBusiness({
        contactName: "Jane Smith",
        assetType: "coastal_home",
        estimatedValue: 1_500_000,
      })
    ).toBe("personal");
  });
});

describe("commercial quoting session", () => {
  const commercialAnswers = {
    "base-legal-business-name-as-registered": "Coastal Logistics LLC",
    "base-federal-ein": "12-3456789",
    "base-business-operations-description": "Regional freight brokerage and warehouse support.",
    "base-annual-revenue": "2400000",
  };

  it("opens the most recently worked quote session for a customer", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const olderWorkedSession = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
    });
    await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: customer.name,
      estimatedValue: 1_000_000,
      lineOfBusiness: "personal",
    });

    db.update("quotingSessions", olderWorkedSession.id, {
      commercialApplicationSentAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    });

    expect(api.quoting.getForCustomer(customer.id)?.id).toBe(olderWorkedSession.id);
  });

  it("prepares the structured commercial questionnaire after the ACORD fill audit", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
    });
    expect(session.lineOfBusiness).toBe("commercial");
    expect(session.questionnaireQuestions ?? []).toHaveLength(0);
    expect(session.commercialQuestionnairePreparedAt).toBeUndefined();
    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    expect(prepared.commercialQuestionnairePreparedAt).toBeTruthy();
    expect((prepared.questionnaireQuestions ?? []).length).toBeGreaterThan(0);
    const questions = prepared.questionnaireQuestions ?? [];
    expect(questions.every((q) => !q.carrierId)).toBe(true);
    expect(new Set(questions.map((q) => q.section))).toEqual(new Set(["Base business intake"]));
  });

  it("prefills commercial questionnaire answers from verified AI/public data while keeping them editable", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
    });

    db.update("quotingSessions", initial.id, {
      publicFields: {
        "Legal business name (as registered)": "Coastal Logistics LLC",
        "Operating states": "FL, GA",
      },
      publicFieldEvidence: {
        "Legal business name (as registered)": {
          fieldKey: "Legal business name (as registered)",
          sourceKind: "government_api",
          sourceLabel: "Verified state business registry",
          confidence: 0.96,
          verified: true,
          allowDocumentAutofill: true,
          collectedAt: "2026-06-25T12:00:00.000Z",
        },
        "Operating states": {
          fieldKey: "Operating states",
          sourceKind: "government_api",
          sourceLabel: "Verified state business registry",
          confidence: 0.92,
          verified: true,
          allowDocumentAutofill: true,
          collectedAt: "2026-06-25T12:00:00.000Z",
        },
      },
    });

    const prepared = api.quoting.prepareCommercialQuestionnaire(initial.id)!;
    const legalName = prepared.questionnaireQuestions?.find((question) =>
      /legal business name/i.test(question.label)
    );
    const operatingStates = prepared.questionnaireQuestions?.find((question) =>
      /operating states/i.test(question.label)
    );

    expect(legalName).toBeTruthy();
    expect(operatingStates).toBeTruthy();
    expect(prepared.questionnaireResponses?.[legalName!.id]).toBe("Coastal Logistics LLC");
    expect(prepared.questionnaireResponses?.[operatingStates!.id]).toBe("FL, GA");
    expect(prepared.questionnaireResponseMeta?.[legalName!.id]?.updatedByRole).toBe("ai");
    expect(prepared.missingFields).not.toContain(legalName!.label);
    expect(prepared.missingFields).not.toContain(operatingStates!.label);
  });

  it("prefills source-backed web answers for review without writing them into ACORD until confirmed", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const template = api.documents
      .listTemplates(agency.id)
      .find((document) => document.documentName?.startsWith("ACORD 125"));
    expect(template).toBeTruthy();

    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [template!.id],
    });

    db.update("quotingSessions", initial.id, {
      publicFields: {
        "Business operations summary (2-3 sentences)":
          "Coastal logistics and private property management services.",
      },
      publicFieldEvidence: {
        "Business operations summary (2-3 sentences)": {
          fieldKey: "Business operations summary (2-3 sentences)",
          sourceKind: "public_web",
          sourceLabel: "Company website",
          confidence: 0.72,
          verified: false,
          allowDocumentAutofill: false,
          collectedAt: "2026-06-25T12:00:00.000Z",
        },
      },
    });

    const prepared = api.quoting.prepareCommercialQuestionnaire(initial.id)!;
    const operationsQuestion = prepared.questionnaireQuestions?.find((question) =>
      /business operations/i.test(question.label)
    );
    expect(operationsQuestion).toBeTruthy();
    expect(prepared.questionnaireResponses?.[operationsQuestion!.id]).toBe(
      "Coastal logistics and private property management services."
    );
    expect(prepared.questionnaireResponseMeta?.[operationsQuestion!.id]?.updatedByRole).toBe("ai");

    const aiOnlyDoc = api.documents
      .listByTenant(agency.id)
      .find(
        (document) =>
          document.quoteRequestId === initial.id &&
          document.type === "completed_acord_application" &&
          document.templateFields?.["Source ACORD template ID"] === template!.id
      );
    expect(
      Object.values(aiOnlyDoc?.templateFields ?? {}).some(
        (value) => value === "Coastal logistics and private property management services."
      )
    ).toBe(false);

    const confirmed = api.quoting.saveQuestionnaireResponses(
      initial.id,
      { [operationsQuestion!.id]: "Coastal logistics and private property management services." },
      { id: agent.id, name: agent.name, role: "agent" }
    );
    const confirmedDoc = api.documents
      .listByTenant(agency.id)
      .find(
        (document) =>
          document.quoteRequestId === initial.id &&
          document.type === "completed_acord_application" &&
          document.templateFields?.["Source ACORD template ID"] === template!.id
      );
    expect(confirmed?.questionnaireResponseMeta?.[operationsQuestion!.id]?.updatedByRole).toBe(
      "agent"
    );
    expect(
      Object.values(confirmedDoc?.templateFields ?? {}).some(
        (value) => value === "Coastal logistics and private property management services."
      )
    ).toBe(true);
  });

  it("stores multiple OpenAI research mappings in editable questionnaire boxes without address/name bleed", async () => {
    vi.resetModules();
    const ai = await import("../ai");
    const evidence = (fieldKey: string, sourceKind: "public_web" | "public_geocoder" = "public_web") => ({
      fieldKey,
      sourceKind,
      sourceLabel: sourceKind === "public_geocoder" ? "Verified public geocoder" : "OpenAI web research",
      confidence: sourceKind === "public_geocoder" ? 0.91 : 0.76,
      verified: sourceKind === "public_geocoder",
      allowDocumentAutofill: false,
      collectedAt: "2026-06-25T12:00:00.000Z",
      notes: "Source-backed answer for staff review only.",
    });
    const mapSpy = vi.spyOn(ai, "aiMapAcordFields").mockImplementation(async (input) => {
      const fieldId = (pattern: RegExp) =>
        input.fields.find((field) => pattern.test(field.label))?.id;
      const industryId = fieldId(/primary industry|naics/i);
      const operationsId = fieldId(/business operations/i);
      const propertyId = fieldId(/property location/i);
      return {
        fields: {
          "Industry code": "Real estate investment and property management / NAICS 531390",
          Operations: "Private property management and coastal portfolio administration.",
          "Named insured": "Coastal Logistics LLC",
          "Risk address": "901 McDonald Dr, Northville, MI 48167",
        },
        publicFieldEvidence: {
          "Industry code": evidence("Industry code"),
          Operations: evidence("Operations"),
          "Named insured": evidence("Named insured"),
          "Risk address": evidence("Risk address", "public_geocoder"),
        },
        mappings: [
          {
            targetId: industryId,
            targetField: "Industry code",
            value: "Real estate investment and property management / NAICS 531390",
            sourceLabel: "OpenAI web research",
            sourceKind: "public_web",
            confidence: 0.76,
            verified: false,
            rationale: "Public business profile.",
          },
          {
            targetId: operationsId,
            targetField: "Operations",
            value: "Private property management and coastal portfolio administration.",
            sourceLabel: "OpenAI web research",
            sourceKind: "public_web",
            confidence: 0.76,
            verified: false,
            rationale: "Public business profile.",
          },
          {
            targetId: propertyId,
            targetField: "Named insured",
            value: "Coastal Logistics LLC",
            sourceLabel: "OpenAI web research",
            sourceKind: "public_web",
            confidence: 0.76,
            verified: false,
            rationale: "Deliberate mismatch that must not fill the property question.",
          },
          {
            targetId: propertyId,
            targetField: "Risk address",
            value: "901 McDonald Dr, Northville, MI 48167",
            sourceLabel: "Verified public geocoder",
            sourceKind: "public_geocoder",
            confidence: 0.91,
            verified: true,
            rationale: "Verified address suggestion.",
          },
        ],
        missingFields: [],
        webSources: [],
        summary: "Mapped multiple review-only questionnaire fields.",
        confidence: 0.76,
      };
    });
    const { api } = await import("../api");
    const { db } = await import("../db");
    db.reset();
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.listByTenant(agency.id)[0];
    const template = api.documents
      .listTemplates(agency.id)
      .find((document) => document.documentName?.startsWith("ACORD 140"));
    expect(template).toBeTruthy();

    const initial = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [template!.id],
    });

    const mapped = await api.quoting.runAcordAiMapping(initial.id);
    const prepared = api.quoting.prepareCommercialQuestionnaire(initial.id)!;
    const industryQuestion = prepared.questionnaireQuestions?.find((question) =>
      /primary industry|naics/i.test(question.label)
    );
    const operationsQuestion = prepared.questionnaireQuestions?.find((question) =>
      /business operations/i.test(question.label)
    );
    const propertyQuestion = prepared.questionnaireQuestions?.find((question) =>
      /property location/i.test(question.label)
    );
    expect(mapSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "questionnaire_prefill",
        fields: expect.arrayContaining([
          expect.objectContaining({ label: expect.stringMatching(/property location/i) }),
        ]),
      })
    );
    expect(industryQuestion).toBeTruthy();
    expect(operationsQuestion).toBeTruthy();
    expect(propertyQuestion).toBeTruthy();
    expect(mapped?.questionnaireResponses?.[industryQuestion!.id]).toBe(
      "Real estate investment and property management / NAICS 531390"
    );
    expect(prepared.questionnaireResponses?.[industryQuestion!.id]).toBe(
      "Real estate investment and property management / NAICS 531390"
    );
    expect(prepared.questionnaireResponses?.[operationsQuestion!.id]).toBe(
      "Private property management and coastal portfolio administration."
    );
    expect(prepared.questionnaireResponses?.[propertyQuestion!.id]).toBe(
      "901 McDonald Dr, Northville, MI 48167"
    );
    expect(prepared.questionnaireResponses?.[propertyQuestion!.id]).not.toBe("Coastal Logistics LLC");
    expect(Object.keys(prepared.questionnaireResponses ?? {}).length).toBeGreaterThanOrEqual(3);
    expect(prepared.questionnaireResponseMeta?.[industryQuestion!.id]?.updatedByRole).toBe("ai");

    const aiOnlyDoc = api.documents
      .listByTenant(agency.id)
      .find(
        (document) =>
          document.quoteRequestId === initial.id &&
          document.type === "completed_acord_application" &&
          document.templateFields?.["Source ACORD template ID"] === template!.id
      );
    expect(
      Object.values(aiOnlyDoc?.templateFields ?? {}).some(
        (value) => value === "Real estate investment and property management / NAICS 531390"
      )
    ).toBe(false);
    expect(
      Object.values(aiOnlyDoc?.templateFields ?? {}).some(
        (value) => value === "901 McDonald Dr, Northville, MI 48167"
      )
    ).toBe(false);
  });

  it("commercial sessions can start from selected ACORD templates and ask only for remaining form fields", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const templateLibrary = api.documents.listTemplates(agency.id);
    const selectedTemplates = ["ACORD-125.pdf", "ACORD-126.pdf", "ACORD-140-Property.pdf"].map(
      (fileName) => {
        const template = templateLibrary.find((d) => d.fileName === fileName);
        expect(template).toBeTruthy();
        return template!;
      }
    );

    expect(selectedTemplates.length).toBeGreaterThan(0);

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: selectedTemplates.map((d) => d.id),
    });

    expect(session.commercialAcordTemplates?.map((t) => t.templateId)).toEqual(
      selectedTemplates.map((d) => d.id)
    );
    expect(
      session.commercialAcordTemplates?.every(
        (template) =>
          template.sourceCount &&
          template.candidateCount &&
          template.sourceFieldCounts &&
          Object.values(template.sourceFieldCounts).some((count) => count > 0)
      )
    ).toBe(true);
    expect(session.commercialAcordTemplates?.every((t) => t.downloadUrl?.startsWith("/acord/"))).toBe(
      true
    );
    expect(session.questionnaireQuestions ?? []).toHaveLength(0);
    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    expect(
      (prepared.questionnaireQuestions ?? []).some((q) =>
        q.section.toLowerCase().includes("acord fields")
      )
    ).toBe(true);
    const acordQuestions = (prepared.questionnaireQuestions ?? []).filter((q) =>
      q.section.toLowerCase().includes("acord fields")
    );
    expect(acordQuestions.every((q) => q.label.startsWith("ACORD"))).toBe(true);
    expect(acordQuestions.every((q) => q.sourceDocumentId && q.sourceDocumentFileName)).toBe(true);
    expect(acordQuestions.every((q) => q.acordFormNumber && q.acordFieldKey)).toBe(true);
    expect(acordQuestions.every((q) => (q.acordFieldLabels ?? []).length > 0)).toBe(true);
    expect(new Set(acordQuestions.map((q) => q.acordFormNumber))).toEqual(
      new Set(["125", "126", "140"])
    );
    expect(acordQuestions.some((q) => q.acordFormNumber === "125")).toBe(true);
    expect(acordQuestions.some((q) => q.acordFormNumber === "126")).toBe(true);
    expect(acordQuestions.some((q) => q.acordFormNumber === "140")).toBe(true);

    const initialFilledDocs = api.documents
      .listByTenant(agency.id)
      .filter(
        (document) =>
          document.quoteRequestId === session.id &&
          document.type === "completed_acord_application"
      );
    expect(initialFilledDocs.length).toBe(selectedTemplates.length);
    expect(
      initialFilledDocs.every(
        (document) =>
          document.fileType === "application/pdf" &&
          document.templateFields?.["Source ACORD template ID"] &&
          document.templateFields?.["ACORD PDF fill status"] &&
          document.templateFields?.["AI source field counts"] &&
          Number(document.templateFields?.["AI candidate field count"] ?? 0) > 0 &&
          Number(document.templateFields?.["Completed field count"] ?? 0) > 0
      )
    ).toBe(true);

    const editableAcordQuestion = acordQuestions.find(
      (question) => (question.acordFieldLabels ?? []).length > 0
    )!;
    const saved = api.quoting.saveQuestionnaireResponses(
      session.id,
      { [editableAcordQuestion.id]: "Agent-entered ACORD field value" },
      { id: agent.id, name: agent.name, role: "agent" }
    );
    const updatedTemplate = saved?.commercialAcordTemplates?.find(
      (template) => template.templateId === editableAcordQuestion.sourceDocumentId
    );
    expect(updatedTemplate?.sourceFieldCounts?.questionnaire ?? 0).toBeGreaterThan(0);
    const updatedFilledDoc = api.documents
      .listByTenant(agency.id)
      .find(
        (document) =>
          document.quoteRequestId === session.id &&
          document.type === "completed_acord_application" &&
          document.templateFields?.["Source ACORD template ID"] ===
            editableAcordQuestion.sourceDocumentId
      );
    expect(
      editableAcordQuestion.acordFieldLabels?.some(
        (fieldLabel) =>
          updatedFilledDoc?.templateFields?.[fieldLabel] ===
          "Agent-entered ACORD field value"
      )
    ).toBe(true);
    api.quoting.submitQuestionnaireResponses(
      session.id,
      { [editableAcordQuestion.id]: "Client-submitted ACORD field value" },
      { id: customer.userId, name: customer.name, role: "customer" }
    );
    const clientUpdatedFilledDoc = api.documents
      .listByTenant(agency.id)
      .find(
        (document) =>
          document.quoteRequestId === session.id &&
          document.type === "completed_acord_application" &&
          document.templateFields?.["Source ACORD template ID"] ===
            editableAcordQuestion.sourceDocumentId
      );
    expect(
      editableAcordQuestion.acordFieldLabels?.some(
        (fieldLabel) =>
          clientUpdatedFilledDoc?.templateFields?.[fieldLabel] ===
          "Client-submitted ACORD field value"
      )
    ).toBe(true);
    expect(
      api
        .customers
        .fullHistory(customer.id)
        .some(
          (event) =>
            event.source === "agent" &&
            /saved 1 quoting questionnaire answer/i.test(event.message)
        )
    ).toBe(true);
  });

  it("prefills selected ACORDs from existing Quotex agency, client, asset, and policy data before asking questions", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.customers.update(customer.id, {
      lineOfBusiness: "commercial",
      businessName: "Whitford Coastal Holdings LLC",
      operationsDescription: "Coastal property management and private collection logistics.",
      mailingAddress: "100 Ocean Drive, Palm Coast, FL 32137",
    });
    const updatedCustomer = api.customers.get(customer.id)!;
    const asset = api.assets.listByCustomer(customer.id)[0]!;
    const policy = api.policies.listByCustomer(customer.id).find((row) => row.assetId === asset.id)!;
    const templateLibrary = api.documents.listTemplates(agency.id);
    const acord36 = templateLibrary.find((d) => d.documentName?.startsWith("ACORD 36"));
    const acord125 = templateLibrary.find((d) => d.documentName?.startsWith("ACORD 125"));

    expect(acord36).toBeTruthy();
    expect(acord125).toBeTruthy();
    expect(policy.policyNumber).toBeTruthy();

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      createdById: agent.id,
      assetType: "other",
      contactName: updatedCustomer.name,
      address: updatedCustomer.mailingAddress,
      estimatedValue: asset.estimatedValue,
      assetDetails: {
        address: String(asset.details.address ?? updatedCustomer.mailingAddress),
      },
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [acord36!.id, acord125!.id],
    });

    expect(session.commercialAcordTemplates?.length).toBe(2);
    expect(
      session.commercialAcordTemplates?.every((template) => template.autoFilledFieldCount > 0)
    ).toBe(true);
    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    const questions = prepared.questionnaireQuestions ?? [];
    expect(
      questions.some(
        (question) =>
          question.sourceDocumentId === acord36!.id &&
          /policy number|effective date|expiration date/i.test(question.label)
      )
    ).toBe(true);
    expect(
      questions.some(
        (question) =>
          question.sourceDocumentId === acord125!.id &&
          /legal business name, entity type, FEIN, website, and years in business/i.test(
            question.label
          )
      )
    ).toBe(true);

    const completedDocuments = api.documents
      .listByTenant(agency.id)
      .filter(
        (document) =>
          document.quoteRequestId === session.id &&
          document.type === "completed_acord_application"
      );
    const completedFields = completedDocuments.reduce<Record<string, string>>(
      (fields, document) => ({ ...fields, ...(document.templateFields ?? {}) }),
      {}
    );

    expect(completedFields.Producer ?? completedFields.Agency).toBe(agency.name);
    expect(completedFields["Agency email"]).toBe(agency.contactEmail);
    expect(completedFields["Applicant name"]).toBe(updatedCustomer.name);
    expect(completedFields["Applicant email"]).toBe(updatedCustomer.email);
    expect(completedFields["Business legal name"]).toBe("Whitford Coastal Holdings LLC");
    expect(completedFields["Policy number"]).toBe(policy.policyNumber);
    expect(completedFields["Mailing address"]).toBe("100 Ocean Drive, Palm Coast, FL 32137");
  });

  it("does not put property addresses or person names into unrelated ACORD questionnaire fields", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const acord125 = api.documents
      .listTemplates(agency.id)
      .find((d) => d.documentName?.startsWith("ACORD 125"));

    expect(acord125).toBeTruthy();

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Alexandra Whitford",
      address: "123 Main St, Northville, MI 48167",
      estimatedValue: 1_000_000,
      assetDetails: {
        propertyAddress: "123 Main St, Northville, MI 48167",
      },
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [acord125!.id],
    });

    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    const responses = prepared.questionnaireResponses ?? {};
    const questions = prepared.questionnaireQuestions ?? [];
    const legalName = questions.find((question) =>
      /legal business name \(as registered\)/i.test(question.label)
    );
    const operations = questions.find((question) =>
      /business operations, products, services, and locations/i.test(question.label)
    );
    const exposures = questions.find((question) =>
      /annual revenue, payroll, employee count, locations, and operating states/i.test(
        question.label
      )
    );

    expect(legalName).toBeTruthy();
    expect(operations).toBeTruthy();
    expect(exposures).toBeTruthy();
    expect(responses[legalName!.id]).toBeUndefined();
    expect(responses[operations!.id]).toBeUndefined();
    expect(responses[exposures!.id]).toBeUndefined();
  });

  it("has tailored ACORD questions for every bundled ACORD template", async () => {
    const { api } = await import("../api");
    const { buildAcordQuestionsForTemplate } = await import("../acordQuestionnaires");
    const agency = api.agencies.list()[0];
    const templates = api.documents
      .listTemplates(agency.id)
      .filter((d) => /acord/i.test(`${d.fileName} ${d.documentName ?? ""}`));

    expect(templates.length).toBe(41);
    templates.forEach((template) => {
      const questions = buildAcordQuestionsForTemplate(
        {
          templateId: template.id,
          fileName: template.fileName,
          documentName: template.documentName,
        },
        { publicFields: {}, assetDetails: {} }
      );
      expect(questions.length).toBeGreaterThanOrEqual(4);
      expect(questions.every((question) => question.sourceDocumentId === template.id)).toBe(true);
      expect(questions.every((question) => question.acordFormNumber)).toBe(true);
      expect(questions.every((question) => (question.acordFieldLabels ?? []).length > 0)).toBe(true);
      expect(questions.some((question) => !/remaining applicant details/i.test(question.label))).toBe(true);
    });
  });

  it("startSession honors the agent-selected line of business", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Jane Smith",
      estimatedValue: 1_500_000,
      lineOfBusiness: "commercial",
    });
    expect(session.lineOfBusiness).toBe("commercial");
    expect(session.questionnaireQuestions ?? []).toHaveLength(0);
    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    expect((prepared.questionnaireQuestions ?? []).every((q) => !q.carrierId)).toBe(true);
  });

  it("sendPortalLink writes an outbound email with the portal URL", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Acme LLC",
      estimatedValue: 1_500_000,
    });
    const updated = api.quoting.sendPortalLink(
      session.id,
      "https://app.example/customer/questionnaire/abc"
    );
    expect(updated?.status).toBe("awaiting_reply");
    expect((updated?.questionnaireQuestions ?? []).length).toBeGreaterThan(0);
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === updated?.questionnaireMessageId);
    expect(comm?.body).toContain("https://app.example/customer/questionnaire/abc");
    expect(comm?.subject).toMatch(/questionnaire/i);
  });

  it("personal-lines sessions also get a structured portal questionnaire", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "coastal_home",
      contactName: "Jane Doe",
      estimatedValue: 1_500_000,
    });
    expect(session.lineOfBusiness).toBe("personal");
    expect((session.questionnaireQuestions ?? []).length).toBeGreaterThan(0);
    // Every personal question carries the asset-type section header.
    (session.questionnaireQuestions ?? []).forEach((q) => {
      expect(q.section).toContain(session.assetType.replace(/_/g, " "));
    });
  });

  it("sendPortalLink works for personal sessions too", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: "John Smith",
      estimatedValue: 250_000,
    });
    const updated = api.quoting.sendPortalLink(
      session.id,
      "https://app.example/customer/questionnaire/abc"
    );
    expect(updated?.status).toBe("awaiting_reply");
    const comm = api.communications
      .listByTenant(agency.id)
      .find((c) => c.id === updated?.questionnaireMessageId);
    expect(comm?.body).toContain("https://app.example/customer/questionnaire/abc");
  });

  it("recommends commercial-ready carriers in AI leaderboard order with underwriters on file", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
    });

    const recommendations = api.quoting.recommendCommercialCarriers(
      session.id,
      commercialAnswers
    );

    expect(recommendations.length).toBeGreaterThan(2);
    expect(recommendations.map((row) => row.rank)).toEqual(
      recommendations.map((_, index) => index + 1)
    );
    recommendations.forEach((row, index) => {
      if (index > 0) expect(row.score).toBeLessThanOrEqual(recommendations[index - 1].score);
    });
    const ready = recommendations.filter((row) => !row.disabledReason);
    expect(ready.length).toBeGreaterThan(1);
    expect(
      ready.every((row) => row.underwriterContacts.length > 0 || row.automationAvailable)
    ).toBe(true);
    expect(ready.every((row) => /underwriter|portal runner/i.test(row.aiRationale))).toBe(true);
  });

  it("sends a commercial application only to selected carriers with underwriter emails", async () => {
    const { api } = await import("../api");
    const { splitEmailSignatureBody } = await import("../emailSignature");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.users.update(agent.id, {
      emailSignature: "Olivia Marsh\nPrivate Client Advisor",
    });
    const customer = api.customers.list(agency.id)[0];
    const selectedAcordTemplates = api.documents
      .listTemplates(agency.id)
      .filter((d) => /acord/i.test(`${d.fileName} ${d.documentName ?? ""}`))
      .slice(0, 2);
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: selectedAcordTemplates.map((template) => template.id),
    });
    const selectedRecommendations = api.quoting
      .recommendCommercialCarriers(session.id, commercialAnswers)
      .filter((row) => row.underwriterContacts.some((contact) => !!contact.email))
      .slice(0, 2);
    const selectedCarrierIds = selectedRecommendations.map((row) => row.carrierId);

    expect(selectedCarrierIds.length).toBe(2);
    const previewDrafts = api.quoting.previewCommercialCarrierEmails(
      session.id,
      commercialAnswers,
      "application",
      selectedCarrierIds
    );
    expect(previewDrafts.length).toBeGreaterThan(0);
    expect(
      previewDrafts.every((draft) =>
        draft.attachments.every(
          (attachment) =>
            attachment.documentId !== attachment.sourceDocumentId &&
            /completed/i.test(attachment.fileName) &&
            attachment.fileType === "application/pdf"
        )
      )
    ).toBe(true);
    const beforeComms = api.communications.listByTenant(agency.id).length;
    const submitted = api.quoting.submitQuestionnaireResponses(
      session.id,
      commercialAnswers,
      { id: agent.id, name: agent.name, role: "agent" },
      {
        selectedCommercialCarrierIds: selectedCarrierIds,
        commercialCarrierEmailDrafts: previewDrafts,
      }
    );

    expect(submitted?.commercialApplicationSentAt).toBeTruthy();
    expect(submitted?.commercialCarrierSubmissions?.map((row) => row.carrierId).sort()).toEqual(
      [...selectedCarrierIds].sort()
    );
    expect(
      submitted?.commercialCarrierSubmissions?.every(
        (row) => row.submissionMethod === "underwriter_email" && row.underwriterContactIds?.length
      )
    ).toBe(true);
    expect(
      submitted?.commercialCarrierSubmissions?.every(
        (row) => row.status === "accepted" && row.responseAt
      )
    ).toBe(true);
    const applicationMessageIds = (submitted?.commercialCarrierSubmissions ?? []).flatMap(
      (row) => row.applicationMessageIds ?? []
    );
    const expectedEmailCount = selectedRecommendations.reduce(
      (sum, row) => sum + row.underwriterContacts.length,
      0
    );
    expect(applicationMessageIds.length).toBe(expectedEmailCount);
    const createdComms = api.communications
      .listByTenant(agency.id)
      .filter((comm) => applicationMessageIds.includes(comm.id));
    expect(createdComms.length).toBe(applicationMessageIds.length);
    expect(
      createdComms.every((comm) => comm.carrierContactId && comm.direction === "outbound")
    ).toBe(true);
    expect(
      createdComms.every((comm) => {
        const parsed = splitEmailSignatureBody(comm.body);
        return (
          /^Hi\s+.+,/i.test(parsed.message) &&
          !/\bAI\b|Quotex/i.test(parsed.message) &&
          !/Coastal Logistics/i.test(parsed.message) &&
          !/Underwriting summary|Application answers|Exposure \/ asset|Estimated exposure|Line:/i.test(
            parsed.message
          ) &&
          parsed.signature?.text === "Olivia Marsh\nPrivate Client Advisor"
        );
      })
    ).toBe(true);
    expect(
      createdComms.every(
        (comm) =>
          (comm.attachments ?? []).length === selectedAcordTemplates.length &&
          (comm.attachments ?? []).every((attachment) =>
            selectedAcordTemplates.some((template) => template.id === attachment.sourceDocumentId) &&
            /completed/i.test(attachment.fileName) &&
            (attachment.filledFieldCount ?? 0) > 0 &&
            (attachment.fieldMappings ?? []).length === attachment.filledFieldCount
          )
      )
    ).toBe(true);
    const completedDocumentIds = new Set(
      createdComms.flatMap((comm) => comm.attachments ?? []).map((attachment) => attachment.documentId)
    );
    expect(completedDocumentIds.size).toBe(selectedAcordTemplates.length);
    const completedDocuments = api.documents
      .listByTenant(agency.id)
      .filter((document) => completedDocumentIds.has(document.id));
    expect(completedDocuments.length).toBe(selectedAcordTemplates.length);
    expect(completedDocuments.every((document) => document.type === "completed_acord_application")).toBe(true);
    expect(
      completedDocuments.every(
        (document) =>
          document.quoteRequestId === submitted?.id &&
          document.templateFields?.["Source ACORD template ID"] &&
          Number(document.templateFields?.["Completed field count"] ?? 0) > 0
      )
    ).toBe(true);
    expect(
      submitted?.commercialCarrierSubmissions?.every(
        (row) =>
          (row.applicationDocumentIds ?? []).length === selectedAcordTemplates.length &&
          (row.applicationDocumentIds ?? []).every((documentId) => completedDocumentIds.has(documentId))
      )
    ).toBe(true);
    const carrierEmailTimelineEvents = api
      .customers
      .fullHistory(customer.id)
      .filter((event) => /ACORD application packet emailed/i.test(event.message));
    expect(carrierEmailTimelineEvents.length).toBe(applicationMessageIds.length);
    expect(
      carrierEmailTimelineEvents.every(
        (event) =>
          event.source === "agent" &&
          !!event.communicationId &&
          applicationMessageIds.includes(event.communicationId) &&
          !!event.documentId
      )
    ).toBe(true);
    expect(api.communications.listByTenant(agency.id).length - beforeComms).toBe(
      applicationMessageIds.length
    );
    const applicationSummaryEvent = api
      .status
      .listFor({ customerId: customer.id })
      .find((event) => /Commercial application packet sent to/i.test(event.message));
    expect(applicationSummaryEvent?.communicationId).toBeTruthy();
    expect(applicationMessageIds).toContain(applicationSummaryEvent?.communicationId);
    expect(applicationSummaryEvent?.documentId).toBeTruthy();
    expect(submitted?.quotes.map((quote) => quote.carrierId).sort()).toEqual(
      [...selectedCarrierIds].sort()
    );
  });

  it("sends supplemental packages only to carriers that requested missing information", async () => {
    const { api } = await import("../api");
    const { splitEmailSignatureBody } = await import("../emailSignature");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    api.users.update(agent.id, {
      emailSignature: "Olivia Marsh\nPrivate Client Advisor",
    });
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Coastal Logistics LLC",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
    });
    const selectedCarrierIds = api.quoting
      .recommendCommercialCarriers(session.id, commercialAnswers)
      .filter((row) => row.underwriterContacts.some((contact) => !!contact.email))
      .slice(0, 4)
      .map((row) => row.carrierId);
    expect(selectedCarrierIds.length).toBeGreaterThanOrEqual(3);
    const applicationDrafts = api.quoting.previewCommercialCarrierEmails(
      session.id,
      commercialAnswers,
      "application",
      selectedCarrierIds
    );
    expect(applicationDrafts.length).toBeGreaterThan(0);

    const submitted = api.quoting.submitQuestionnaireResponses(
      session.id,
      commercialAnswers,
      { id: agent.id, name: agent.name, role: "agent" },
      {
        selectedCommercialCarrierIds: selectedCarrierIds,
        commercialCarrierEmailDrafts: applicationDrafts,
      }
    );
    const supplementalCarrierIds = new Set(
      (submitted?.commercialCarrierSubmissions ?? [])
        .filter((submission) => submission.status === "needs_client_info")
        .map((submission) => submission.carrierId)
    );
    expect(supplementalCarrierIds.size).toBeGreaterThan(0);

    const secondRound = (submitted?.questionnaireQuestions ?? []).filter(
      (question) => question.round === "second_round"
    );
    const secondRoundAnswers = Object.fromEntries(
      secondRound.map((question) => [question.id, "Confirmed supplemental answer"])
    );
    const beforeComms = api.communications.listByTenant(agency.id).length;
    const final = api.quoting.submitQuestionnaireResponses(
      session.id,
      secondRoundAnswers,
      { id: agent.id, name: agent.name, role: "agent" }
    );
    const supplementalSubmissions = (final?.commercialCarrierSubmissions ?? []).filter(
      (submission) => (submission.supplementalMessageIds ?? []).length > 0
    );
    expect(supplementalSubmissions.length).toBe(supplementalCarrierIds.size);
    expect(
      supplementalSubmissions.every((submission) =>
        supplementalCarrierIds.has(submission.carrierId)
      )
    ).toBe(true);
    const supplementalMessageIds = supplementalSubmissions.flatMap(
      (submission) => submission.supplementalMessageIds ?? []
    );
    const supplementalMessages = api.communications
      .listByTenant(agency.id)
      .filter((comm) => supplementalMessageIds.includes(comm.id));
    expect(supplementalMessages.length).toBe(supplementalMessageIds.length);
    expect(api.communications.listByTenant(agency.id).length - beforeComms).toBe(
      supplementalMessageIds.length
    );
    expect(
      supplementalMessages.every((comm) => {
        const parsed = splitEmailSignatureBody(comm.body);
        return (
          comm.carrierContactId &&
          comm.direction === "outbound" &&
          /supplemental PDF|supplemental document/i.test(parsed.message) &&
          !/\bAI\b|Quotex/i.test(parsed.message) &&
          parsed.signature?.text === "Olivia Marsh\nPrivate Client Advisor"
        );
      })
    ).toBe(true);
    const supplementalTimelineEvents = api
      .customers
      .fullHistory(customer.id)
      .filter((event) => /ACORD supplemental packet emailed/i.test(event.message));
    expect(supplementalTimelineEvents.length).toBe(supplementalMessageIds.length);
    expect(
      supplementalTimelineEvents.every(
        (event) =>
          event.source === "agent" &&
          !!event.communicationId &&
          supplementalMessageIds.includes(event.communicationId)
      )
    ).toBe(true);
  });

  it("submitQuestionnaireResponses shows accepted rankings during second-round supplementals", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Acme LLC",
      estimatedValue: 1_500_000,
    });
    api.quoting.sendPortalLink(session.id, "https://example/link");
    const tasksBefore = api.tasks.listByTenant(agency.id).length;
    const submitted = api.quoting.submitQuestionnaireResponses(session.id, {
      "base-legal-business-name-as-registered": "Acme Logistics LLC",
      "base-federal-ein": "12-3456789",
    });
    expect(submitted?.status).toBe("awaiting_reply");
    expect(submitted?.commercialApplicationSentAt).toBeTruthy();
    expect(submitted?.commercialSecondRoundSentAt).toBeTruthy();
    expect(submitted?.questionnaireResponses?.["base-federal-ein"]).toBe("12-3456789");
    expect(api.tasks.listByTenant(agency.id).length).toBeGreaterThan(tasksBefore);
    const supplementalTask = api.tasks
      .listByTenant(agency.id)
      .find((task) => task.activityKey === `quote-session:${session.id}:supplemental_pending`);
    expect(supplementalTask?.assignedToId).toBe(agent.id);
    expect(supplementalTask?.status).toBe("open");
    expect(submitted?.quotes.length).toBeGreaterThan(0);
    const initiallyAcceptedIds = new Set(
      (submitted?.commercialCarrierSubmissions ?? [])
        .filter((s) => s.status === "accepted" || s.status === "supplemental_sent")
        .map((s) => s.carrierId)
    );
    const initiallyWaitingIds = new Set(
      (submitted?.commercialCarrierSubmissions ?? [])
        .filter((s) => s.status === "needs_client_info")
        .map((s) => s.carrierId)
    );
    expect(initiallyAcceptedIds.size).toBeGreaterThan(0);
    expect(initiallyWaitingIds.size).toBeGreaterThan(0);
    expect(submitted?.quotes.every((q) => initiallyAcceptedIds.has(q.carrierId))).toBe(true);
    expect(submitted?.quotes.some((q) => initiallyWaitingIds.has(q.carrierId))).toBe(false);

    const secondRound = (submitted?.questionnaireQuestions ?? []).filter(
      (q) => q.round === "second_round"
    );
    expect(secondRound.length).toBeGreaterThan(0);
    const secondRoundAnswers = Object.fromEntries(
      secondRound.map((q) => [q.id, "Confirmed supplemental answer"])
    );
    const final = api.quoting.submitQuestionnaireResponses(session.id, secondRoundAnswers);
    expect(final?.status).toBe("complete");
    expect(final?.replyReceivedAt).toBeTruthy();
    expect(final?.commercialSupplementalsCompletedAt).toBeTruthy();
    expect(final?.quotes.length).toBeGreaterThan(0);
    const acceptedIds = new Set(
      (final?.commercialCarrierSubmissions ?? [])
        .filter((s) => s.status === "accepted" || s.status === "supplemental_sent")
        .map((s) => s.carrierId)
    );
    expect(final?.quotes.every((q) => acceptedIds.has(q.carrierId))).toBe(true);
    expect(acceptedIds.size).toBeGreaterThanOrEqual(initiallyAcceptedIds.size);
    const tasksAfter = api.tasks.listByTenant(agency.id);
    const resolvedSupplemental = tasksAfter.find(
      (task) => task.activityKey === `quote-session:${session.id}:supplemental_pending`
    );
    expect(resolvedSupplemental?.status).toBe("resolved");
    expect(resolvedSupplemental?.completedAt).toBeTruthy();
    expect(
      tasksAfter.some(
        (task) => task.activityKey === `quote-session:${session.id}:quote_ready` && task.status !== "resolved"
      )
    ).toBe(false);
    const readyNotification = api.aiNotifications
      .listUnacked(agency.id)
      .find(
        (notification) => notification.kind === "quote_ready" && notification.quoteSessionId === session.id
      );
    expect(readyNotification?.assignedToId).toBe(agent.id);
    expect(readyNotification?.title).toContain("quote options ready");
    expect(api.aiNotifications.acknowledge(readyNotification!.id, agent.id)).toBeNull();
  });

  it("does not create a new supplemental round when an incomplete supplemental is sent anyway", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "Acme LLC",
      estimatedValue: 1_500_000,
      lineOfBusiness: "commercial",
    });

    const submitted = api.quoting.submitQuestionnaireResponses(session.id, {
      "base-legal-business-name-as-registered": "Acme Logistics LLC",
      "base-federal-ein": "12-3456789",
    });
    const originalSecondRound = (submitted?.questionnaireQuestions ?? []).filter(
      (question) => question.round === "second_round"
    );
    expect(submitted?.status).toBe("awaiting_reply");
    expect(originalSecondRound.length).toBeGreaterThan(0);

    const final = api.quoting.submitQuestionnaireResponses(
      session.id,
      {},
      { id: agent.id, name: agent.name, role: "agent" }
    );
    const finalSecondRound = (final?.questionnaireQuestions ?? []).filter(
      (question) => question.round === "second_round"
    );

    expect(final?.status).toBe("complete");
    expect(final?.commercialSupplementalsCompletedAt).toBeTruthy();
    expect(finalSecondRound).toHaveLength(originalSecondRound.length);
    expect(
      (final?.commercialCarrierSubmissions ?? []).some(
        (submission) => submission.status === "needs_client_info"
      )
    ).toBe(false);
    expect(final?.quotes.length).toBeGreaterThan(0);
  });

  it("prefills commercial profile business name and contact details without using numeric placeholders", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.list(agency.id)[0];
    api.customers.update(customer.id, {
      lineOfBusiness: "commercial",
      businessName: "Coastal Logistics LLC",
      name: "Alexandra Whitford",
      email: "alexandra@coastallogistics.example",
      phone: "517-294-2671",
    });
    const template = api.documents
      .listTemplates(agency.id)
      .find((document) => document.documentName?.startsWith("ACORD 125"));
    expect(template).toBeTruthy();

    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: customer.id,
      createdById: agent.id,
      assetType: "other",
      contactName: "2345",
      estimatedValue: 2_500_000,
      lineOfBusiness: "commercial",
      selectedAcordTemplateIds: [template!.id],
    });
    const prepared = api.quoting.prepareCommercialQuestionnaire(session.id)!;
    const legalName = prepared.questionnaireQuestions?.find((question) =>
      /legal business name/i.test(question.label)
    );
    const contactInfo = prepared.questionnaireQuestions?.find((question) =>
      question.id === "contact_information" || /primary contact.*phone.*email/i.test(question.label)
    );
    const acordBusinessIdentity = prepared.questionnaireQuestions?.find((question) =>
      /ACORD 125: Legal business name, entity type/i.test(question.label)
    );

    expect(legalName).toBeTruthy();
    expect(contactInfo).toBeTruthy();
    expect(acordBusinessIdentity).toBeTruthy();
    expect(prepared.questionnaireResponses?.[legalName!.id]).toBe("Coastal Logistics LLC");
    expect(prepared.questionnaireResponses?.[legalName!.id]).not.toBe("2345");
    expect(prepared.questionnaireResponses?.[acordBusinessIdentity!.id]).toContain(
      "Legal business name: Coastal Logistics LLC"
    );
    expect(prepared.questionnaireResponses?.[contactInfo!.id]).toContain("Alexandra Whitford");
    expect(prepared.questionnaireResponses?.[contactInfo!.id]).toContain("517-294-2671");
    expect(prepared.questionnaireResponses?.[contactInfo!.id]).toContain(
      "alexandra@coastallogistics.example"
    );
  });
});
