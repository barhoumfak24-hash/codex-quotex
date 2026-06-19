import { describe, expect, it } from "vitest";
import type { Agency } from "@/types";
import {
  buildAgencyWebsiteProfile,
  normalizeWebsiteHost,
  resolveAgencyByKey,
} from "../agencyWebsite";
import { protectAgencyCode } from "../credentials";

const agency: Agency = {
  id: "agency_demo",
  name: "Demo Private Risk",
  logoUrl: "",
  brandColor: "#123456",
  contactEmail: "hello@demo.example",
  phone: "+1 (555) 000-1111",
  address: "1 Main St",
  website: "https://www.demo.example/site",
  websiteSlug: "demo-risk",
  serviceAreas: ["FL"],
  ...protectAgencyCode("DMORISK1"),
  tier: "mid",
  active: true,
  allowedUsers: 25,
  allowedProspectsPerMonth: 1000,
  allowedAiMessagesPerMonth: 5000,
  allowedCarriers: 12,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("agency website helpers", () => {
  it("normalizes hostnames consistently", () => {
    expect(normalizeWebsiteHost("https://www.demo.example/site")).toBe("demo.example");
    expect(normalizeWebsiteHost("demo.example")).toBe("demo.example");
  });

  it("resolves agencies by id, slug, or website host", () => {
    const agencies = [agency];
    expect(resolveAgencyByKey(agencies, "agency_demo")?.id).toBe("agency_demo");
    expect(resolveAgencyByKey(agencies, "demo-risk")?.id).toBe("agency_demo");
    expect(resolveAgencyByKey(agencies, "www.demo.example")?.id).toBe("agency_demo");
  });

  it("builds staff portal links with agency handoff query params", () => {
    const profile = buildAgencyWebsiteProfile(agency);
    expect(profile.employeeLoginUrl).toBe("/employee/login?agency=agency_demo");
    expect(profile.masterLoginUrl).toBe("/master/login?agency=agency_demo");
  });

  it("includes customer portal connection settings when present", () => {
    const profile = buildAgencyWebsiteProfile({
      ...agency,
      customerPortalUrl: "https://demo.example/client-portal",
      quoteStartUrl: "https://demo.example/start-quote",
      websiteAllowedDomains: ["demo.example", "www.demo.example"],
      websitePortalModules: {
        policies: true,
        documents: true,
        claims: true,
        messages: false,
        questionnaires: true,
        payments: false,
        signatures: true,
      },
    });

    expect(profile.customerPortalUrl).toBe("https://demo.example/client-portal");
    expect(profile.customerLoginUrl).toBe("https://demo.example/client-portal");
    expect(profile.quoteStartUrl).toBe("https://demo.example/start-quote");
    expect(profile.allowedDomains).toEqual(["demo.example"]);
    expect(profile.portalModules?.messages).toBe(false);
  });
});
