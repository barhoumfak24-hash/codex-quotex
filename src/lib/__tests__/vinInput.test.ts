import { describe, expect, it } from "vitest";
import { isVinInputField, normalizeVinFieldValue, uppercaseVinInput } from "@/lib/vinInput";

describe("VIN input normalization", () => {
  it("uppercases typed and pasted VIN values", () => {
    expect(uppercaseVinInput("wp0ab2a99rs123456")).toBe("WP0AB2A99RS123456");
    expect(normalizeVinFieldValue({ key: "vin", label: "VIN" }, "1hgcm82633a004352")).toBe(
      "1HGCM82633A004352"
    );
  });

  it("detects direct VIN fields without treating freeform notes as VIN boxes", () => {
    expect(isVinInputField({ key: "vehicleVin", label: "Vehicle VIN" })).toBe(true);
    expect(isVinInputField({ key: "notes", label: "New details (address / VIN / make+model)" })).toBe(false);
    expect(
      normalizeVinFieldValue(
        { key: "notes", label: "New details (address / VIN / make+model)" },
        "new porsche vin wp0ab2a99rs123456"
      )
    ).toBe("new porsche vin wp0ab2a99rs123456");
  });
});
