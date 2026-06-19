// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { db } from "../db";
import {
  COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD,
  COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD,
  COMPANY_WEBSITE_MONTHLY_ADD_ON_USD,
  COMPANY_APP_MONTHLY_ADD_ON_USD,
  SOFTWARE_SETUP_FEE_USD,
  WEBSITE_APP_ADD_ON_OPTIONS,
  agencyMonthlyPriceUsd,
  softwarePlanTermDiscountMonthlyUsd,
  softwareSaleMonthlyTotalForSeats,
  softwareUserMonthlyDiscount,
  softwareUserMonthlyTotal,
  standardAgencyMonthlyPriceUsd,
} from "../tiers";

beforeEach(() => {
  window.localStorage.clear();
  db.reset();
});

describe("softwareSales", () => {
  it("captures a transaction-site checkout request for the master billing queue", () => {
    const sale = api.softwareSales.create({
      agencyName: "Harbor Private Risk",
      contactName: "Maya Stone",
      email: "maya@example.com",
      tier: "mid",
      seats: 25,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(25, "website_app"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "website_app",
      websiteAppAddOnMonthly: WEBSITE_APP_ADD_ON_OPTIONS.website_app.monthlyPriceUsd,
      source: "transaction_site",
      paymentMode: "stripe_checkout",
      stripeCheckoutSessionId: "demo_checkout_test",
    });

    expect(sale.status).toBe("checkout_pending");
    expect(sale.setupFee).toBe(0);
    expect(sale.estimatedMonthly).toBe(25 * 300 + COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD);
    expect(api.softwareSales.list()[0].agencyName).toBe("Harbor Private Risk");
  });

  it("lets master billing update the transaction status", () => {
    const sale = api.softwareSales.create({
      agencyName: "Summit HNW",
      contactName: "Noah Bell",
      email: "noah@example.com",
      tier: "ultra",
      seats: 20,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(20, "app"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "app",
      websiteAppAddOnMonthly: WEBSITE_APP_ADD_ON_OPTIONS.app.monthlyPriceUsd,
      source: "transaction_site",
      paymentMode: "stripe_checkout",
    });

    api.softwareSales.setStatus(sale.id, "provisioning");
    expect(api.softwareSales.get(sale.id)?.status).toBe("provisioning");
  });

  it("applies website and Quotex app bundle savings without user-volume discounting", () => {
    expect(softwareUserMonthlyDiscount(9)).toBe(0);
    expect(softwareUserMonthlyDiscount(10)).toBe(0);
    expect(softwareUserMonthlyTotal(25)).toBe(7500);
    expect(COMPANY_WEBSITE_MONTHLY_ADD_ON_USD + COMPANY_APP_MONTHLY_ADD_ON_USD).toBe(6000);
    expect(COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD).toBe(5000);
    expect(COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD).toBe(1000);
    expect(softwareSaleMonthlyTotalForSeats(25, "website_app")).toBe(12500);
  });

  it("applies term discounts to the monthly plan after bundle savings", () => {
    const monthlyBeforeTerm = softwareSaleMonthlyTotalForSeats(20, "website_app");
    expect(monthlyBeforeTerm).toBe(11000);
    expect(softwarePlanTermDiscountMonthlyUsd(monthlyBeforeTerm, 24)).toBe(550);
    expect(softwareSaleMonthlyTotalForSeats(20, "website_app", 24)).toBe(10450);
    expect(softwareSaleMonthlyTotalForSeats(20, "website_app", 36)).toBe(10120);
  });

  it("lets master special-price an agency without changing standard pricing", () => {
    const agency = api.agencies.list()[0];
    const standardMonthly = standardAgencyMonthlyPriceUsd(agency);
    expect(standardMonthly).toBeGreaterThan(0);

    api.agencies.update(agency.id, {
      monthlyPriceOverrideUsd: 2500,
      monthlyPriceOverrideReason: "Founder-approved launch discount",
    });

    const updated = api.agencies.get(agency.id)!;
    expect(standardAgencyMonthlyPriceUsd(updated)).toBe(standardMonthly);
    expect(agencyMonthlyPriceUsd(updated)).toBe(2500);
  });
});
