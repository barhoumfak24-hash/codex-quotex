// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Agency templates → client-tied documents.
// Manager uploads tenant-wide templates under Document review.
// Agent applies a template to a client via the missing-docs modal;
// applyTemplate clones the template into the client's Documents
// list with the AI-suggested type and customer_visible visibility.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("documents.listTemplates + applyTemplate", () => {
  it("seeds ACORD templates with bundled PDF assets", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const templates = api.documents.listTemplates(agency.id);
    const acordTemplates = templates.filter((template) =>
      /acord/i.test(`${template.fileName} ${template.documentName ?? ""}`)
    );
    const fileNames = acordTemplates.map((template) => template.fileName);
    const acord25 = templates.find((template) => template.documentName?.startsWith("ACORD 25"));
    const acord125 = templates.find((template) => template.documentName?.startsWith("ACORD 125"));

    expect(acordTemplates).toHaveLength(41);
    expect(fileNames).toContain("ACORD-810-Fillable.pdf");
    expect(fileNames).toContain("ACORD-Untitled-document-11.pdf");
    expect(fileNames).not.toContain("ACORD-81.pdf");
    expect(fileNames).not.toContain("ACORD-82.pdf");
    expect(fileNames).not.toContain("ACORD-90.pdf");
    expect(acord25?.fileName).toBe("ACORD-025-Certificate-of-Liability.pdf");
    expect(acord125?.fileName).toBe("ACORD-125.pdf");
    expect(acord25?.storagePath).toBe("/acord/ACORD-025-Certificate-of-Liability.pdf");
    expect(acord25?.downloadUrl).toBe("/acord/ACORD-025-Certificate-of-Liability.pdf");
    expect(acord25?.templateFields?.["Bundled PDF"]).toContain("Yes");
    expect(acord25?.templateFields?.["Source file"]).toBe("acord-coi-form.pdf");
  });

  it("listTemplates returns only reusable agency-library docs", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Auto-Change-Form.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
    });
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Wind-Mitigation-Checklist.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
    });
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Signed-Service-Agreement-Blank.pdf",
      fileType: "application/pdf",
      documentName: "Signed service agreement blank",
      type: "other",
      visibility: "employee_only",
      agencyId: agency.id,
    });
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Personal-Lines-App.pdf",
      fileType: "application/pdf",
      documentName: "Personal lines application",
      type: "agency_template",
      visibility: "employee_only",
      agencyId: agency.id,
      lineOfBusiness: "personal",
    });
    // Customer-tied doc should NOT appear in templates.
    const customer = api.customers.list(agency.id)[0];
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Customer-Specific.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
      customerId: customer.id,
    });
    api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Carrier-Supplemental.pdf",
      fileType: "application/pdf",
      type: "carrier_supplemental",
      visibility: "employee_only",
      carrierId: "carrier_chubb",
      lineOfBusiness: "commercial",
    });
    const tpls = api.documents.listTemplates(agency.id);
    expect(tpls.map((t) => t.fileName)).toContain("Auto-Change-Form.pdf");
    expect(tpls.map((t) => t.fileName)).toContain("Wind-Mitigation-Checklist.pdf");
    expect(tpls.map((t) => t.fileName)).toContain("Signed-Service-Agreement-Blank.pdf");
    expect(tpls.map((t) => t.fileName)).toContain("Personal-Lines-App.pdf");
    expect(tpls.map((t) => t.fileName)).not.toContain("Customer-Specific.pdf");
    expect(tpls.map((t) => t.fileName)).not.toContain("Carrier-Supplemental.pdf");
  });

  it("applyTemplate clones a template into the client's docs with the chosen type", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const tpl = api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Wind-Mitigation-Template.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
      customerEsignRequired: true,
      agentEsignRequired: true,
    });

    const applied = api.documents.applyTemplate(tpl.id, {
      customerId: customer.id,
      assetId: asset.id,
      type: "wind_mitigation",
      uploadedById: "user_agent_pc",
    });

    expect(applied).not.toBeNull();
    expect(applied!.id).not.toBe(tpl.id);
    expect(applied!.customerId).toBe(customer.id);
    expect(applied!.assetId).toBe(asset.id);
    expect(applied!.type).toBe("wind_mitigation");
    expect(applied!.fileName).toBe("Wind-Mitigation-Template.pdf");
    expect(applied!.visibility).toBe("customer_visible");
    expect(applied!.customerEsignRequired).toBe(true);
    expect(applied!.agentEsignRequired).toBe(true);
    // Original template untouched.
    const origin = api.documents.get(tpl.id)!;
    expect(origin.customerId).toBeUndefined();
    expect(origin.type).toBe("agency_template");
  });

  it("applying a template flips the AI suggester — the missing type no longer shows up", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const newUser = api.users.create({
      role: "customer",
      tenantId: agency.id,
      email: "t@example.com",
      name: "T C",
    });
    const c = api.customers.create({
      tenantId: agency.id,
      userId: newUser.id,
      name: "T C",
      email: "t@example.com",
      marketingOptInEmail: false,
      marketingOptInSms: false,
    });
    const a = api.assets.create({
      tenantId: agency.id,
      customerId: c.id,
      type: "coastal_home",
      label: "House",
      estimatedValue: 1_000_000,
      details: {},
      status: "insured",
    });

    // Pre-condition: coastal home missing all 4 expected docs.
    const before = api.documents.suggestMissingForCustomer(c.id);
    const missingTypes = before[0].missing.map((m) => m.type);
    expect(missingTypes).toContain("wind_mitigation");

    // Manager uploads a wind-mit template, agent applies it.
    const tpl = api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Wind-Mit-Template.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
    });
    api.documents.applyTemplate(tpl.id, {
      customerId: c.id,
      assetId: a.id,
      type: "wind_mitigation",
      uploadedById: "user_agent_pc",
    });

    const after = api.documents.suggestMissingForCustomer(c.id);
    const afterMissingTypes = after[0].missing.map((m) => m.type);
    expect(afterMissingTypes).not.toContain("wind_mitigation");
  });
});

describe("documents.fillTemplateWithAi", () => {
  it("synthesizes a customer-tied filled doc + logs an audit event with the sources", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const tpl = api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Wind-Mit-Form.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
    });
    const filled = api.documents.fillTemplateWithAi({
      templateId: tpl.id,
      sourceFiles: [
        { fileName: "Dec-Page.pdf", fileType: "application/pdf" },
        { fileName: "Inspection.pdf", fileType: "application/pdf" },
      ],
      customerId: customer.id,
      assetId: asset.id,
      type: "wind_mitigation",
      uploadedById: "user_agent_pc",
    });
    expect(filled).not.toBeNull();
    expect(filled!.customerId).toBe(customer.id);
    expect(filled!.type).toBe("wind_mitigation");
    expect(filled!.visibility).toBe("customer_visible");
    // Output name embeds the original base + customer + "AI-filled".
    expect(filled!.fileName).toMatch(/Wind-Mit-Form-.*-AI-filled\.pdf$/);
    // Audit event tags the AI fill + the sources used.
    const events = db
      .list("statusEvents")
      .filter((e) => e.documentId === filled!.id);
    expect(events.length).toBeGreaterThan(0);
    const aiEvent = events.find((e) => e.source === "ai" && e.message.includes("AI filled"))!;
    expect(aiEvent).toBeTruthy();
    expect(aiEvent.message).toContain("Dec-Page.pdf");
    expect(aiEvent.message).toContain("Inspection.pdf");
  });

  it("works without source files (template-only AI fill)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const tpl = api.documents.create({
      tenantId: agency.id,
      uploadedById: "user_manager_pc",
      fileName: "Generic.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      visibility: "employee_only",
    });
    const filled = api.documents.fillTemplateWithAi({
      templateId: tpl.id,
      customerId: customer.id,
      type: "wind_mitigation",
      uploadedById: "user_agent_pc",
    });
    expect(filled).not.toBeNull();
    expect(filled!.fileName).toMatch(/AI-filled\.pdf$/);
  });
});
