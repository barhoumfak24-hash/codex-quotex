import type { AssetType } from "@/types";

export const ASSET_TYPE_DISPLAY_NAMES: Record<AssetType, string> = {
  coastal_home: "Coastal Home",
  luxury_vehicle: "Luxury Vehicle",
  yacht: "Yacht",
  jewelry: "Jewelry",
  umbrella_liability: "Umbrella Liability",
  full_portfolio: "Full Portfolio",
  other: "Other",
};

interface NhtsaVariable {
  Variable: string;
  Value: string | null;
}

interface NhtsaResponse {
  Results: NhtsaVariable[];
}

export function normalizeVin(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function vinValidationIssue(vin: string): string | null {
  if (!vin) return "Enter a VIN to look up vehicle records.";
  if (/[IOQ]/.test(vin)) return "VIN contains I, O, or Q, which are not valid in standard VINs.";
  if (vin.length < 17) {
    return "VIN is too short. A standard 17-character VIN is required before Quotex decodes vehicle records.";
  }
  if (vin.length > 17) {
    return "VIN is too long. A standard 17-character VIN is required before Quotex decodes vehicle records.";
  }
  return null;
}

export async function decodeVinViaNhtsa(vin: string): Promise<{
  year?: number;
  make?: string;
  model?: string;
  bodyClass?: string;
  errorCode?: string;
} | null> {
  if (!vin) return null;
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as NhtsaResponse;
    const get = (variable: string): string | undefined => {
      const r = data.Results?.find((row) => row.Variable === variable);
      const v = r?.Value;
      return typeof v === "string" && v.trim() !== "" ? v : undefined;
    };
    const yearStr = get("Model Year");
    const year = yearStr ? Number(yearStr) : undefined;
    return {
      year: Number.isFinite(year) ? year : undefined,
      make: get("Make"),
      model: get("Model"),
      bodyClass: get("Body Class"),
      errorCode: get("Error Code"),
    };
  } catch {
    return null;
  }
}

export function looksLikeVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(value.trim());
}

export function shortVin(value: string): string {
  const vin = normalizeVin(value);
  return vin ? `VIN ...${vin.slice(-6)}` : "VIN pending";
}

export function titleCaseVehicle(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Za-z]{1,3}$/.test(part)) return part.toUpperCase();
      if (/^[0-9]+$/.test(part) || /^[A-Z]{1,3}[0-9]+$/i.test(part) || /^[0-9]+[A-Z]{1,3}$/i.test(part)) {
        return part.toUpperCase();
      }
      if (/^[A-Za-z]{1,2}[0-9]{1,3}$/i.test(part)) return part.toUpperCase();
      return part
        .toLowerCase()
        .replace(/(^|[-/])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
    })
    .join(" ");
}

export function assetTypeDisplayName(type: AssetType): string {
  return ASSET_TYPE_DISPLAY_NAMES[type] ?? "Asset";
}

export function formatAssetValue(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `$${Math.round(value).toLocaleString()}`
    : "Value pending";
}

export function deriveAssetLabel(type: AssetType, details: Record<string, unknown> = {}): string {
  const vin = normalizeVin(readFirst(details, ["vin", "vehicleVin", "assetIdentifier"]));
  const short = vin ? shortVin(vin) : "";
  const typeName = assetTypeDisplayName(type);
  const customLabel = readString(details.customLabel);
  let label = customLabel;

  if (!label) {
    if (type === "luxury_vehicle") {
      const year = readString(details.year);
      const make = titleCaseVehicle(readString(details.make));
      const model = titleCaseVehicle(readString(details.model));
      const decodedName = [year, make, model].filter(Boolean).join(" ").trim();
      label =
        decodedName && short
          ? `${decodedName} - ${short}`
          : decodedName ||
            readFirst(details, ["assetName", "vehicleName"]) ||
            (short ? `Vehicle - ${short}` : "Luxury Vehicle");
    } else if (type === "coastal_home") {
      label = readFirst(details, [
        "assetName",
        "propertyAddress",
        "riskAddress",
        "address",
        "primaryResidenceAddress",
      ]);
      if (label) label = streetPortion(label);
      label ||= "Coastal Home";
    } else if (type === "yacht") {
      const year = readString(details.year);
      const make = titleCaseVehicle(readString(details.make));
      const model = titleCaseVehicle(readString(details.model));
      const vesselName = readFirst(details, ["assetName", "vesselName", "name"]);
      const hullId = readFirst(details, ["hin", "hullId", "hullIdentificationNumber"]);
      label =
        vesselName ||
        [year, make, model].filter(Boolean).join(" ").trim() ||
        (hullId ? `Yacht - HIN ...${normalizeVin(hullId).slice(-6)}` : "Yacht");
    } else if (type === "jewelry") {
      label = readFirst(details, ["assetName", "description"]) || "Jewelry Collection";
    } else {
      label =
        readFirst(details, ["assetName"]) ||
        streetPortion(
          readFirst(details, [
            "propertyAddress",
            "riskAddress",
            "address",
            "primaryResidenceAddress",
            "garagingAddress",
          ])
        ) ||
        typeName;
    }
  }

  const cleanLabel = label.trim();
  if (!looksLikeVin(cleanLabel)) return cleanLabel || typeName;
  return type === "luxury_vehicle" ? `Vehicle - ${shortVin(cleanLabel)}` : `${typeName} - ${shortVin(cleanLabel)}`;
}

export function readString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function readFirst(details: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = readString(details[key]);
    if (value) return value;
  }
  return "";
}

function streetPortion(address: string): string {
  const clean = readString(address);
  if (!clean) return "";
  return clean.split(/\r?\n/)[0]?.split(",")[0]?.trim() || clean;
}
