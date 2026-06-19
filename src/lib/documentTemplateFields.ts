import type { TemplateFieldMap } from "@/types";

export type TemplateFieldEntry = {
  label: string;
  value: string;
};

export type DocumentTemplateFieldSeed = {
  fileName?: string;
  documentTypeLabel?: string;
  documentName?: string;
  visibilityLabel?: string;
  statusLabel?: string;
  agencyName?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  assetLabel?: string;
  assetValue?: string;
  policyNumber?: string;
  carrierName?: string;
  premium?: string;
  effectiveDate?: string;
  renewalDate?: string;
  termYear?: string | number;
  originalFileName?: string;
  lineOfBusiness?: string;
  sourceFiles?: string[];
};

export function documentTypeLabelForTemplate(type: string, documentName?: string): string {
  if (documentName?.trim()) return documentName.trim();
  const map: Record<string, string> = {
    driver_license: "Driver's license",
    ssn_documentation: "SSN documentation",
    proof_of_insurance: "Proof of insurance",
    asset_information: "Asset information",
    policy_document: "Policy document",
    declarations_page: "Declarations page",
    insurance_id_card: "Insurance ID card",
    policy_booklet: "Policy booklet / forms",
    endorsement_document: "Endorsement document",
    deposit_receipt: "Deposit receipt",
    payment_receipt: "Payment receipt",
    appraisal: "Appraisal",
    wind_mitigation: "Wind mitigation",
    inspection_report: "Inspection report",
    carrier_appetite_guide: "Carrier appetite guide",
    carrier_application: "Carrier application form",
    carrier_supplemental: "Carrier supplemental form",
    underwriting_manual: "Underwriting manual",
    claim_document: "Claim document",
    cancellation_notice: "Cancellation / lapse notice",
    carrier_correspondence: "Carrier correspondence",
    agency_template: "Agency template / form",
    other: "Other",
  };
  return map[type] ?? titleizeSlug(type);
}

export function buildDocumentTemplateFields(seed: DocumentTemplateFieldSeed): TemplateFieldMap {
  const fields: TemplateFieldMap = {};
  const add = (label: string, value: unknown) => {
    if (value == null) return;
    const clean = String(value).trim();
    if (!clean) return;
    fields[label] = clean;
  };

  add("File name", seed.fileName);
  add("Document type", seed.documentName || seed.documentTypeLabel);
  add("Visibility", seed.visibilityLabel);
  add("Status", seed.statusLabel);
  add("Agency", seed.agencyName);
  add("Client name", seed.customerName);
  add("Client email", seed.customerEmail);
  add("Client phone", seed.customerPhone);
  add("Asset", seed.assetLabel);
  add("Asset value", seed.assetValue);
  add("Policy number", seed.policyNumber);
  add("Carrier", seed.carrierName);
  add("Premium", seed.premium);
  add("Effective date", seed.effectiveDate);
  add("Renewal date", seed.renewalDate);
  add("Policy term year", seed.termYear);
  add("Original document", seed.originalFileName);
  add("Line of business", seed.lineOfBusiness);
  if (seed.sourceFiles?.length) add("Source files reviewed", seed.sourceFiles.join(", "));

  return fields;
}

export function normalizeTemplateFields(fields?: TemplateFieldMap | null): TemplateFieldMap | undefined {
  if (!fields) return undefined;
  const clean = entriesToTemplateFields(templateFieldEntries(fields));
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export function templateFieldEntries(fields?: TemplateFieldMap | null): TemplateFieldEntry[] {
  return Object.entries(fields ?? {}).map(([label, value]) => ({
    label,
    value: value == null ? "" : String(value),
  }));
}

export function entriesToTemplateFields(entries: TemplateFieldEntry[]): TemplateFieldMap {
  const out: TemplateFieldMap = {};
  entries.forEach((entry, index) => {
    const baseLabel = entry.label.trim() || `Field ${index + 1}`;
    let label = baseLabel;
    let dupe = 2;
    while (Object.prototype.hasOwnProperty.call(out, label)) {
      label = `${baseLabel} ${dupe}`;
      dupe += 1;
    }
    out[label] = entry.value == null ? "" : String(entry.value);
  });
  return out;
}

function titleizeSlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
