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

describe("customer quote incomplete workflows", () => {
  it("saves one incomplete workflow with a drafted follow-up and clears it on submit", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const customer = api.customers.create({
      tenantId: agency.id,
      userId: "customer_sarah",
      name: "Sarah Johnson",
      email: "sarah@example.com",
      phone: "+1 (555) 312-0199",
      lineOfBusiness: "personal",
      assignedAgentId: agent.id,
      marketingOptInEmail: true,
      marketingOptInSms: true,
    });

    const first = api.quotes.recordIncompleteWorkflow({
      tenantId: agency.id,
      customerId: customer.id,
      assetType: "luxury_vehicle",
      lineOfBusiness: "personal",
      categoryId: "auto",
      categoryLabel: "Auto",
      contactName: customer.name,
      contactEmail: customer.email,
      contactPhone: customer.phone,
      assetIdentifier: "2024 Mercedes G-Class",
      currentStep: "ID verification",
      completionPercent: 82,
      assignedAgentId: agent.id,
      createdById: agent.id,
    });
    const second = api.quotes.recordIncompleteWorkflow({
      tenantId: agency.id,
      customerId: customer.id,
      assetType: "luxury_vehicle",
      lineOfBusiness: "personal",
      categoryId: "auto",
      categoryLabel: "Auto",
      contactName: customer.name,
      contactEmail: customer.email,
      contactPhone: customer.phone,
      assetIdentifier: "2024 Mercedes G-Class",
      currentStep: "review and submit",
      completionPercent: 94,
      assignedAgentId: agent.id,
      createdById: agent.id,
    });

    expect(second.id).toBe(first.id);
    expect(api.quotes.listIncompleteWorkflows(agency.id)).toHaveLength(1);
    expect(second.currentStep).toBe("review and submit");

    const task = second.recoveryTaskId ? api.tasks.get(second.recoveryTaskId) : undefined;
    expect(task?.title).toContain("Sarah Johnson stopped mid-quote");
    expect(task?.assignedToId).toBe(agent.id);
    expect(task?.aiReplySubject).toMatch(/finish your auto quote/i);
    expect(task?.aiReplyBody).toContain("stopped around the review and submit section");

    const submitted = api.quotes.submitCustomerQuote({
      tenantId: agency.id,
      customerId: customer.id,
      assetType: "luxury_vehicle",
      lineOfBusiness: "personal",
      categoryId: "auto",
      categoryLabel: "Auto",
      rawDescription: "Express quote (personal lines): Auto.",
      parsedData: { vin: "demo" },
      missingDocuments: [],
      status: "submitted_to_agent",
      assignedAgentId: agent.id,
    });

    expect(submitted.id).toBe(first.id);
    expect(api.quotes.listIncompleteWorkflows(agency.id)).toHaveLength(0);
    expect(api.tasks.get(second.recoveryTaskId!)?.completedAt).toBeTruthy();
  });
});
