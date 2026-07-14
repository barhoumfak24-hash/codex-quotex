// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { softwareSaleAgencyCode } from "../communications";
import { db } from "../db";
import {
  listLivePlatformAgencies,
  listReconciledLivePlatformAgencies,
  provisionAgencyForCompletedSale,
  reconcilePaidSoftwareSalesToAgencies,
} from "../softwareSaleProvisioning";
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

  it("captures master-portal assisted purchases separately from self-checkout", () => {
    const sale = api.softwareSales.create({
      agencyName: "Beacon Risk Group",
      contactName: "Avery Clark",
      email: "avery@example.com",
      tier: "minimum",
      seats: 10,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(10, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "manual_invoice",
      stripeCheckoutSessionId: "master_plan_test",
    });

    expect(sale.source).toBe("master_portal");
    expect(sale.paymentMode).toBe("manual_invoice");
  });

  it("uses the actual provisioned agency code for software sale invoices", () => {
    const sale = api.softwareSales.create({
      agencyName: "Invoice Code Match Agency",
      contactName: "Avery Ledger",
      email: "billing@invoice-code-match.example",
      tier: "minimum",
      seats: 10,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(10, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "manual_invoice",
      stripeCheckoutSessionId: "invoice_code_match_test",
    });

    const invoiceAgencyCode = softwareSaleAgencyCode(sale);
    const agency = api.agencies
      .list()
      .find((row) => row.contactEmail === "billing@invoice-code-match.example");

    expect(agency).toBeTruthy();
    expect(invoiceAgencyCode).toBe(api.agencies.revealCodeForMaster(agency!.id));
    expect(api.agencies.byCode(invoiceAgencyCode)?.id).toBe(agency!.id);
  });

  it("normalizes legacy workspace-only sales into full platform access", () => {
    const sale = api.softwareSales.create({
      agencyName: "Quoting Only Group",
      contactName: "Quinn Mapper",
      email: "billing@quoting-only.example",
      product: "ai_quoting_workspace" as never,
      tier: "minimum",
      seats: 4,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(
        4,
        "website_app",
        12,
        "ai_quoting_workspace"
      ),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "website_app",
      websiteAppAddOnMonthly: WEBSITE_APP_ADD_ON_OPTIONS.website_app.monthlyPriceUsd,
      source: "master_portal",
      paymentMode: "manual_invoice",
    });

    expect(sale.estimatedMonthly).toBe(6200);
    softwareSaleAgencyCode(sale);
    const agency = api.agencies
      .list()
      .find((row) => row.contactEmail === "billing@quoting-only.example");

    expect(agency).toBeTruthy();
    expect(agency!.softwareProduct).toBe("full_platform");
    expect(agency!.websiteAppAddOn).toBe("website_app");
    expect(agency!.allowedCarriers).toBe(5);
    expect(standardAgencyMonthlyPriceUsd(agency!)).toBe(8000);
  });

  it("provisions additional live agencies without losing an existing agency when the browser is tenant-scoped", () => {
    const firstSale = api.softwareSales.create({
      agencyName: "First Live Agency",
      contactName: "First Buyer",
      email: "billing@first-live.example",
      tier: "minimum",
      seats: 10,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(10, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "stripe_checkout",
    });
    const firstAgency = provisionAgencyForCompletedSale(firstSale);

    const user = api.users.create({
      tenantId: firstAgency.id,
      role: "manager",
      email: "manager@first-live.example",
      name: "First Manager",
      generatedPassword: "temporary-password",
    });
    window.localStorage.setItem("quotex.auth.userId.v1", user.id);

    const secondSale = api.softwareSales.create({
      agencyName: "Second Live Agency",
      contactName: "Second Buyer",
      email: "billing@second-live.example",
      product: "ai_quoting_workspace" as never,
      tier: "minimum",
      seats: 3,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(3, "none", 12, "ai_quoting_workspace"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "stripe_checkout",
    });
    const secondAgency = provisionAgencyForCompletedSale(secondSale);

    expect(api.agencies.list().map((agency) => agency.contactEmail)).toEqual(["billing@first-live.example"]);
    expect(listReconciledLivePlatformAgencies().map((agency) => agency.contactEmail)).toEqual(
      expect.arrayContaining(["billing@first-live.example", "billing@second-live.example"])
    );

    window.localStorage.clear();
    const liveAgencyEmails = api.agencies
      .list()
      .map((agency) => agency.contactEmail)
      .filter((email) => email.includes("live.example"));
    expect(liveAgencyEmails).toEqual(
      expect.arrayContaining(["billing@first-live.example", "billing@second-live.example"])
    );
    expect(api.agencies.get(firstAgency.id)?.name).toBe("First Live Agency");
    expect(api.agencies.get(secondAgency.id)?.softwareProduct).toBe("full_platform");
    expect(api.agencies.get(secondAgency.id)?.allowedCarriers).toBe(5);
  });

  it("lists live platform agencies without reconciling paid sales during category reads", () => {
    const liveAgencyEmailsBefore = listLivePlatformAgencies().map((agency) => agency.contactEmail);

    const sale = api.softwareSales.create({
      agencyName: "Read Only Category Agency",
      contactName: "Casey Category",
      email: "billing@read-only-category.example",
      tier: "minimum",
      seats: 10,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(10, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "transaction_site",
      paymentMode: "stripe_checkout",
      stripePaymentStatus: "paid",
      stripePaidAt: "2026-06-30T15:00:00.000Z",
      status: "paid",
    });

    expect(api.agencies.list().some((agency) => agency.contactEmail === sale.email)).toBe(false);

    const liveAgencyEmailsAfter = listReconciledLivePlatformAgencies().map((agency) => agency.contactEmail);

    expect(liveAgencyEmailsAfter).toEqual(liveAgencyEmailsBefore);
    expect(api.agencies.list().some((agency) => agency.contactEmail === sale.email)).toBe(false);
    expect(api.softwareSales.get(sale.id)?.status).toBe("paid");
  });

  it("reconciles a paid software sale into the live agency list after refresh", () => {
    const sale = api.softwareSales.create({
      agencyName: "Paid Refresh Agency",
      contactName: "Pat Buyer",
      email: "billing@paid-refresh.example",
      tier: "mid",
      seats: 25,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(25, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "transaction_site",
      paymentMode: "stripe_checkout",
      stripeCheckoutSessionId: "cs_paid_refresh",
      stripeCustomerId: "cus_paid_refresh",
      stripeSubscriptionId: "sub_paid_refresh",
      stripeSubscriptionTermStartedAt: "2026-06-28T20:00:00.000Z",
      stripeSubscriptionTermEndsAt: "2028-06-28T20:00:00.000Z",
      stripeSubscriptionCancelAt: "2028-06-28T20:00:00.000Z",
      termMonths: 24,
    });

    api.softwareSales.update(sale.id, {
      status: "paid",
      stripePaymentStatus: "paid",
      stripePaidAt: "2026-06-28T20:00:00.000Z",
    });

    expect(api.agencies.list().some((agency) => agency.contactEmail === sale.email)).toBe(false);

    const provisioned = reconcilePaidSoftwareSalesToAgencies();
    const agency = api.agencies.list().find((row) => row.contactEmail === sale.email);

    expect(provisioned.map((row) => row.id)).toContain(agency?.id);
    expect(agency?.name).toBe("Paid Refresh Agency");
    expect(agency?.stripeCustomerId).toBe("cus_paid_refresh");
    expect(agency?.stripeSubscriptionId).toBe("sub_paid_refresh");
    expect(agency?.softwarePlanTermMonths).toBe(24);
    expect(agency?.softwarePlanStartedAt).toBe("2026-06-28T20:00:00.000Z");
    expect(agency?.softwarePlanRenewsAt).toBe("2028-06-28T20:00:00.000Z");
    expect(agency?.stripeSubscriptionCancelAt).toBe("2028-06-28T20:00:00.000Z");
    expect(api.softwareSales.get(sale.id)?.status).toBe("paid");
  });

  it("keeps a deactivated agency suspended after paid-sale reconciliation", () => {
    const sale = api.softwareSales.create({
      agencyName: "Suspended Agency",
      contactName: "Sasha Suspend",
      email: "billing@suspended-agency.example",
      tier: "mid",
      seats: 25,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(25, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "stripe_checkout",
      stripeCheckoutSessionId: "cs_suspended_agency",
      stripeCustomerId: "cus_suspended_agency",
      status: "paid",
      stripePaymentStatus: "paid",
      stripePaidAt: "2026-06-28T20:00:00.000Z",
    });
    const agency = provisionAgencyForCompletedSale(sale);
    const master = api.users.create({
      role: "master_admin",
      tenantId: null,
      email: "founder@suspended-agency.example",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });

    const deactivated = api.agencies.deactivate(agency.id, { actorId: master.id });

    expect(deactivated?.active).toBe(false);
    expect(agencyMonthlyPriceUsd(deactivated!)).toBe(0);
    expect(deactivated?.monthlyPriceOverrideReason).toMatch(/suspended/i);
    const notice = db
      .list("communications")
      .find((row) => row.tenantId === agency.id && row.subject === "Quotex agency access deactivated");
    expect(notice?.externalRecipientEmail).toBe("billing@suspended-agency.example");
    expect(notice?.body).toContain("Billing has been suspended");
    expect(db.list("mailboxOutbox").some((job) => job.communicationId === notice?.id)).toBe(true);

    reconcilePaidSoftwareSalesToAgencies();
    const reconciled = api.agencies.get(agency.id);

    expect(reconciled?.active).toBe(false);
    expect(agencyMonthlyPriceUsd(reconciled!)).toBe(0);
    expect(
      api.masterAgencyActivities
        .list({ agencyId: agency.id, kind: "agency_deactivated" })
        .some((activity) => String(activity.metadata?.noticeCommunicationId ?? "") === notice?.id)
    ).toBe(true);
  });

  it("restores saved agency plan, pricing, and subscription details after reactivation", () => {
    const agency = api.agencies.create({
      name: "Restore Everything Agency",
      contactEmail: "billing@restore-everything.example",
      phone: "517-294-2671",
      address: "123 Main St",
      website: "https://restore-everything.example",
      serviceAreas: ["MI"],
      tier: "mid",
      softwareProduct: "full_platform",
      allowedUsers: 25,
      allowedProspectsPerMonth: 250,
      allowedAiMessagesPerMonth: 1_500,
      allowedCarriers: 42,
      websiteAppAddOn: "website_app",
      softwarePlanTermMonths: 24,
      softwarePlanStartedAt: "2026-06-01T00:00:00.000Z",
      softwarePlanRenewsAt: "2028-06-01T00:00:00.000Z",
      monthlyPriceOverrideUsd: 6_750,
      monthlyPriceOverrideReason: "Founder approved launch price",
      monthlyPriceOverrideUpdatedAt: "2026-06-01T00:00:00.000Z",
      stripeCustomerId: "cus_restore_everything",
      stripeSubscriptionId: "sub_restore_everything",
      stripeSubscriptionTermStartedAt: "2026-06-01T00:00:00.000Z",
      stripeSubscriptionTermEndsAt: "2028-06-01T00:00:00.000Z",
      stripeSubscriptionCancelAt: "2028-06-01T00:00:00.000Z",
    });
    const original = {
      tier: agency.tier,
      softwareProduct: agency.softwareProduct,
      allowedUsers: agency.allowedUsers,
      allowedProspectsPerMonth: agency.allowedProspectsPerMonth,
      allowedAiMessagesPerMonth: agency.allowedAiMessagesPerMonth,
      allowedCarriers: agency.allowedCarriers,
      websiteAppAddOn: agency.websiteAppAddOn,
      softwarePlanTermMonths: agency.softwarePlanTermMonths,
      softwarePlanStartedAt: agency.softwarePlanStartedAt,
      softwarePlanRenewsAt: agency.softwarePlanRenewsAt,
      monthlyPriceOverrideUsd: agency.monthlyPriceOverrideUsd,
      monthlyPriceOverrideReason: agency.monthlyPriceOverrideReason,
      monthlyPriceOverrideUpdatedAt: agency.monthlyPriceOverrideUpdatedAt,
      stripeCustomerId: agency.stripeCustomerId,
      stripeSubscriptionId: agency.stripeSubscriptionId,
      stripeSubscriptionTermStartedAt: agency.stripeSubscriptionTermStartedAt,
      stripeSubscriptionTermEndsAt: agency.stripeSubscriptionTermEndsAt,
      stripeSubscriptionCancelAt: agency.stripeSubscriptionCancelAt,
    };

    const deactivated = api.agencies.deactivate(agency.id);

    expect(deactivated?.active).toBe(false);
    expect(deactivated?.deactivationSnapshot?.values.monthlyPriceOverrideUsd).toBe(original.monthlyPriceOverrideUsd);
    expect(deactivated?.deactivationSnapshot?.values.stripeSubscriptionId).toBe(original.stripeSubscriptionId);
    expect(agencyMonthlyPriceUsd(deactivated!)).toBe(0);

    const reactivated = api.agencies.reactivate(agency.id);

    expect(reactivated?.active).toBe(true);
    expect(reactivated?.deactivationSnapshot).toBeUndefined();
    expect({
      tier: reactivated?.tier,
      softwareProduct: reactivated?.softwareProduct,
      allowedUsers: reactivated?.allowedUsers,
      allowedProspectsPerMonth: reactivated?.allowedProspectsPerMonth,
      allowedAiMessagesPerMonth: reactivated?.allowedAiMessagesPerMonth,
      allowedCarriers: reactivated?.allowedCarriers,
      websiteAppAddOn: reactivated?.websiteAppAddOn,
      softwarePlanTermMonths: reactivated?.softwarePlanTermMonths,
      softwarePlanStartedAt: reactivated?.softwarePlanStartedAt,
      softwarePlanRenewsAt: reactivated?.softwarePlanRenewsAt,
      monthlyPriceOverrideUsd: reactivated?.monthlyPriceOverrideUsd,
      monthlyPriceOverrideReason: reactivated?.monthlyPriceOverrideReason,
      monthlyPriceOverrideUpdatedAt: reactivated?.monthlyPriceOverrideUpdatedAt,
      stripeCustomerId: reactivated?.stripeCustomerId,
      stripeSubscriptionId: reactivated?.stripeSubscriptionId,
      stripeSubscriptionTermStartedAt: reactivated?.stripeSubscriptionTermStartedAt,
      stripeSubscriptionTermEndsAt: reactivated?.stripeSubscriptionTermEndsAt,
      stripeSubscriptionCancelAt: reactivated?.stripeSubscriptionCancelAt,
    }).toEqual(original);
    expect(agencyMonthlyPriceUsd(reactivated!)).toBe(original.monthlyPriceOverrideUsd);
  });

  it("closes invoice-sent sales after reconciling the agency", () => {
    const sale = api.softwareSales.create({
      agencyName: "Invoice Sent Agency",
      contactName: "Ivy Buyer",
      email: "billing@invoice-sent.example",
      tier: "minimum",
      seats: 10,
      estimatedMonthly: softwareSaleMonthlyTotalForSeats(10, "none"),
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: "none",
      websiteAppAddOnMonthly: 0,
      source: "master_portal",
      paymentMode: "manual_invoice",
      status: "paid",
      invoiceEmailStatus: "sent",
      invoiceEmailSentAt: "2026-06-28T20:05:00.000Z",
    });

    reconcilePaidSoftwareSalesToAgencies();

    expect(api.agencies.list().some((agency) => agency.contactEmail === sale.email)).toBe(true);
    expect(api.softwareSales.get(sale.id)?.status).toBe("closed");
  });

  it("allows the first real master portal user and blocks a second one", () => {
    expect(api.users.list().some((user) => user.role === "master_admin")).toBe(false);

    const firstMaster = api.users.create({
      role: "master_admin",
      tenantId: null,
      email: "founder@example.com",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });
    expect(firstMaster.role).toBe("master_admin");

    expect(() =>
      api.users.create({
        role: "master_admin",
        tenantId: null,
        email: "second-master@example.com",
        name: "Second Master",
      })
    ).toThrow("master_admin_limit_reached");

    const updated = api.users.update(firstMaster.id, { name: "Founder Updated" });
    expect(updated?.name).toBe("Founder Updated");
  });

  it("finds the master account even when the browser is scoped to an agency user", () => {
    const firstMaster = api.users.create({
      role: "master_admin",
      tenantId: null,
      email: "founder@example.com",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });
    const agencyUser = db.list("users").find((user) => user.tenantId && user.role === "manager");
    expect(agencyUser).toBeTruthy();
    window.localStorage.setItem("quotex.auth.userId.v1", agencyUser!.id);

    expect(api.users.list(null).some((user) => user.id === firstMaster.id)).toBe(false);
    expect(api.users.masterAccountExists()).toBe(true);
    expect(api.users.masterByEmail(" founder@example.com ")?.id).toBe(firstMaster.id);
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
