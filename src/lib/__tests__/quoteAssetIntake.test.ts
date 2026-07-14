import { describe, expect, it } from "vitest";

import {
  primaryQuoteAssetAddress,
  QUOTE_ASSET_DETAIL_FIELDS,
  quoteAssetPublicFieldValue,
} from "../quoteAssetIntake";

describe("quoteAssetIntake vehicle addresses", () => {
  it("does not use mailing, property, or fallback addresses as vehicle garaging", () => {
    const details = {
      address: "100 Mailing St, Palm Beach, FL 33480",
      propertyAddress: "200 Home Rd, Palm Beach, FL 33480",
      riskAddress: "300 Risk Ave, Palm Beach, FL 33480",
    };

    expect(primaryQuoteAssetAddress("luxury_vehicle", details)).toBeUndefined();
    expect(
      quoteAssetPublicFieldValue("luxury_vehicle", "Garaging address", details, {
        address: "400 Fallback Ln, Palm Beach, FL 33480",
      })
    ).toBeUndefined();
  });

  it("uses only an explicit vehicle garaging address", () => {
    const details = {
      garageAddress: "901 Correct Garage Dr, Northville, MI 48167",
      address: "100 Mailing St, Palm Beach, FL 33480",
    };

    expect(primaryQuoteAssetAddress("luxury_vehicle", details)).toBe(
      "901 Correct Garage Dr, Northville, MI 48167"
    );
    expect(quoteAssetPublicFieldValue("luxury_vehicle", "Garaging address", details)).toBe(
      "901 Correct Garage Dr, Northville, MI 48167"
    );
  });

  it("keeps home and auto quote sheet fields available to AI intake", () => {
    const homeKeys = QUOTE_ASSET_DETAIL_FIELDS.coastal_home.map((field) => field.key);
    const autoKeys = QUOTE_ASSET_DETAIL_FIELDS.luxury_vehicle.map((field) => field.key);

    expect(homeKeys).toEqual(
      expect.arrayContaining([
        "riskAddress",
        "occupancy",
        "yearBuilt",
        "foundationDetails",
        "roofShapePitch",
        "heatingCoolingSystems",
        "electricalAndSafetySystems",
        "homeDiscountsAndProtection",
      ])
    );
    expect(autoKeys).toEqual(
      expect.arrayContaining([
        "vin",
        "purchaseAndOwnership",
        "lienholderOrLessor",
        "businessDeliveryRideshareUse",
        "coverageLimits",
        "physicalDamageDeductibles",
        "driverIncidents",
        "priorAutoCarrier",
      ])
    );
  });
});
