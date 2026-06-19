// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api";
import { db } from "../db";

beforeEach(() => {
  window.localStorage.clear();
  db.reset();
});

describe("masterAgencyActivities", () => {
  it("seeds a timestamped agency history for the master portal", () => {
    const activities = api.masterAgencyActivities.list();

    expect(activities.length).toBeGreaterThanOrEqual(6);
    expect(activities[0].createdAt >= activities[activities.length - 1].createdAt).toBe(true);
    expect(activities.some((activity) => activity.kind === "agency_created")).toBe(true);
    expect(activities.some((activity) => activity.kind === "agency_carrier_runner_updated")).toBe(true);
  });

  it("logs manual monthly price changes without exposing protected values", () => {
    const agency = api.agencies.list()[0];

    api.agencies.update(agency.id, {
      monthlyPriceOverrideUsd: 4200,
      monthlyPriceOverrideReason: "Founder-approved relationship price",
      monthlyPriceOverrideUpdatedAt: new Date().toISOString(),
    });

    const latest = api.masterAgencyActivities.list({ agencyId: agency.id })[0];
    expect(latest.kind).toBe("agency_price_updated");
    expect(latest.title).toMatch(/monthly price/i);
    expect(latest.description).toContain("$4,200");
    expect(JSON.stringify(latest.metadata)).not.toMatch(/encrypted|secret|credential/i);
  });

  it("logs renewal contract send and completed renewal events", () => {
    const agency = api.agencies.list()[0];

    api.agencies.sendRenewalContract(agency.id);
    expect(api.masterAgencyActivities.list({ agencyId: agency.id })[0].kind).toBe(
      "agency_renewal_contract_sent"
    );

    api.agencies.completeRenewalContractSignature(agency.id);
    const latest = api.masterAgencyActivities.list({ agencyId: agency.id })[0];
    expect(latest.kind).toBe("agency_renewed");
    expect(latest.description).toMatch(/term rolled forward/i);
  });
});
