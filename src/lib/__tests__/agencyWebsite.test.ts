import { describe, expect, it } from "vitest";
import type { Agency } from "@/types";
import {
  buildAgencyWebsiteProfile,
  normalizeWebsiteHost,
  resolveAgencyByKey,
} from "../agencyWebsite";
import { protectAgencyCode } from "../credentials";

const agency: Agency = {
  id: "agency_fixture",
  name: "Harbor Private Risk",
  logoUrl: "",
  brandColor: "#123456",
  contactEmail: "hello@harbor.example",
  phone: "+1 (555) 000-1111",
  address: "1 Main St",
  website: "https://www.harbor.example/site",
  websiteSlug: "harbor-risk",
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
    expect(normalizeWebsiteHost("https://www.harbor.example/site")).toBe("harbor.example");
    expect(normalizeWebsiteHost("harbor.example")).toBe("harbor.example");
  });

  it("resolves agencies by id, slug, or website host", () => {
    const agencies = [agency];
    expect(resolveAgencyByKey(agencies, "agency_fixture")?.id).toBe("agency_fixture");
    expect(resolveAgencyByKey(agencies, "harbor-risk")?.id).toBe("agency_fixture");
    expect(resolveAgencyByKey(agencies, "www.harbor.example")?.id).toBe("agency_fixture");
  });

  it("builds staff portal links with agency handoff query params", () => {
    const profile = buildAgencyWebsiteProfile(agency);
    expect(profile.employeeLoginUrl).toBe("/employee/login?agency=agency_fixture");
    expect(profile.masterLoginUrl).toBe("/master/login?agency=agency_fixture");
  });

  it("includes customer portal connection settings when present", () => {
    const profile = buildAgencyWebsiteProfile({
      ...agency,
      customerPortalUrl: "https://harbor.example/client-portal",
      quoteStartUrl: "https://harbor.example/start-quote",
      websiteAllowedDomains: ["harbor.example", "www.harbor.example"],
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

    expect(profile.customerPortalUrl).toBe("https://harbor.example/client-portal");
    expect(profile.customerLoginUrl).toBe("https://harbor.example/client-portal");
    expect(profile.quoteStartUrl).toBe("https://harbor.example/start-quote");
    expect(profile.allowedDomains).toEqual(["harbor.example"]);
    expect(profile.portalModules?.messages).toBe(false);
  });
});
