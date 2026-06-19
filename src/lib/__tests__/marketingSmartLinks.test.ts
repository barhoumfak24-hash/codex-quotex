import { describe, expect, it } from "vitest";
import { resolveMarketingContactTarget } from "../marketingSmartLinks";
import type { Agency, CustomerProfile, Prospect } from "@/types";

const agency = {
  id: "agency_palmcoast",
  name: "Palm Coast Private Client",
  contactEmail: "hello@palmcoastpc.example",
  website: "palmcoastpc.example",
  customerPortalUrl: "https://app.quotexinsurance.com/palm-coast/contact",
} as Agency;

const customer = {
  id: "customer_demo",
  tenantId: "agency_palmcoast",
  userId: "user_customer_demo",
  name: "Alexandra Whitford",
  email: "alexandra@example.com",
  marketingOptInEmail: true,
  marketingOptInSms: false,
  createdAt: new Date().toISOString(),
} as CustomerProfile;

const prospect = {
  id: "prospect_demo",
  tenantId: "agency_palmcoast",
  name: "Jamie Prospect",
  email: "jamie@example.com",
  assetType: "coastal_home",
  aiSummary: "",
  lastAction: "",
  lastActivityAt: new Date().toISOString(),
  recommendedFollowUp: "",
  marketingStatus: "active",
  status: "new",
  createdAt: new Date().toISOString(),
} as Prospect;

describe("marketingSmartLinks", () => {
  it("opens the app contact surface for mobile customers with portal access", () => {
    expect(
      resolveMarketingContactTarget({
        agency,
        customer,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
      })
    ).toBe("/agency-app/contact");
  });

  it("keeps prospects on the website contact surface", () => {
    expect(
      resolveMarketingContactTarget({
        agency,
        prospect,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
      })
    ).toBe("/agency/contact");
  });

  it("uses real agency websites but ignores demo .example placeholders", () => {
    expect(
      resolveMarketingContactTarget({
        agency: { ...agency, website: "https://real-agency.com" },
        customer,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      })
    ).toBe("https://real-agency.com");
  });
});
