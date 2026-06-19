import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAcroFormFillPlan,
  buildAcroFormValues,
  bytesToPdfDataUrl,
  extractAcroFormFields,
  fillPdfAcroForm,
} from "../pdfAcroForm";

function bundledPdf(fileName: string): Uint8Array {
  return readFileSync(`public/acord/${fileName}`);
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

describe("pdfAcroForm", () => {
  it("fills native ACORD text fields with visible appearance streams", () => {
    const pdf = bundledPdf("ACORD-125.pdf");
    const fields = extractAcroFormFields(pdf);
    const plan = buildAcroFormFillPlan(
      {
        Agency: "Palm Coast Private Client",
        "Agency address": "100 Ocean Drive, Palm Coast, FL 32137",
        "Agency phone": "(386) 555-0137",
        "Agency email": "service@palmcoast.example",
        "Agency website": "https://palmcoast.example",
        "Business legal name": "Coastal Logistics LLC",
        "Entity type": "Limited liability company",
        "Mailing address": "700 Marina Way, Palm Coast, FL 32137",
        "Contact email": "alexandra@coastallogistics.example",
        "Phone": "(386) 555-0180",
        "Policy number": "BOP-24-01822",
        "Property address": "700 Marina Way, Palm Coast, FL 32137",
        "Description of operations": "Regional freight brokerage and warehouse support.",
      },
      fields
    );
    const values = buildAcroFormValues(
      {
        Agency: "Palm Coast Private Client",
        "Agency address": "100 Ocean Drive, Palm Coast, FL 32137",
        "Agency phone": "(386) 555-0137",
        "Agency email": "service@palmcoast.example",
        "Agency website": "https://palmcoast.example",
        "Business legal name": "Coastal Logistics LLC",
        "Entity type": "Limited liability company",
        "Mailing address": "700 Marina Way, Palm Coast, FL 32137",
        "Contact email": "alexandra@coastallogistics.example",
        "Phone": "(386) 555-0180",
        "Policy number": "BOP-24-01822",
        "Property address": "700 Marina Way, Palm Coast, FL 32137",
        "Description of operations": "Regional freight brokerage and warehouse support.",
      },
      fields
    );

    expect(values["F[0].P1[0].Producer_FullName_A[0]"]).toBe(
      "Palm Coast Private Client"
    );
    expect(values["F[0].P1[0].Producer_MailingAddress_LineOne_A[0]"]).toBe(
      "100 Ocean Drive"
    );
    expect(values["F[0].P1[0].Producer_ContactPerson_PhoneNumber_A[0]"]).toBe(
      "(386) 555-0137"
    );
    expect(values["F[0].P1[0].Producer_ContactPerson_EmailAddress_A[0]"]).toBe(
      "service@palmcoast.example"
    );
    expect(values["F[0].P1[0].Producer_FaxNumber_A[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].Producer_ContactPerson_FullName_A[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].NamedInsured_FullName_A[0]"]).toBe(
      "Coastal Logistics LLC"
    );
    expect(values["F[0].P1[0].NamedInsured_Primary_WebsiteAddress_A[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].NamedInsured_FullName_B[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].NamedInsured_MailingAddress_LineOne_B[0]"]).toBeUndefined();
    const withoutAgencyContactValues = buildAcroFormValues(
      {
        Agency: "Palm Coast Private Client",
        "Business legal name": "Coastal Logistics LLC",
        Phone: "(386) 555-0180",
        Email: "alexandra@coastallogistics.example",
      },
      fields
    );
    expect(withoutAgencyContactValues["F[0].P1[0].Producer_ContactPerson_PhoneNumber_A[0]"]).toBeUndefined();
    expect(withoutAgencyContactValues["F[0].P1[0].Producer_ContactPerson_EmailAddress_A[0]"]).toBeUndefined();
    expect(plan.filledFieldCount).toBeGreaterThan(6);
    expect(plan.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLabel: "Agency",
          targetField: "F[0].P1[0].Producer_FullName_A[0]",
          source: "system",
        }),
        expect.objectContaining({
          sourceLabel: "Business legal name",
          targetField: "F[0].P1[0].NamedInsured_FullName_A[0]",
          source: "contact",
        }),
      ])
    );

    const filled = fillPdfAcroForm(pdf, values);
    const text = latin1(filled);
    const dataUrl = bytesToPdfDataUrl(filled);

    expect(text).toContain("/V (Palm Coast Private Client)");
    expect(text).toContain("(Palm Coast Private Client) Tj");
    expect(text).toContain("/AP << /N");
    expect(text).toContain("/AS /1");
    expect(text).toContain("/Prev 430526");
    expect(dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });

  it("does not guess fax, secondary email, or generic ACORD fields without exact data", () => {
    const pdf = bundledPdf("ACORD-003.pdf");
    const acro3Fields = extractAcroFormFields(pdf);
    const unscopedValues = buildAcroFormValues(
      {
        Agency: "Palm Coast Private Client",
        "Agency address": "900 Agency Row, Palm Coast, FL 32137",
        "Agency phone": "(386) 555-0137",
        "Agency email": "service@palmcoast.example",
        "Business legal name": "Coastal Logistics LLC",
        "Mailing address": "44 Sea Breeze Ln, Palm Beach, FL 33480",
        Email: "alexandra@coastallogistics.example",
      },
      acro3Fields
    );
    expect(unscopedValues["F[0].P1[0].Text2[0]"]).toBeUndefined();

    const values = buildAcroFormValues(
      {
        "Source ACORD file": "ACORD-003.pdf",
        Agency: "Palm Coast Private Client",
        "Agency address": "900 Agency Row, Palm Coast, FL 32137",
        "Agency phone": "(386) 555-0137",
        "Agency email": "service@palmcoast.example",
        "Business legal name": "Coastal Logistics LLC",
        "Mailing address": "44 Sea Breeze Ln, Palm Beach, FL 33480",
        "Contact email": "alexandra@coastallogistics.example",
        Phone: "(386) 555-0180",
        Carrier: "Chubb Masterpiece",
        "Policy number": "BOP-24-01822",
      },
      acro3Fields
    );

    expect(values["F[0].P1[0].Text2[0]"]).toBe("Palm Coast Private Client");
    expect(values["F[0].P1[0].Text3[0]"]).toBe("900 Agency Row");
    expect(values["F[0].P1[0].Text4[0]"]).toBe("Palm Coast, FL 32137");
    expect(values["F[0].P1[0].Text5[0]"]).toBe("(386) 555-0137");
    expect(values["F[0].P1[0].Text7[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].Text10[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].Text11[0]"]).toBe("service@palmcoast.example");
    expect(values["F[0].P1[0].Text21[0]"]).toBe("Coastal Logistics LLC");
    expect(values["F[0].P1[0].Text26[0]"]).toBe("44 Sea Breeze Ln");
    expect(values["F[0].P1[0].Text27[0]"]).toBeUndefined();
    expect(values["F[0].P1[0].Text28[0]"]).toBe("Palm Beach");
    expect(values["F[0].P1[0].Text29[0]"]).toBe("FL");
    expect(values["F[0].P1[0].Text30[0]"]).toBe("33480");

    const sensitiveValues = buildAcroFormValues(
      {
        Email: "primary@example.com",
        "Agency phone": "(386) 555-0137",
      },
      [
        {
          objectNumber: 1,
          generation: 0,
          name: "Secondary_Email_A",
          partialName: "Secondary_Email_A",
          fieldType: "/Tx",
        },
        {
          objectNumber: 2,
          generation: 0,
          name: "Agency_Fax_A",
          partialName: "Agency_Fax_A",
          fieldType: "/Tx",
        },
      ]
    );
    expect(sensitiveValues.Secondary_Email_A).toBeUndefined();
    expect(sensitiveValues.Agency_Fax_A).toBeUndefined();
  });

  it("does not use remarks as a fallback for ACORD explanation fields", () => {
    const values = buildAcroFormValues(
      {
        "Additional remarks":
          "Chubb Masterpiece closed claim #CR-CHB-558920-2. AI quoting workflow started.",
        Remarks: "Client activity timeline text that should not be copied into ACORD questions.",
      },
      [
        {
          objectNumber: 1,
          generation: 0,
          name: "GeneralInformation_ExplainYesResponses_8",
          partialName: "ExplainYesResponses_8",
          fieldType: "/Tx",
          tooltip: 'EXPLAIN ALL "YES" RESPONSES',
        },
      ]
    );

    expect(values.GeneralInformation_ExplainYesResponses_8).toBeUndefined();
  });
});
