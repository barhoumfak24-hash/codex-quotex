import type {
  DocumentFillableDetection,
  DocumentTemplateFieldBox,
  TemplateFieldMap,
} from "@/types";

export type FillableDocumentDetectionResult = {
  detection: DocumentFillableDetection;
  templateFields: TemplateFieldMap;
  templateFieldLayout: DocumentTemplateFieldBox[];
};

export type FillableDocumentInput = {
  fileName: string;
  fileType?: string;
  type?: string;
  documentName?: string;
  baseFields?: TemplateFieldMap;
};

const staticDetection = (reason: string): DocumentFillableDetection => ({
  detected: false,
  confidence: 0.18,
  reason,
  detectedAt: new Date().toISOString(),
});

export function detectFillableDocumentFields(
  input: FillableDocumentInput
): FillableDocumentDetectionResult {
  const baseFields = { ...(input.baseFields ?? {}) };
  const semanticText = [
    input.fileName,
    input.type,
    input.documentName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const fileName = input.fileName.toLowerCase();
  const isLikelyDocument = /\.(pdf|docx?|png|jpe?g)$/i.test(input.fileName) ||
    /pdf|word|image|document/.test(input.fileType ?? "");
  if (!isLikelyDocument) {
    return {
      detection: staticDetection("File type is not a form-friendly document."),
      templateFields: baseFields,
      templateFieldLayout: [],
    };
  }

  const matchedLayout = layoutForText(semanticText, fileName);
  if (!matchedLayout) {
    return {
      detection: staticDetection("No fillable field pattern detected. The file will be stored as a static template."),
      templateFields: baseFields,
      templateFieldLayout: [],
    };
  }

  const templateFields = { ...baseFields };
  matchedLayout.fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(templateFields, field.label)) {
      templateFields[field.label] = "";
    }
  });

  return {
    detection: {
      detected: true,
      confidence: matchedLayout.confidence,
      reason: matchedLayout.reason,
      detectedAt: new Date().toISOString(),
    },
    templateFields,
    templateFieldLayout: matchedLayout.fields,
  };
}

function layoutForText(
  text: string,
  fileName: string
): { reason: string; confidence: number; fields: DocumentTemplateFieldBox[] } | null {
  if (/\bacord[-_\s]?0?25\b/.test(fileName) || /certificate[-_\s]+of[-_\s]+liability/.test(text)) {
    return {
      reason: "ACORD 25 / certificate of liability style form detected.",
      confidence: 0.94,
      fields: acord25Layout(),
    };
  }
  if (/\bacord[-_\s]?0?27\b/.test(fileName) || /evidence[-_\s]+of[-_\s]+property/.test(text)) {
    return {
      reason: "ACORD 27 / evidence of property style form detected.",
      confidence: 0.92,
      fields: acord27Layout(),
    };
  }
  if (/\bacord[-_\s]?0?(126|127|128|129|131|140|152|611|810|823|1035)\b/.test(fileName)) {
    return {
      reason: "Commercial ACORD section or supplemental form detected.",
      confidence: 0.82,
      fields: commercialSupplementalLayout(),
    };
  }
  if (
    /supplemental|supplementary/.test(text) ||
    /carrier_supplemental/.test(text)
  ) {
    return {
      reason: "Carrier supplemental form detected.",
      confidence: 0.88,
      fields: commercialSupplementalLayout(),
    };
  }
  if (
    /application|app\b|intake|questionnaire/.test(text) ||
    /carrier_application/.test(text)
  ) {
    return {
      reason: "Insurance application or intake form detected.",
      confidence: 0.84,
      fields: insuranceApplicationLayout(),
    };
  }
  if (/checklist|inspection|wind mitigation|wind_mitigation/.test(text)) {
    return {
      reason: "Inspection or checklist form detected.",
      confidence: 0.78,
      fields: inspectionChecklistLayout(),
    };
  }
  if (/form|fillable|blank/.test(text)) {
    return {
      reason: "Generic blank form detected.",
      confidence: 0.68,
      fields: genericFormLayout(),
    };
  }
  if (/\bacord[-_\s]?0?\d{1,4}\b/.test(fileName) || /\bacord\b/.test(text)) {
    return {
      reason: "ACORD form detected.",
      confidence: 0.72,
      fields: genericFormLayout(),
    };
  }
  return null;
}

function box(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<DocumentTemplateFieldBox> = {}
): DocumentTemplateFieldBox {
  return {
    label,
    page: 1,
    x,
    y,
    width,
    height,
    source: "detected",
    kind: "text",
    ...extra,
  };
}

function acord25Layout(): DocumentTemplateFieldBox[] {
  return [
    box("Agency", 8, 14, 34, 4.8, { required: true }),
    box("Agency phone", 45, 14, 20, 4.8),
    box("Agency email", 67, 14, 25, 4.8),
    box("Client name", 8, 23, 40, 5.4, { required: true }),
    box("Client address", 50, 23, 42, 5.4, { multiline: true }),
    box("Carrier", 8, 36, 30, 4.6),
    box("Policy number", 40, 36, 22, 4.6, { required: true }),
    box("Effective date", 64, 36, 13, 4.6, { kind: "date" }),
    box("Expiration date", 79, 36, 13, 4.6, { kind: "date" }),
    box("General liability limit", 8, 49, 24, 4.2, { kind: "currency" }),
    box("Automobile liability limit", 35, 49, 24, 4.2, { kind: "currency" }),
    box("Umbrella limit", 62, 49, 24, 4.2, { kind: "currency" }),
    box("Description of operations", 8, 62, 84, 13, { multiline: true }),
    box("Certificate holder", 8, 81, 54, 8.5, { multiline: true }),
    box("Authorized representative", 65, 83, 27, 6.5),
  ];
}

function acord27Layout(): DocumentTemplateFieldBox[] {
  return [
    box("Agency", 8, 14, 36, 4.8, { required: true }),
    box("Client name", 8, 23, 40, 5.2, { required: true }),
    box("Property address", 50, 23, 42, 5.2, { multiline: true, required: true }),
    box("Carrier", 8, 34, 30, 4.6),
    box("Policy number", 40, 34, 24, 4.6, { required: true }),
    box("Effective date", 66, 34, 12, 4.6, { kind: "date" }),
    box("Expiration date", 80, 34, 12, 4.6, { kind: "date" }),
    box("Coverage amount", 8, 48, 22, 4.5, { kind: "currency" }),
    box("Deductible", 32, 48, 18, 4.5, { kind: "currency" }),
    box("Mortgagee / lienholder", 8, 69, 55, 9, { multiline: true }),
    box("Loan number", 66, 69, 26, 4.8),
    box("Authorized representative", 62, 84, 30, 6),
  ];
}

function insuranceApplicationLayout(): DocumentTemplateFieldBox[] {
  return [
    box("Client name", 8, 13, 36, 4.8, { required: true }),
    box("Business legal name", 47, 13, 45, 4.8),
    box("Mailing address", 8, 22, 40, 6, { multiline: true, required: true }),
    box("Risk / property address", 52, 22, 40, 6, { multiline: true }),
    box("Phone", 8, 33, 22, 4.6),
    box("Email", 33, 33, 30, 4.6),
    box("Requested effective date", 66, 33, 26, 4.6, { kind: "date" }),
    box("Policy number", 8, 45, 25, 4.6),
    box("Carrier", 36, 45, 28, 4.6),
    box("Premium", 67, 45, 25, 4.6, { kind: "currency" }),
    box("Description of operations", 8, 58, 84, 12, { multiline: true }),
    box("Loss history", 8, 74, 84, 9, { multiline: true }),
    box("Applicant signature", 8, 88, 36, 5),
    box("Signature date", 47, 88, 18, 5, { kind: "date" }),
  ];
}

function commercialSupplementalLayout(): DocumentTemplateFieldBox[] {
  return [
    box("Business legal name", 8, 13, 44, 4.8, { required: true }),
    box("FEIN", 56, 13, 24, 4.8),
    box("Primary contact", 8, 22, 34, 4.8),
    box("Contact email", 45, 22, 35, 4.8),
    box("Years in business", 8, 34, 20, 4.5, { kind: "number" }),
    box("Annual revenue", 31, 34, 24, 4.5, { kind: "currency" }),
    box("Annual payroll", 58, 34, 24, 4.5, { kind: "currency" }),
    box("Description of operations", 8, 47, 84, 15, { multiline: true, required: true }),
    box("Subcontractor controls", 8, 66, 84, 8, { multiline: true }),
    box("Prior carrier", 8, 79, 32, 4.8),
    box("Loss history", 43, 79, 49, 8, { multiline: true }),
    box("Applicant signature", 8, 91, 36, 4.5),
    box("Signature date", 47, 91, 18, 4.5, { kind: "date" }),
  ];
}

function inspectionChecklistLayout(): DocumentTemplateFieldBox[] {
  return [
    box("Client name", 8, 14, 38, 5, { required: true }),
    box("Property address", 49, 14, 43, 6.5, { multiline: true, required: true }),
    box("Inspection date", 8, 26, 20, 4.8, { kind: "date" }),
    box("Inspector / company", 31, 26, 34, 4.8),
    box("Roof year", 8, 39, 15, 4.4, { kind: "number" }),
    box("Electrical updated", 26, 39, 20, 4.4),
    box("Plumbing updated", 49, 39, 20, 4.4),
    box("HVAC updated", 72, 39, 20, 4.4),
    box("Findings / notes", 8, 54, 84, 17, { multiline: true }),
    box("Recommended repairs", 8, 76, 84, 10, { multiline: true }),
  ];
}

function genericFormLayout(): DocumentTemplateFieldBox[] {
  return [
    box("Client name", 8, 18, 40, 5, { required: true }),
    box("Policy number", 52, 18, 28, 5),
    box("Date", 8, 30, 20, 5, { kind: "date" }),
    box("Details", 8, 43, 84, 18, { multiline: true }),
    box("Signature", 8, 80, 38, 5),
  ];
}
