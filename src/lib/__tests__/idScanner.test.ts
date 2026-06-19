import { describe, expect, it } from "vitest";
import { driverLicenseInputValue, parseAamvaDriverLicense } from "../idScanner";

describe("idScanner", () => {
  it("parses AAMVA PDF417 driver license fields", () => {
    const raw = [
      "@",
      "ANSI 636010080102DL00410288ZA03290015DLDAQD1234567",
      "DCSWHITFORD",
      "DACAlexandra",
      "DADMarie",
      "DBB19880214",
      "DBA20300214",
      "DBD20240214",
      "DAG210 Ocean Blvd",
      "DAIPalm Beach",
      "DAJFL",
      "DAK334800000",
      "DCFABC123456789",
    ].join("\n");

    const parsed = parseAamvaDriverLicense(raw);

    expect(parsed.licenseNumber).toBe("D1234567");
    expect(parsed.firstName).toBe("Alexandra");
    expect(parsed.lastName).toBe("WHITFORD");
    expect(parsed.state).toBe("FL");
    expect(parsed.dateOfBirth).toBe("1988-02-14");
    expect(parsed.expirationDate).toBe("2030-02-14");
    expect(driverLicenseInputValue(parsed)).toBe("FL D1234567");
  });

  it("normalizes MMDDYYYY date fields when a barcode uses legacy order", () => {
    const parsed = parseAamvaDriverLicense("DAQA7654321\nDAJGA\nDBB02141988");

    expect(parsed.dateOfBirth).toBe("1988-02-14");
    expect(driverLicenseInputValue(parsed)).toBe("GA A7654321");
  });
});
