// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// AI quoting workspace: gathering_info → awaiting_reply → quoting →
// complete. Drives the per-prospect card that replaced "Quote data".
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
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
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      customerId: api.customers.list(agency.id)[0].id,
      createdById: agent.id,
      assetType: "luxury_vehicle",
      contactName: "Avery Stone",
      estimatedValue: 310000,
      address: "1 Ocean Drive, Palm Coast, FL 32137",
      assetDetails: {
        vin: "W1K6G7GB7RA123456",
        year: "2024",
        make: "Mercedes-Benz",
        model: "S 580",
        garagingAddress: "1 Ocean Drive, Palm Coast, FL 32137",
        annualMileage: "3500",
        primaryUse: "Pleasure",
      },
      lineOfBusiness: "personal",
    });

    expect(session.assetDetails?.vin).toBe("W1K6G7GB7RA123456");
    expect(session.publicFields["Year / make / model"]).toBe("2024 Mercedes-Benz S 580");
    expect(session.publicFields["VIN-decoded trim"]).toBe("W1K6G7GB7RA123456");
    expect(session.publicFields["Garaging address"]).toBe("1 Ocean Drive, Palm Coast, FL 32137");
    expect(session.missingFields).not.toContain("Annual mileage estimate");
    expect(session.missingFields).not.toContain("Primary use (pleasure / commute / business)");
    expect(session.aiSummary).toContain("agent-provided lookup");
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
    const roofMaterial = questions.find((question) => /roof material/i.test(question.label));

    expect(yearBuilt).toBeTruthy();
    expect(squareFootage).toBeTruthy();
    expect(roofMaterial).toBeTruthy();
    expect(session.questionnaireResponses?.[yearBuilt!.id]).toBe("2018");
    expect(session.questionnaireResponses?.[squareFootage!.id]).toBe("4200");
    expect(session.questionnaireResponses?.[roofMaterial!.id]).toBe("Metal");
    expect(session.questionnaireResponseMeta?.[yearBuilt!.id]?.updatedByRole).toBe("ai");
  });

  it("does not prefill estimate-only sweep answers as confirmed questionnaire responses", async () => {
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
    expect(expanded.missingFields).toEqual(
      expect.arrayContaining([yearBuilt!.label, squareFootage!.label])
    );
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
    expect(initial.personalQuestionnairePreparedAt).toBeUndefined();

    const prepared = api.quoting.preparePersonalQuestionnaire(initial.id)!;
    expect(prepared.personalQuestionnairePreparedAt).toBeTruthy();
    expect(prepared.questionnaireQuestions?.length).toBe(initial.questionnaireQuestions?.length);

    const steppedBack = api.quoting.stepBack(initial.id)!;
    expect(steppedBack.personalQuestionnairePreparedAt).toBeUndefined();
    expect(steppedBack.questionnaireQuestions?.length).toBe(initial.questionnaireQuestions?.length);
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
    expect(quote?.fitReason).toContain("carrier portal quote imported");
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
