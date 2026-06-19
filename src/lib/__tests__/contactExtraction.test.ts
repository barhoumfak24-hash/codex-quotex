import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiExtractContactFromFile } from "../ai";

describe("aiExtractContactFromFile", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_AI_MODE", "");
  });

  it("extracts commercial client fields from uploaded intake text", async () => {
    const out = await aiExtractContactFromFile({
      fileName: "jenkins-commercial-intake.txt",
      fileType: "text/plain",
      text: [
        "Business Name: Jenkins Marine Services LLC",
        "Primary Contact: Sarah Jenkins",
        "Email: sarah@jenkinsmarine.example",
        "Phone: (561) 555-1842",
        "Mailing Address: 1440 Harbor Drive, West Palm Beach, FL 33401",
        "Coverage Requested: Business owners policy and general liability",
        "Estimated Value: $1,250,000",
      ].join("\n"),
    });

    expect(out.lineOfBusiness).toBe("commercial");
    expect(out.businessName).toBe("Jenkins Marine Services LLC");
    expect(out.name).toBe("Sarah Jenkins");
    expect(out.email).toBe("sarah@jenkinsmarine.example");
    expect(out.phone).toContain("555");
    expect(out.address).toContain("West Palm Beach, FL 33401");
    expect(out.estimatedValue).toBe(1_250_000);
    expect(out.sources).toContain("Full document text scan");
  });

  it("extracts personal auto signals without inventing missing contact fields", async () => {
    const out = await aiExtractContactFromFile({
      fileName: "vehicle-screenshot.txt",
      fileType: "text/plain",
      text: [
        "Client Name: Olivia Test",
        "olivia.test@example.com",
        "Garaging Address: 22 Lake Road, Orlando, FL 32801",
        "VIN: 1HGCM82633A004352",
        "Agreed Value: $85,000",
      ].join("\n"),
    });

    expect(out.lineOfBusiness).toBe("personal");
    expect(out.name).toBe("Olivia Test");
    expect(out.assetType).toBe("luxury_vehicle");
    expect(out.estimatedValue).toBe(85_000);
    expect(out.businessName).toBeUndefined();
  });

  it("does not fabricate contact data when the upload has no readable fields", async () => {
    const out = await aiExtractContactFromFile({
      fileName: "blank-screenshot.png",
      fileType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    });

    expect(out.name).toBeUndefined();
    expect(out.email).toBeUndefined();
    expect(out.confidence).toBeLessThan(0.3);
    expect(out.sources).toContain("No fabricated filename data");
  });
});
