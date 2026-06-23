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

describe("api.customers.fullHistory", () => {
  it("carries prospect routing, messages, activities, and AI quoting workflow into the client timeline", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const prospect = api.prospects.create({
      tenantId: agency.id,
      name: "History Prospect",
      email: "history-prospect@example.com",
      phone: "+1 (555) 222-0100",
      assetType: "coastal_home",
      estimatedValue: 2_400_000,
      aiSummary: "Interested in coastal home coverage.",
      lastAction: "Started quote intake",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "Confirm underwriting details.",
      marketingStatus: "active",
      status: "new",
    });

    api.prospects.assignAgent(prospect.id, agent.id, manager.id);
    api.communications.create({
      tenantId: agency.id,
      prospectId: prospect.id,
      channel: "email",
      direction: "outbound",
      subject: "Welcome to Quotex intake",
      body: "We will gather the details needed to quote your home.",
      createdById: agent.id,
    });
    const session = await api.quoting.startSession({
      tenantId: agency.id,
      prospectId: prospect.id,
      createdById: agent.id,
      assetType: prospect.assetType,
      contactName: prospect.name,
      estimatedValue: prospect.estimatedValue,
      lineOfBusiness: "personal",
    });
    api.quoting.sendPortalLink(session.id, "https://harbor.example/questionnaire/history");

    const converted = api.prospects.convert(prospect.id, { actorId: manager.id });
    const historyText = api.customers
      .fullHistory(converted.customer.id)
      .map((event) => event.message)
      .join("\n");

    expect(historyText).toContain("Prospect profile created for History Prospect");
    expect(historyText).toContain(`${manager.name} assigned History Prospect to agent ${agent.name}`);
    expect(historyText).toContain("Activity created: New prospect assigned: History Prospect");
    expect(historyText).toContain("Email sent: Welcome to Quotex intake.");
    expect(historyText).toContain("AI quoting workflow started");
    expect(historyText).toContain("AI quoting questionnaire sent");
    expect(historyText).toContain("converted from prospect to client");
  });
});
