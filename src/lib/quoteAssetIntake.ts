import type { AssetType } from "@/types";

export type QuoteAssetDetailInputType =
  | "text"
  | "number"
  | "currency"
  | "select"
  | "textarea"
  | "address";

export interface QuoteAssetDetailField {
  key: string;
  label: string;
  inputType: QuoteAssetDetailInputType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  helpText?: string;
  publicHints?: string[];
  questionHints?: string[];
}

const HOME_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "riskAddress",
    label: "Property address",
    inputType: "address",
    required: true,
    placeholder: "Street, city, state, ZIP",
    publicHints: ["address", "risk address"],
  },
  {
    key: "yearBuilt",
    label: "Year built",
    inputType: "number",
    required: true,
    publicHints: ["year built"],
  },
  {
    key: "squareFeet",
    label: "Square footage",
    inputType: "number",
    publicHints: ["square footage", "sq ft"],
  },
  {
    key: "constructionType",
    label: "Construction type",
    inputType: "select",
    options: ["Frame", "Masonry", "Stucco over masonry", "ICF concrete", "Other / unknown"],
    publicHints: ["construction"],
  },
  {
    key: "roofMaterial",
    label: "Roof material",
    inputType: "select",
    options: ["Shingle", "Tile", "Metal", "Slate", "Flat / membrane", "Other / unknown"],
    publicHints: ["roof material", "roof"],
    questionHints: ["roof age", "partial replacements"],
  },
  {
    key: "roofYear",
    label: "Roof year",
    inputType: "number",
    publicHints: ["roof"],
    questionHints: ["roof age", "partial replacements"],
  },
  {
    key: "distanceToCoast",
    label: "Distance to coast",
    inputType: "text",
    placeholder: "e.g., 0.8 miles",
    publicHints: ["distance to coast"],
  },
  {
    key: "windMitigation",
    label: "Wind mitigation details",
    inputType: "textarea",
    placeholder: "Certificate year, opening protection, roof deck/uplift details",
    questionHints: ["wind-mitigation", "wind mitigation", "uplift"],
  },
  {
    key: "lossHistory",
    label: "Loss history",
    inputType: "textarea",
    placeholder: "Carrier, cause, paid amount, and date for any losses",
    questionHints: ["losses", "loss history", "carrier, paid amount"],
  },
];

const VEHICLE_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "vin",
    label: "VIN",
    inputType: "text",
    required: true,
    placeholder: "17-character VIN",
    publicHints: ["vin", "vin-decoded", "trim"],
  },
  { key: "year", label: "Year", inputType: "number", required: true, publicHints: ["year / make / model", "year"] },
  { key: "make", label: "Make", inputType: "text", required: true, publicHints: ["year / make / model", "make"] },
  { key: "model", label: "Model", inputType: "text", required: true, publicHints: ["year / make / model", "model"] },
  {
    key: "garagingAddress",
    label: "Garaging address",
    inputType: "address",
    required: true,
    publicHints: ["garaging"],
    placeholder: "Where the vehicle is normally kept",
  },
  {
    key: "annualMileage",
    label: "Annual mileage",
    inputType: "number",
    questionHints: ["annual mileage"],
  },
  {
    key: "primaryUse",
    label: "Primary use",
    inputType: "select",
    options: ["Pleasure", "Commute", "Business", "Collector / limited use", "Other"],
    questionHints: ["primary use", "pleasure", "commute", "business"],
  },
  {
    key: "drivers",
    label: "Drivers",
    inputType: "textarea",
    placeholder: "Names, DOBs, license numbers, and years insured",
    questionHints: ["all drivers", "drivers"],
  },
];

const YACHT_FIELDS: QuoteAssetDetailField[] = [
  { key: "hin", label: "Hull ID / HIN", inputType: "text", required: true, publicHints: ["hull"] },
  { key: "year", label: "Year built", inputType: "number", required: true, publicHints: ["year built", "year"] },
  { key: "make", label: "Builder / make", inputType: "text", required: true, publicHints: ["make"] },
  { key: "model", label: "Model", inputType: "text", publicHints: ["model"] },
  { key: "length", label: "Length", inputType: "number", required: true, publicHints: ["hull length", "length"] },
  {
    key: "hullMaterial",
    label: "Hull material",
    inputType: "select",
    options: ["Fiberglass", "Aluminum", "Steel", "Wood", "Carbon / composite", "Other"],
    publicHints: ["hull material"],
  },
  {
    key: "marinaAddress",
    label: "Marina / mooring address",
    inputType: "address",
    required: true,
    publicHints: ["marina", "mooring"],
    questionHints: ["marina", "slip"],
  },
  {
    key: "cruisingArea",
    label: "Cruising area",
    inputType: "text",
    placeholder: "e.g., Atlantic coast, Bahamas, Great Lakes",
    questionHints: ["cruising area"],
  },
  {
    key: "hurricanePlan",
    label: "Hurricane plan",
    inputType: "textarea",
    questionHints: ["hurricane plan"],
  },
];

const JEWELRY_FIELDS: QuoteAssetDetailField[] = [
  { key: "itemType", label: "Item type", inputType: "text", required: true, publicHints: ["item type"] },
  {
    key: "itemDescription",
    label: "Item description",
    inputType: "textarea",
    required: true,
    placeholder: "Stone, metal, designer, serial number, distinguishing details",
    questionHints: ["item"],
  },
  {
    key: "appraisedValue",
    label: "Appraised value",
    inputType: "currency",
    required: true,
    publicHints: ["appraised value", "value"],
    questionHints: ["replacement value", "appraisal"],
  },
  {
    key: "appraisalDate",
    label: "Appraisal date",
    inputType: "text",
    placeholder: "MM/YYYY",
    questionHints: ["appraisal"],
  },
  { key: "appraiser", label: "Appraiser", inputType: "text", questionHints: ["appraiser"] },
  {
    key: "storageLocation",
    label: "Storage when not worn",
    inputType: "select",
    options: ["Home safe", "Bank vault", "On person", "Dealer storage", "Other"],
    publicHints: ["storage location", "storage"],
    questionHints: ["storage"],
  },
  { key: "travelFrequency", label: "Travel frequency", inputType: "text", questionHints: ["travel"] },
];

const UMBRELLA_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "primaryResidenceAddress",
    label: "Primary residence address",
    inputType: "address",
    required: true,
    publicHints: ["address"],
  },
  {
    key: "requestedLimit",
    label: "Requested umbrella limit",
    inputType: "currency",
    required: true,
    publicHints: ["value", "limit"],
  },
  {
    key: "underlyingLimits",
    label: "Underlying policy limits",
    inputType: "textarea",
    required: true,
    placeholder: "Home, auto, watercraft, and excess limits currently carried",
    publicHints: ["underlying policies"],
    questionHints: ["underlying"],
  },
  { key: "householdDrivers", label: "Household drivers", inputType: "textarea", questionHints: ["drivers"] },
  {
    key: "publicExposure",
    label: "Public exposure / board seats",
    inputType: "textarea",
    questionHints: ["public-facing", "board", "media"],
  },
  {
    key: "propertyExposures",
    label: "Property exposures",
    inputType: "textarea",
    placeholder: "Pools, dogs, rentals, recreational vehicles, domestic staff, etc.",
    questionHints: ["dog", "pool", "diving", "slide"],
  },
];

const PORTFOLIO_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "primaryAddress",
    label: "Primary address",
    inputType: "address",
    required: true,
    publicHints: ["address"],
  },
  {
    key: "portfolioSummary",
    label: "Portfolio summary",
    inputType: "textarea",
    required: true,
    placeholder: "Homes, autos, watercraft, jewelry, umbrella, business-owned assets, etc.",
    questionHints: ["portfolio", "details", "describe"],
  },
  {
    key: "totalInsuredValue",
    label: "Total insured value",
    inputType: "currency",
    publicHints: ["value"],
  },
  {
    key: "currentCarriers",
    label: "Current carriers / policies",
    inputType: "textarea",
    questionHints: ["underlying", "policies"],
  },
];

const OTHER_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "description",
    label: "Asset / exposure description",
    inputType: "textarea",
    required: true,
    placeholder: "Describe exactly what is being insured.",
    questionHints: ["describe", "details"],
  },
  {
    key: "location",
    label: "Location / address",
    inputType: "address",
    required: true,
    publicHints: ["address", "location"],
  },
  {
    key: "identifier",
    label: "Identifier",
    inputType: "text",
    placeholder: "Serial number, registration, parcel ID, or other lookup key",
    publicHints: ["id", "identifier", "serial"],
  },
  {
    key: "useCase",
    label: "Use / operations",
    inputType: "textarea",
    required: true,
    questionHints: ["usage", "operations", "details"],
  },
  {
    key: "requestedCoverage",
    label: "Coverage requested",
    inputType: "textarea",
    questionHints: ["coverage", "limit"],
  },
];

export const QUOTE_ASSET_DETAIL_FIELDS: Record<AssetType, QuoteAssetDetailField[]> = {
  coastal_home: HOME_FIELDS,
  luxury_vehicle: VEHICLE_FIELDS,
  yacht: YACHT_FIELDS,
  jewelry: JEWELRY_FIELDS,
  umbrella_liability: UMBRELLA_FIELDS,
  full_portfolio: PORTFOLIO_FIELDS,
  other: OTHER_FIELDS,
};

export function cleanQuoteAssetDetails(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): Record<string, string> {
  const fields = QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? [];
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = details?.[field.key];
    const text = stringifyDetailValue(value);
    if (text) out[field.key] = text;
  }
  return out;
}

export function missingRequiredQuoteAssetFields(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): QuoteAssetDetailField[] {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).filter(
    (field) => field.required && !cleaned[field.key]
  );
}

export function primaryQuoteAssetAddress(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): string | undefined {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const keys = [
    "riskAddress",
    "garagingAddress",
    "marinaAddress",
    "primaryResidenceAddress",
    "primaryAddress",
    "location",
  ];
  return keys.map((key) => cleaned[key]).find(Boolean);
}

export function quoteAssetPublicFieldValue(
  assetType: AssetType,
  publicLabel: string,
  details: Record<string, unknown> | undefined,
  fallback?: { address?: string; estimatedValue?: number }
): string | undefined {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const label = publicLabel.toLowerCase();

  if (assetType === "luxury_vehicle" && label.includes("year / make / model")) {
    return compactJoin([cleaned.year, cleaned.make, cleaned.model], " ");
  }
  if (assetType === "yacht" && label.includes("year built")) return cleaned.year;
  if (assetType === "yacht" && label.includes("hull length")) return cleaned.length ? `${cleaned.length} ft` : undefined;
  if (assetType === "coastal_home" && label.includes("roof")) {
    return compactJoin([cleaned.roofMaterial, cleaned.roofYear ? `installed ${cleaned.roofYear}` : ""], " - ");
  }
  if (label.includes("address") || label.includes("garaging") || label.includes("marina") || label.includes("mooring")) {
    return primaryQuoteAssetAddress(assetType, cleaned) ?? fallback?.address;
  }
  if (label.includes("msrp") || label.includes("appraised") || label.includes("value")) {
    return currencyText(cleaned.appraisedValue || cleaned.totalInsuredValue || cleaned.requestedLimit) ??
      (fallback?.estimatedValue ? currencyText(String(fallback.estimatedValue)) : undefined);
  }

  const field = (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).find((candidate) =>
    hintMatchesLabel(candidate.publicHints, label)
  );
  if (!field) return undefined;
  return formatDetailForPublicField(field, cleaned[field.key]);
}

export function quoteAssetQuestionAnswered(
  assetType: AssetType,
  questionLabel: string,
  details: Record<string, unknown> | undefined
): boolean {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const label = questionLabel.toLowerCase();
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).some(
    (field) =>
      !!cleaned[field.key] &&
      (hintMatchesLabel(field.questionHints, label) || hintMatchesLabel(field.publicHints, label))
  );
}

export function summarizeQuoteAssetDetails(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): string[] {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? [])
    .map((field) => {
      const value = cleaned[field.key];
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean);
}

function stringifyDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

function hintMatchesLabel(hints: string[] | undefined, label: string): boolean {
  return (hints ?? []).some((hint) => {
    const normalized = hint.toLowerCase();
    return label.includes(normalized) || normalized.includes(label);
  });
}

function formatDetailForPublicField(field: QuoteAssetDetailField, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (field.inputType === "currency") return currencyText(value);
  if (field.key === "squareFeet") return `${Number(value).toLocaleString()} sq ft`;
  return value;
}

function currencyText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return value;
  return `$${Math.round(numeric).toLocaleString()}`;
}

function compactJoin(values: Array<string | undefined>, separator: string): string | undefined {
  const out = values.map((value) => value?.trim()).filter(Boolean);
  return out.length > 0 ? out.join(separator) : undefined;
}
