import { describe, expect, it } from "vitest";
import {
  assetDisplayName,
  assetDisplaySubtitleLabel,
  buildAssetLabelFromDetails,
  formatAssetDetailValue,
} from "@/lib/assetDisplay";

describe("assetDisplay", () => {
  it("does not use a VIN as the primary vehicle asset name", () => {
    expect(
      assetDisplayName({
        type: "luxury_vehicle",
        label: "2c3cdxmg3ph675983",
        details: {},
      })
    ).toBe("Luxury Vehicle");
  });

  it("builds vehicle names from year make model before VIN", () => {
    expect(
      buildAssetLabelFromDetails({
        type: "luxury_vehicle",
        categoryLabel: "Auto",
        details: {
          vin: "2c3cdxmg3ph675983",
          year: "2023",
          make: "Chrysler",
          model: "300",
        },
      })
    ).toBe("2023 Chrysler 300");
  });

  it("lists vehicle assets by year make model and trim when VIN decode data is present", () => {
    expect(
      assetDisplayName({
        type: "luxury_vehicle",
        label: "2c3cdxmg3ph675983",
        details: {
          vin: "2c3cdxmg3ph675983",
          modelYear: "2023",
          vehicleMake: "Dodge",
          vehicleModel: "Charger",
          vehicleTrim: "GT",
        },
      })
    ).toBe("2023 Dodge Charger GT");
  });

  it("uses Vehicle as the subtitle label for vehicle assets", () => {
    expect(assetDisplaySubtitleLabel("luxury_vehicle")).toBe("Vehicle");
    expect(assetDisplaySubtitleLabel("coastal_home")).toBe("Coastal Home");
  });

  it("understands NHTSA-style series data without duplicating model words", () => {
    expect(
      buildAssetLabelFromDetails({
        type: "luxury_vehicle",
        categoryLabel: "Luxury Vehicle",
        details: {
          ModelYear: "2023",
          Make: "DODGE",
          Model: "Charger GT",
          Series: "GT",
          vin: "2c3cdxmg3ph675983",
        },
      })
    ).toBe("2023 DODGE Charger GT");
  });

  it("uppercases VIN detail values", () => {
    expect(formatAssetDetailValue("vin", "2c3cdxmg3ph675983")).toBe("2C3CDXMG3PH675983");
  });
});
