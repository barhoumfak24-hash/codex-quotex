// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
      new Set(["126", "140"])
    );
    expect(acordQuestions.some((q) => q.acordFormNumber === "125")).toBe(false);
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
    ).toBe(false);
    expect(
      questions.some(
        (question) =>
          question.sourceDocumentId === acord125!.id &&
          /legal business name|primary contact|mailing address|business operations/i.test(
            question.label
          )
      )
    ).toBe(false);

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
});
