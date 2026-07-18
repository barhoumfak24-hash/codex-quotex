import { describe, expect, it } from "vitest";
import { assetLookupQuestion } from "../assetLookup";
import { cleanQuoteAssetDetails } from "../quoteAssetIntake";
import type { CategoryQuestion } from "@/types";

const addressQuestion: CategoryQuestion = {
  key: "propertyAddress",
  label: "Property address",
  inputType: "address",
};

describe("assetLookupQuestion", () => {
  it("uses only the property address to create a home asset", () => {
    const question = assetLookupQuestion("coastal_home", [
      addressQuestion,
      { key: "occupancy", label: "Occupancy", inputType: "select" },
      { key: "yearBuilt", label: "Year built", inputType: "number" },
    ]);

    expect(question).toMatchObject({
      key: "propertyAddress",
      inputType: "address",
      required: true,
    });
  });

  it("uses only the VIN to create a vehicle asset", () => {
    const question = assetLookupQuestion("luxury_vehicle", [
      { key: "vehicleVin", label: "Vehicle VIN", inputType: "text" },
      { key: "yearMakeModel", label: "Year, make, and model", inputType: "text" },
    ]);

    expect(question).toMatchObject({
      key: "vehicleVin",
      label: "Vehicle VIN",
      required: true,
    });
  });

  it("uses the hull ID for yachts and does not ask for vessel details", () => {
    const question = assetLookupQuestion("yacht", [
      { key: "hin", label: "Hull ID / HIN", inputType: "text" },
      { key: "vesselName", label: "Vessel name", inputType: "text" },
    ]);

    expect(question).toMatchObject({ key: "hin", required: true });
  });

  it("uses a single asset identifier for jewelry instead of appraisal questions", () => {
    const question = assetLookupQuestion("jewelry", [
      { key: "appraisedValue", label: "Appraised value", inputType: "currency" },
      { key: "appraisalDate", label: "Appraisal date", inputType: "date" },
    ]);

    expect(question).toMatchObject({
      key: "assetIdentifier",
      label: "Serial, appraisal, or inventory ID",
      required: true,
    });
  });

  it("prefers a configured commercial risk address and otherwise uses an asset ID", () => {
    expect(
      assetLookupQuestion("other", [
        { key: "riskLocation", label: "Risk location", inputType: "address" },
        { key: "annualRevenue", label: "Annual revenue", inputType: "currency" },
      ])
    ).toMatchObject({ key: "riskLocation", required: true });

    expect(assetLookupQuestion("other", [])).toMatchObject({
      key: "assetIdentifier",
      label: "Asset address or ID number",
      required: true,
    });
  });

  it("keeps generic asset identifiers for later AI mapping", () => {
    expect(
      cleanQuoteAssetDetails("jewelry", { assetIdentifier: "APP-2026-1042" })
    ).toMatchObject({ assetIdentifier: "APP-2026-1042" });
    expect(
      cleanQuoteAssetDetails("other", { assetIdentifier: "PARCEL-44-901" })
    ).toMatchObject({ identifier: "PARCEL-44-901" });
  });

  it("normalizes the selected full-portfolio address without losing it", () => {
    expect(
      cleanQuoteAssetDetails("full_portfolio", {
        primaryResidenceAddress: "901 McDonald Dr, Northville, MI 48167",
      })
    ).toMatchObject({ primaryAddress: "901 McDonald Dr, Northville, MI 48167" });
  });
});
