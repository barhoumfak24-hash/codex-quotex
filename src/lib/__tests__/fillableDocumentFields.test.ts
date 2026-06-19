import { describe, expect, it } from "vitest";
import { detectFillableDocumentFields } from "../fillableDocumentFields";

describe("detectFillableDocumentFields", () => {
  it("detects ACORD certificate forms and preserves existing base fields", () => {
    const result = detectFillableDocumentFields({
      fileName: "ACORD-025-Certificate-of-Liability.pdf",
      fileType: "application/pdf",
      type: "agency_template",
      baseFields: {
        Agency: "Palm Coast Private Client",
        "Client name": "Alexandra Whitford",
      },
    });

    expect(result.detection.detected).toBe(true);
    expect(result.detection.reason).toContain("ACORD 25");
    expect(result.templateFields.Agency).toBe("Palm Coast Private Client");
    expect(result.templateFields["Client name"]).toBe("Alexandra Whitford");
    expect(result.templateFieldLayout.some((field) => field.label === "Certificate holder")).toBe(true);
    expect(result.templateFieldLayout.every((field) => field.source === "detected")).toBe(true);
  });

  it("detects commercial supplemental forms with operations fields", () => {
    const result = detectFillableDocumentFields({
      fileName: "General-Liability-Supplemental.pdf",
      fileType: "application/pdf",
      type: "carrier_supplemental",
    });

    expect(result.detection.detected).toBe(true);
    expect(result.templateFieldLayout.map((field) => field.label)).toContain("Description of operations");
    expect(result.templateFields["Description of operations"]).toBe("");
  });

  it("leaves ordinary static documents without overlay boxes", () => {
    const result = detectFillableDocumentFields({
      fileName: "Whitford-renewal-letter.pdf",
      fileType: "application/pdf",
      type: "policy_document",
      baseFields: { "File name": "Whitford-renewal-letter.pdf" },
    });

    expect(result.detection.detected).toBe(false);
    expect(result.templateFieldLayout).toEqual([]);
    expect(result.templateFields["File name"]).toBe("Whitford-renewal-letter.pdf");
  });
});
