// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { db } from "../db";

beforeEach(() => {
  window.localStorage.clear();
  db.reset();
});

describe("walkthrough leads", () => {
  it("captures homepage walkthrough submissions for the master lead queue", () => {
    const lead = api.demoLeads.create({
      firstName: "Maya",
      lastName: "Stone",
      businessEmail: "maya@harbor.example",
      agencyName: "Harbor Private Risk",
      role: "Owner",
      staffSize: "10-24",
      phone: "+1 (555) 222-1010",
      interest: "Full Quotex software walkthrough",
      marketingOptIn: true,
      source: "walkthrough_request",
    });

    expect(lead.status).toBe("new");
    expect(api.demoLeads.list()[0].agencyName).toBe("Harbor Private Risk");
    expect(api.demoLeads.list()[0].source).toBe("walkthrough_request");
  });

  it("imports older homepage requests from the legacy localStorage key", () => {
    window.localStorage.setItem(
      "quotex.demoRequests.v1",
      JSON.stringify([
        {
          id: "demo_lead_legacy_test",
          firstName: "Noah",
          lastName: "Bell",
          businessEmail: "noah@summit.example",
          agencyName: "Summit HNW",
          role: "Principal",
          staffSize: "25-49",
          phone: "+1 (555) 333-9090",
          interest: "Agency website walkthrough",
          notes: "Wants to see website and app.",
          marketingOptIn: true,
          createdAt: "2026-06-10T13:00:00.000Z",
        },
      ])
    );

    const leads = api.demoLeads.list();

    expect(leads.some((lead) => lead.id === "demo_lead_legacy_test")).toBe(true);
    expect(api.demoLeads.list().filter((lead) => lead.id === "demo_lead_legacy_test")).toHaveLength(1);
  });

  it("lets master users add and update lead status", () => {
    const lead = api.demoLeads.create({
      firstName: "Ari",
      lastName: "Lane",
      businessEmail: "ari@northstar.example",
      agencyName: "Northstar Agency",
      role: "Operations",
      staffSize: "50+",
      interest: "Pricing and onboarding review",
      marketingOptIn: false,
      source: "manual",
    });

    api.demoLeads.update(lead.id, { status: "qualified" });

    expect(api.demoLeads.get(lead.id)?.status).toBe("qualified");
    expect(api.demoLeads.get(lead.id)?.source).toBe("manual");
  });
});
