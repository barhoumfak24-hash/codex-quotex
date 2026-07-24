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

async function firstPolicyFixture() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const customer = api.customers.list(agency.id)[0];
  const policy = api.policies.listByCustomer(customer.id)[0];
  const carrier = api.carriers.listForTenant(agency.id)[0];
  const asset = policy?.assetId ? api.assets.get(policy.assetId) : api.assets.listByCustomer(customer.id)[0];
  if (!agency || !customer || !policy || !carrier || !asset) {
    throw new Error("Seed fixture is missing agency, customer, policy, carrier, or asset.");
  }
  return { api, agency, customer, policy, carrier, asset };
}

describe("activity trigger plumbing", () => {
  it("creates one activity for a customer claim inquiry and prevents inbound triage duplicates", async () => {
    const { api, agency, customer, asset } = await firstPolicyFixture();

    const out = api.claims.submitInquiry({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "I need help filing a claim after water damage.",
    });

    const task = api.tasks
      .listByTenant(agency.id)
      .find((t) => t.activityKey === `claim-inquiry:${out.commId}`);
    expect(task).toBeTruthy();
    expect(task!.topic).toBe("claim_filed");
    expect(task!.customerId).toBe(customer.id);
    expect(task!.assetId).toBe(asset.id);

    api.communications.sweepInboundForActivities(agency.id);
    const matches = api.tasks
      .listByTenant(agency.id)
      .filter((t) => t.messageId === out.commId || t.originalMessageId === out.commId);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.activityKey).toMatch(/^inbound-email:/);
  });

  it("creates an open-claim activity and resolves it when the claim closes", async () => {
    const { api, agency, customer, policy, carrier } = await firstPolicyFixture();

    const claim = api.claims.create({
      tenantId: agency.id,
      customerId: customer.id,
      policyId: policy.id,
      carrierId: carrier.id,
      status: "opened",
      lossDescription: "Roof leak after storm",
    });

    const key = `claim:${claim.id}:open`;
    const openTask = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(openTask).toBeTruthy();
    expect(openTask!.topic).toBe("claim_status");
    expect(openTask!.completedAt).toBeUndefined();

    api.claims.close(claim.id);
    const resolved = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.completedAt).toBeTruthy();
  });

  it("creates and clears billing issue activities from policy billing updates", async () => {
    const { api, agency, policy } = await firstPolicyFixture();

    api.policies.update(policy.id, {
      billingStatus: "past_due",
      nextPaymentDueDate: "2026-05-01T00:00:00.000Z",
    });
    const key = `billing:${policy.id}:past_due`;
    const task = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(task).toBeTruthy();
    expect(task!.topic).toBe("payment_issue");
    expect(task!.severity).toBe("urgent");

    api.policies.update(policy.id, {
      billingStatus: "current",
      nextPaymentDueDate: "2026-08-01T00:00:00.000Z",
    });
    const resolved = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.completedAt).toBeTruthy();
  });

  it("creates a customer document upload notification and clears it on approval", async () => {
    const { api, agency, customer, policy, asset } = await firstPolicyFixture();
    const customerUser = api.users.create({
      tenantId: agency.id,
      role: "customer",
      name: "Document Upload Customer",
      email: "doc-upload-customer@example.com",
    });

    const doc = api.documents.create({
      tenantId: agency.id,
      uploadedById: customerUser.id,
      fileName: "roof-receipt.pdf",
      fileType: "application/pdf",
      type: "receipt",
      visibility: "customer_visible",
      status: "pending",
      customerId: customer.id,
      assetId: asset.id,
      policyId: policy.id,
    });

    const key = `document-review:${doc.id}`;
    expect(api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key)).toBeUndefined();
    const notice = api.aiNotifications
      .listUnacked(agency.id)
      .find((n) => n.kind === "inbound_notice" && n.documentId === doc.id);
    expect(notice).toBeTruthy();
    expect(notice!.topic).toBe("document_upload");

    api.documents.update(doc.id, { status: "approved" });
    expect(
      api.aiNotifications
        .listUnacked(agency.id)
        .some((n) => n.kind === "inbound_notice" && n.documentId === doc.id)
    ).toBe(false);
  });

  it("creates a non-renewal activity and resolves it when the policy is renewed", async () => {
    const { api, agency, policy } = await firstPolicyFixture();

    const renewal = api.renewals.create({
      tenantId: agency.id,
      policyId: policy.id,
      renewalDate: "2026-09-01T00:00:00.000Z",
      status: "not_renewed",
      nonRenewalReason: "Carrier exiting this coastal segment.",
      nonRenewalEffectiveDate: "2026-09-01T00:00:00.000Z",
    });

    const key = `non-renewal:${renewal.id}`;
    const task = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(task).toBeTruthy();
    expect(task!.severity).toBe("urgent");
    expect(task!.description).toMatch(/Carrier exiting this coastal segment/);

    api.renewals.markRenewed(renewal.id);
    const resolved = api.tasks.listByTenant(agency.id).find((t) => t.activityKey === key);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.completedAt).toBeTruthy();
  });

  it("routes customer-started quote-ready notifications to the assigned agent", async () => {
    const { api, agency, customer } = await firstPolicyFixture();
    const agent = customer.assignedAgentId
      ? api.users.get(customer.assignedAgentId)
      : api.users.list(agency.id).find((user) => user.role === "agent");
    if (!agent) throw new Error("Seed fixture is missing an assigned agent.");
    api.customers.assignAgent(customer.id, agent.id, "system");
    const customerUser = api.users.create({
      tenantId: agency.id,
      role: "customer",
      name: "Quote Portal Customer",
      email: "quote-portal-customer@example.com",
    });
    const category = api.categories.get("cat_primary_home")!;

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
      assetIdentifier: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      parsedData: {
        propertyAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
        occupancy: "Primary",
      },
      currentStep: "submitted to agent",
      completionPercent: 100,
      assignedAgentId: agent.id,
      createdById: customerUser.id,
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
      address: "44 Sea Breeze Ln, Palm Beach, FL 33480",
      assetDetails: {
        propertyAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
        occupancy: "Primary",
      },
      questionnaireAnswers: {
        propertyAddress: "44 Sea Breeze Ln, Palm Beach, FL 33480",
        occupancy: "Primary",
      },
      assignedAgentId: agent.id,
      createdById: customerUser.id,
      status: "submitted_to_agent",
    });
    const responses = Object.fromEntries(
      (session.questionnaireQuestions ?? []).map((question) => [
        question.id,
        session.questionnaireResponses?.[question.id] ?? "Confirmed",
      ])
    );

    api.quoting.submitQuestionnaireResponses(session.id, responses, {
      id: customerUser.id,
      name: customerUser.name,
      role: "customer",
    });

    const readyNotification = api.aiNotifications
      .listUnacked(agency.id)
      .find((notification) => notification.kind === "quote_ready" && notification.quoteSessionId === session.id);
    expect(readyNotification?.assignedToId).toBe(agent.id);
    expect(readyNotification?.quoteSessionId).toBe(session.id);
    expect(readyNotification?.customerId).toBe(customer.id);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some((task) => task.activityKey === `quote-session:${session.id}:quote_ready` && task.status !== "resolved")
    ).toBe(false);
  });
});
