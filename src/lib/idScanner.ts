export interface ParsedDriverLicenseId {
  rawBarcode: string;
  licenseNumber?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  issueDate?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  documentDiscriminator?: string;
}

const AAMVA_FIELD_LABELS = {
  licenseNumber: ["DAQ"],
  firstName: ["DAC", "DCT"],
  middleName: ["DAD"],
  lastName: ["DCS", "DAB"],
  fullName: ["DAA"],
  dateOfBirth: ["DBB"],
  expirationDate: ["DBA"],
  issueDate: ["DBD"],
  address: ["DAG"],
  city: ["DAI"],
  state: ["DAJ"],
  postalCode: ["DAK"],
  documentDiscriminator: ["DCF"],
} as const;

function fieldValue(raw: string, codes: readonly string[]): string | undefined {
  for (const code of codes) {
    const match = raw.match(new RegExp(`${code}([^\\r\\n]+)`));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeAamvaDate(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "");
  if (!digits || digits.length !== 8) return value?.trim() || undefined;

  const yearFirst = Number(digits.slice(0, 4));
  if (yearFirst >= 1900 && yearFirst <= 2100) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  const yearLast = Number(digits.slice(4, 8));
  if (yearLast >= 1900 && yearLast <= 2100) {
    return `${digits.slice(4, 8)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
  }

  return value?.trim() || undefined;
}

export function parseAamvaDriverLicense(rawBarcode: string): ParsedDriverLicenseId {
  const raw = rawBarcode.replace(/\u001e/g, "\n").replace(/\u001d/g, "\n");
  const parsed: ParsedDriverLicenseId = {
    rawBarcode,
    licenseNumber: fieldValue(raw, AAMVA_FIELD_LABELS.licenseNumber),
    firstName: fieldValue(raw, AAMVA_FIELD_LABELS.firstName),
    middleName: fieldValue(raw, AAMVA_FIELD_LABELS.middleName),
    lastName: fieldValue(raw, AAMVA_FIELD_LABELS.lastName),
    fullName: fieldValue(raw, AAMVA_FIELD_LABELS.fullName),
    dateOfBirth: normalizeAamvaDate(fieldValue(raw, AAMVA_FIELD_LABELS.dateOfBirth)),
    expirationDate: normalizeAamvaDate(fieldValue(raw, AAMVA_FIELD_LABELS.expirationDate)),
    issueDate: normalizeAamvaDate(fieldValue(raw, AAMVA_FIELD_LABELS.issueDate)),
    address: fieldValue(raw, AAMVA_FIELD_LABELS.address),
    city: fieldValue(raw, AAMVA_FIELD_LABELS.city),
    state: fieldValue(raw, AAMVA_FIELD_LABELS.state),
    postalCode: fieldValue(raw, AAMVA_FIELD_LABELS.postalCode),
    documentDiscriminator: fieldValue(raw, AAMVA_FIELD_LABELS.documentDiscriminator),
  };

  if (!parsed.fullName) {
    parsed.fullName = [parsed.firstName, parsed.middleName, parsed.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined;
  }

  return parsed;
}

export function driverLicenseInputValue(parsed: ParsedDriverLicenseId): string {
  return [parsed.state, parsed.licenseNumber].filter(Boolean).join(" ").trim();
}
