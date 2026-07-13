import { describe, expect, it } from "vitest";

import {
  deriveAssetLabel,
  formatAssetValue,
  looksLikeVin,
} from "@/lib/assetLabels";

describe("assetLabels", () => {
  it("builds vehicle labels from verified details and a shortened VIN", () => {
    expect(
      deriveAssetLabel("luxury_vehicle", {
        year: 2023,
        make: "DODGE",
        model: "CHARGER GT",
        vin: "2C3CDXMG3PH675983",
      })
    ).toBe("2023 Dodge Charger GT - VIN ...675983");
  });

  it("never returns a bare VIN for VIN-only vehicles", () => {
    expect(
      deriveAssetLabel("luxury_vehicle", {
        vin: "2c3cdxmg3ph675983",
      })
    ).toBe("Vehicle - VIN ...675983");
  });

  it("protects the bare-VIN invariant even when a custom label is a VIN", () => {
    expect(
      deriveAssetLabel("luxury_vehicle", {
        customLabel: "1HGCM82633A004352",
      })
    ).toBe("Vehicle - VIN ...004352");
  });

  it("uses property addresses for homes without fabricating values", () => {
    expect(
      deriveAssetLabel("coastal_home", {
        propertyAddress: "901 McDonald Dr, Northville, MI 48167",
      })
    ).toBe("901 McDonald Dr");
    expect(formatAssetValue(0)).toBe("Value pending");
  });

  it("validates VIN-looking strings without accepting invalid VIN lengths or letters", () => {
    expect(looksLikeVin("1HGCM82633A004352")).toBe(true);
    expect(looksLikeVin("1HGCM82633A00435")).toBe(false);
    expect(looksLikeVin("1HGCM82633A0043521")).toBe(false);
    expect(looksLikeVin("1HGCM82633A00435Q")).toBe(false);
  });
});
