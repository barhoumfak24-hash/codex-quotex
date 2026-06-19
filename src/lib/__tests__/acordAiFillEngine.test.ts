import { describe, expect, it } from "vitest";
import { fillAcordFromClientDossier } from "../acordAiFillEngine";
import type {
  Agency,
  Asset,
  Carrier,
  Claim,
  Communication,
  CustomerProfile,
  Document,
  Note,
  Policy,
  QuotingQuestion,
  QuotingSession,
} from "@/types";

describe("fillAcordFromClientDossier", () => {
  it("fills original ACORD field labels from the full client dossier and fits long values", () => {
    const agency = {
      id: "agency_demo",
      name: "Palm Coast Private Client",
      contactEmail: "service@palmcoast.example",
      phone: "(555) 100-2000",
      address: "900 Agency Row, Palm Coast, FL 32137",
      website: "https://palmcoast.example",
    } as Agency;
    const contact: CustomerProfile = {
      id: "customer_demo",
      tenantId: agency.id,
      userId: "user_customer_demo",
      lineOfBusiness: "commercial",
      businessName: "Whitford Coastal Holdings LLC",
      operationsDescription:
        "Regional yacht charter management, coastal property holdings, and high-value collection logistics across Florida.",
      name: "Alexandra Whitford",
      email: "alexandra@example.com",
      phone: "(555) 902-7788",
      mailingAddress: "100 Ocean Drive, Palm Coast, FL 32137",
      marketingOptInEmail: true,
      marketingOptInSms: false,
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const asset: Asset = {
      id: "asset_property",
      tenantId: agency.id,
      customerId: contact.id,
      type: "other",
      label: "Palm Coast warehouse",
      estimatedValue: 4_250_000,
      details: {
        address: "12 Harbor Logistics Way, Palm Coast, FL 32137",
        construction: "Masonry non-combustible",
        yearBuilt: "2021",
      },
      status: "insured",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const carrier: Carrier = {
      id: "carrier_chubb",
      name: "Chubb Masterpiece",
      preferredAssetTypes: ["other"],
      stateAvailability: ["FL"],
      status: "active",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const policy: Policy = {
      id: "policy_chubb",
      tenantId: agency.id,
      customerId: contact.id,
      assetId: asset.id,
      carrierId: carrier.id,
      policyNumber: "PCP-2026-4471",
      effectiveDate: "2026-06-01",
      renewalDate: "2027-06-01",
      finalPremium: 12850,
      status: "bound",
      renewalStatus: "not_due",
      department: "commercial",
      coverages: [{ name: "General Liability", limit: 2_000_000, deductible: 2_500 }],
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const claim: Claim = {
      id: "claim_old",
      tenantId: agency.id,
      customerId: contact.id,
      policyId: policy.id,
      carrierId: carrier.id,
      externalClaimNumber: "CL-1088",
      lossDescription: "Minor water intrusion after storm.",
      lossAmountUsd: 8400,
      status: "closed",
      openedAt: "2025-09-10",
      closedAt: "2025-10-01",
    };
    const templateDocument = {
      id: "doc_acord_125",
      tenantId: agency.id,
      uploadedById: "agent_demo",
      fileName: "ACORD-125.pdf",
      fileType: "application/pdf",
      documentName: "ACORD 125 - Commercial Insurance Application",
      type: "agency_template",
      visibility: "employee_only",
      status: "approved",
      storagePath: "/acord/ACORD-125.pdf",
      downloadUrl: "/acord/ACORD-125.pdf",
      templateFields: {
        "Inspection contact": "Nina Brooks",
      },
      uploadedAt: "2026-06-15T12:00:00.000Z",
    } as Document;
    const note: Note = {
      id: "note_demo",
      tenantId: agency.id,
      authorId: "agent_demo",
      customerId: contact.id,
      body: "Client prefers carriers that can review yacht and commercial property together.",
      visibility: "internal",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const communication: Communication = {
      id: "comm_demo",
      tenantId: agency.id,
      customerId: contact.id,
      channel: "email",
      direction: "inbound",
      body: "Please include the updated warehouse sprinkler notes.",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const question: QuotingQuestion = {
      id: "q_revenue",
      section: "ACORD fields",
      label: "Annual revenue",
      kind: "text",
      required: true,
      acordFieldLabels: ["Annual revenue"],
    };
    const session: QuotingSession = {
      id: "quote_demo",
      tenantId: agency.id,
      customerId: contact.id,
      assetId: asset.id,
      assetType: "other",
      estimatedValue: asset.estimatedValue,
      assetDetails: {
        address: String(asset.details.address),
      },
      state: "FL",
      lineOfBusiness: "commercial",
      commercialAcordTemplates: [],
      questionnaireQuestions: [question],
      questionnaireResponses: { [question.id]: "$4,800,000" },
      createdById: "agent_demo",
      status: "gathering_info",
      publicFields: {
        "Federal EIN": "12-3456789",
      },
      publicFieldEvidence: {
        "Federal EIN": {
          fieldKey: "Federal EIN",
          sourceKind: "client_intake",
          sourceLabel: "Client quote intake",
          confidence: 0.92,
          verified: true,
          allowDocumentAutofill: true,
          collectedAt: "2026-06-15T12:00:00.000Z",
        },
      },
      missingFields: [],
      quotes: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
    };

    const result = fillAcordFromClientDossier({
      template: {
        templateId: templateDocument.id,
        fileName: templateDocument.fileName,
        documentName: templateDocument.documentName,
      },
      dossier: {
        agency,
        contact,
        assets: [asset],
        policies: [policy],
        carriers: [carrier],
        claims: [claim],
        documents: [templateDocument],
        notes: [note],
        communications: [communication],
        session,
        questions: [question],
        responses: session.questionnaireResponses ?? {},
        templateDocument,
      },
      layout: [
        { label: "Producer", page: 1, x: 10, y: 4, width: 30, height: 2, required: true },
        { label: "Producer contact", page: 1, x: 10, y: 7, width: 30, height: 2 },
        { label: "Producer phone", page: 1, x: 45, y: 4, width: 18, height: 2, required: true },
        { label: "Producer email", page: 1, x: 45, y: 7, width: 24, height: 2, required: true },
        { label: "Agency phone", page: 1, x: 10, y: 8, width: 18, height: 2, required: true },
        { label: "Agency fax", page: 1, x: 30, y: 8, width: 18, height: 2 },
        { label: "Secondary email", page: 1, x: 50, y: 8, width: 24, height: 2 },
        { label: "Business legal name", page: 1, x: 10, y: 10, width: 30, height: 2, required: true },
        { label: "Property address", page: 1, x: 10, y: 13, width: 40, height: 2, required: true },
        { label: "Annual revenue", page: 1, x: 10, y: 16, width: 20, height: 2, required: true },
        { label: "Policy number", page: 1, x: 10, y: 19, width: 20, height: 2, required: true },
        { label: "Inspection contact", page: 1, x: 10, y: 22, width: 20, height: 2, required: true },
        { label: "Description of operations", page: 1, x: 10, y: 25, width: 8, height: 1, required: true },
      ],
      kind: "application",
    });

    expect(result.fields["Producer"]).toBe("Palm Coast Private Client");
    expect(result.fields["Producer contact"]).toBeUndefined();
    expect(result.fields["Producer"]).not.toContain("service@palmcoast.example");
    expect(result.fields["Producer"]).not.toContain("(555) 100-2000");
    expect(result.fields["Producer phone"]).toBe("(555) 100-2000");
    expect(result.fields["Producer email"]).toBe("service@palmcoast.example");
    expect(result.fields["Agency phone"]).toBe("(555) 100-2000");
    expect(result.fields["Agency fax"]).toBeUndefined();
    expect(result.fields["Secondary email"]).toBeUndefined();
    expect(result.fields["Business legal name"]).toBe("Whitford Coastal Holdings LLC");
    expect(result.fields["Property address"]).toContain("Harbor Logistics");
    expect(result.fields["Annual revenue"]).toBe("$4,800,000");
    expect(result.fields["Policy number"]).toBe("PCP-2026-4471");
    expect(result.fields["Inspection contact"]).toBe("Nina Brooks");
    expect(result.fields["Description of operations"].length).toBeLessThanOrEqual(12);
    expect(result.audit.fittedFieldCount).toBe(9);
    expect(result.audit.overflowFieldCount).toBeGreaterThan(0);
    expect(result.audit.sourcesUsed).toEqual(
      expect.arrayContaining(["contact", "asset_detail", "questionnaire", "system"])
    );
    expect(result.missingFieldLabels).toEqual([]);
  });

  it("does not reuse stale generated ACORD fields or spread grouped questionnaire answers into unrelated boxes", () => {
    const agency = {
      id: "agency_demo",
      name: "Palm Coast Private Client",
      contactEmail: "service@palmcoast.example",
      phone: "(555) 100-2000",
      address: "900 Agency Row, Palm Coast, FL 32137",
    } as Agency;
    const contact: CustomerProfile = {
      id: "customer_demo",
      tenantId: agency.id,
      userId: "user_customer_demo",
      lineOfBusiness: "commercial",
      businessName: "Whitford Coastal Holdings LLC",
      name: "Alexandra Whitford",
      email: "alexandra@example.com",
      phone: "(555) 902-7788",
      mailingAddress: "100 Ocean Drive, Palm Coast, FL 32137",
      marketingOptInEmail: true,
      marketingOptInSms: false,
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const producerQuestion: QuotingQuestion = {
      id: "q_producer",
      section: "ACORD fields",
      label: "ACORD 125: Producer contact, phone, email, and agency customer number",
      kind: "textarea",
      required: false,
      acordFieldLabels: ["Producer", "Producer contact", "Agency phone", "Agency email", "Agency customer ID"],
    };
    const businessIdentityQuestion: QuotingQuestion = {
      id: "q_business_identity",
      section: "ACORD fields",
      label: "ACORD 125: Legal business name, entity type, FEIN, website, and years in business",
      kind: "textarea",
      required: true,
      acordFieldLabels: ["Legal business name", "Entity type", "FEIN", "Website", "Years in business"],
    };
    const session: QuotingSession = {
      id: "quote_demo",
      tenantId: agency.id,
      customerId: contact.id,
      assetType: "other",
      estimatedValue: 0,
      assetDetails: {},
      state: "FL",
      lineOfBusiness: "commercial",
      commercialAcordTemplates: [],
      questionnaireQuestions: [producerQuestion, businessIdentityQuestion],
      questionnaireResponses: {
        [producerQuestion.id]: "Palm Coast Private Client",
        [businessIdentityQuestion.id]: "LLC, EIN should be verified",
      },
      createdById: "agent_demo",
      status: "gathering_info",
      publicFields: {
        "Federal EIN": "12-3456789",
      },
      publicFieldEvidence: {
        "Federal EIN": {
          fieldKey: "Federal EIN",
          sourceKind: "client_intake",
          sourceLabel: "Client quote intake",
          confidence: 0.92,
          verified: true,
          allowDocumentAutofill: true,
          collectedAt: "2026-06-15T12:00:00.000Z",
        },
      },
      missingFields: [],
      quotes: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
    };
    const templateDocument = {
      id: "doc_acord_125",
      tenantId: agency.id,
      uploadedById: "agent_demo",
      fileName: "ACORD-125.pdf",
      fileType: "application/pdf",
      documentName: "ACORD 125 - Commercial Insurance Application",
      type: "agency_template",
      visibility: "employee_only",
      status: "approved",
      storagePath: "/acord/ACORD-125.pdf",
      downloadUrl: "/acord/ACORD-125.pdf",
      uploadedAt: "2026-06-15T12:00:00.000Z",
    } as Document;
    const staleGeneratedDocument = {
      id: "doc_bad_completed",
      tenantId: agency.id,
      uploadedById: "agent_demo",
      fileName: "ACORD-003-bad.pdf",
      fileType: "application/pdf",
      documentName: "Completed ACORD 3",
      type: "completed_acord_application",
      visibility: "employee_only",
      status: "approved",
      storagePath: "generated://completed-acord/doc_bad_completed/ACORD-003-bad.pdf",
      downloadUrl: "data:application/pdf;base64,bad",
      templateFields: {
        "Source ACORD template ID": "doc_acord_003",
        "ACORD PDF fill status": "Filled from stale generated data",
        "Agency fax": "Palm Coast Private Client",
        "Secondary email": "alexandra@example.com",
      },
      uploadedAt: "2026-06-15T12:00:00.000Z",
    } as Document;

    const result = fillAcordFromClientDossier({
      template: {
        templateId: templateDocument.id,
        fileName: templateDocument.fileName,
        documentName: templateDocument.documentName,
      },
      dossier: {
        agency,
        contact,
        assets: [],
        policies: [],
        carriers: [],
        claims: [],
        documents: [templateDocument, staleGeneratedDocument],
        notes: [],
        communications: [],
        session,
        questions: [producerQuestion, businessIdentityQuestion],
        responses: session.questionnaireResponses ?? {},
        templateDocument,
      },
      layout: [
        { label: "Producer", page: 1, x: 10, y: 4, width: 30, height: 2, required: true },
        { label: "Producer contact", page: 1, x: 10, y: 7, width: 30, height: 2 },
        { label: "Agency phone", page: 1, x: 45, y: 4, width: 18, height: 2, required: true },
        { label: "Agency email", page: 1, x: 45, y: 7, width: 24, height: 2, required: true },
        { label: "Agency fax", page: 1, x: 30, y: 8, width: 18, height: 2 },
        { label: "Secondary email", page: 1, x: 50, y: 8, width: 24, height: 2 },
        { label: "Legal business name", page: 1, x: 10, y: 10, width: 30, height: 2, required: true },
        { label: "FEIN", page: 1, x: 10, y: 13, width: 20, height: 2, required: true },
        { label: "Entity type", page: 1, x: 10, y: 16, width: 20, height: 2 },
      ],
      kind: "application",
    });

    expect(result.fields["Producer"]).toBe("Palm Coast Private Client");
    expect(result.fields["Producer contact"]).toBeUndefined();
    expect(result.fields["Agency phone"]).toBe("(555) 100-2000");
    expect(result.fields["Agency email"]).toBe("service@palmcoast.example");
    expect(result.fields["Agency fax"]).toBeUndefined();
    expect(result.fields["Secondary email"]).toBeUndefined();
    expect(result.fields["Legal business name"]).toBe("Whitford Coastal Holdings LLC");
    expect(result.fields["FEIN"]).toBe("12-3456789");
    expect(result.fields["Entity type"]).toBeUndefined();
    expect(result.fields["Agency phone"]).not.toBe("Palm Coast Private Client");
    expect(result.fields["FEIN"]).not.toBe("LLC, EIN should be verified");
  });

  it("does not fill ACORD yes/no explanation prompts from claim, note, document, or communication text", () => {
    const agency = {
      id: "agency_demo",
      name: "Palm Coast Private Client",
      contactEmail: "service@palmcoast.example",
      phone: "(555) 100-2000",
      address: "900 Agency Row, Palm Coast, FL 32137",
    } as Agency;
    const contact: CustomerProfile = {
      id: "customer_demo",
      tenantId: agency.id,
      userId: "user_customer_demo",
      lineOfBusiness: "commercial",
      businessName: "Coastal Logistics LLC",
      name: "Alexandra Whitford",
      email: "alexandra@example.com",
      phone: "(555) 902-7788",
      mailingAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      marketingOptInEmail: true,
      marketingOptInSms: false,
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const carrier: Carrier = {
      id: "carrier_chubb",
      name: "Chubb Masterpiece",
      preferredAssetTypes: ["other"],
      stateAvailability: ["FL"],
      status: "active",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const claim: Claim = {
      id: "claim_old",
      tenantId: agency.id,
      customerId: contact.id,
      policyId: "policy_chubb",
      carrierId: carrier.id,
      externalClaimNumber: "CR-CHB-558920-2",
      lossDescription:
        "Chubb Masterpiece closed claim #CR-CHB-558920-2. This closed claim is now part of the client's previous loss runs.",
      lossAmountUsd: 8400,
      status: "closed",
      openedAt: "2025-09-10",
      closedAt: "2025-10-01",
    };
    const repeatedBadText =
      "Chubb Masterpiece closed claim #CR-CHB-558920-2. This closed claim is now part of the client's previous loss runs.; AI quoting workflow: AI quoting workflow started for";
    const note: Note = {
      id: "note_demo",
      tenantId: agency.id,
      authorId: "agent_demo",
      customerId: contact.id,
      body: repeatedBadText,
      visibility: "internal",
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const communication: Communication = {
      id: "comm_demo",
      tenantId: agency.id,
      customerId: contact.id,
      channel: "email",
      direction: "inbound",
      body: repeatedBadText,
      createdAt: "2026-06-15T12:00:00.000Z",
    };
    const templateDocument = {
      id: "doc_acord_003",
      tenantId: agency.id,
      uploadedById: "agent_demo",
      fileName: "ACORD-003.pdf",
      fileType: "application/pdf",
      documentName: "ACORD 3 - Claims / Occurrence Notice",
      type: "agency_template",
      visibility: "employee_only",
      status: "approved",
      storagePath: "/acord/ACORD-003.pdf",
      downloadUrl: "/acord/ACORD-003.pdf",
      templateFields: {
        "Additional remarks": repeatedBadText,
      },
      uploadedAt: "2026-06-15T12:00:00.000Z",
    } as Document;
    const session: QuotingSession = {
      id: "quote_demo",
      tenantId: agency.id,
      customerId: contact.id,
      assetType: "other",
      estimatedValue: 0,
      assetDetails: {},
      state: "FL",
      lineOfBusiness: "commercial",
      commercialAcordTemplates: [],
      questionnaireQuestions: [],
      questionnaireResponses: {},
      createdById: "agent_demo",
      status: "gathering_info",
      publicFields: {},
      missingFields: [],
      quotes: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
    };
    const labels = [
      'EXPLAIN ALL "YES" RESPONSES',
      "8. ANY HOLD HARMLESS AGREEMENTS?",
      "9. ANY VEHICLES USED BY FAMILY MEMBERS? IF SO, IDENTIFY.",
      "10. DOES THE APPLICANT OBTAIN MVR (Motor Vehicle Record) VERIFICATIONS?",
      "12. ARE ANY DRIVERS NOT COVERED BY WORKERS COMPENSATION?",
      "14. ANY DRIVERS WITH CONVICTIONS FOR MOVING TRAFFIC VIOLATIONS?",
      "15. HAS AGENT INSPECTED VEHICLES?",
    ];

    const result = fillAcordFromClientDossier({
      template: {
        templateId: templateDocument.id,
        fileName: templateDocument.fileName,
        documentName: templateDocument.documentName,
      },
      dossier: {
        agency,
        contact,
        assets: [],
        policies: [],
        carriers: [carrier],
        claims: [claim],
        documents: [templateDocument],
        notes: [note],
        communications: [communication],
        session,
        questions: [],
        responses: {},
        templateDocument,
      },
      layout: labels.map((label, index) => ({
        label,
        page: 2,
        x: 10,
        y: 10 + index * 3,
        width: 90,
        height: 2,
        required: false,
      })),
      kind: "application",
    });

    labels.forEach((label) => {
      expect(result.fields[label]).toBeUndefined();
    });
    expect(result.fields["Additional remarks"]).toBeUndefined();
    expect(result.mappings.some((mapping) => labels.includes(mapping.targetField))).toBe(false);
  });

  it("allows a direct questionnaire response to fill the exact ACORD yes/no explanation field", () => {
    const agency = { id: "agency_demo", name: "Palm Coast Private Client" } as Agency;
    const contact = {
      id: "customer_demo",
      tenantId: agency.id,
      userId: "user_customer_demo",
      lineOfBusiness: "commercial",
      name: "Alexandra Whitford",
      marketingOptInEmail: true,
      marketingOptInSms: false,
      createdAt: "2026-06-15T12:00:00.000Z",
    } as CustomerProfile;
    const fieldLabel = "8. ANY HOLD HARMLESS AGREEMENTS?";
    const question: QuotingQuestion = {
      id: "q_hold_harmless",
      section: "ACORD fields",
      label: "Any hold harmless agreements?",
      kind: "textarea",
      required: false,
      acordFieldLabels: [fieldLabel],
    };
    const session: QuotingSession = {
      id: "quote_demo",
      tenantId: agency.id,
      customerId: contact.id,
      assetType: "other",
      estimatedValue: 0,
      assetDetails: {},
      state: "FL",
      lineOfBusiness: "commercial",
      commercialAcordTemplates: [],
      questionnaireQuestions: [question],
      questionnaireResponses: { [question.id]: "No known hold harmless agreements." },
      createdById: "agent_demo",
      status: "gathering_info",
      publicFields: {},
      missingFields: [],
      quotes: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:00:00.000Z",
    };

    const result = fillAcordFromClientDossier({
      template: {
        templateId: "doc_acord_003",
        fileName: "ACORD-003.pdf",
        documentName: "ACORD 3 - Claims / Occurrence Notice",
      },
      dossier: {
        agency,
        contact,
        assets: [],
        policies: [],
        carriers: [],
        claims: [],
        documents: [],
        notes: [],
        communications: [],
        session,
        questions: [question],
        responses: session.questionnaireResponses ?? {},
      },
      layout: [{ label: fieldLabel, page: 2, x: 10, y: 10, width: 60, height: 2, required: false }],
      kind: "application",
    });

    expect(result.fields[fieldLabel]).toBe("No known hold harmless agreements.");
    expect(result.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: fieldLabel,
          targetField: fieldLabel,
          source: "questionnaire",
        }),
      ])
    );
  });
});
