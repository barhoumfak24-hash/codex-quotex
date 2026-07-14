import type { Asset, AssetType } from "@/types";
import { isVinInputField, uppercaseVinInput } from "./vinInput";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  coastal_home: "Coastal Home",
  luxury_vehicle: "Luxury Vehicle",
  yacht: "Yacht",
  jewelry: "Jewelry",
  umbrella_liability: "Umbrella Liability",
  full_portfolio: "Full Portfolio",
  other: "Other",
};

const ASSET_SUBTITLE_LABELS: Partial<Record<AssetType, string>> = {
  luxury_vehicle: "Vehicle",
};

const VIN_TOKEN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstDetail(details: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = stringValue(details[key]);
    if (direct) return direct;
    const matchedKey = Object.keys(details).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase()
    );
    if (matchedKey) {
      const matched = stringValue(details[matchedKey]);
      if (matched) return matched;
    }
  }
  return "";
}

export function uppercaseVinTokens(value: string): string {
  return value.replace(VIN_TOKEN, (match) => uppercaseVinInput(match));
}

export function looksLikeVin(value: unknown): boolean {
  const compact = stringValue(value).replace(/[^a-z0-9]/gi, "");
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(compact);
}

export function assetTypeDisplayLabel(type: AssetType): string {
  return ASSET_TYPE_LABELS[type] ?? "Asset";
}

export function assetDisplaySubtitleLabel(type: AssetType): string {
  return ASSET_SUBTITLE_LABELS[type] ?? assetTypeDisplayLabel(type);
}

function normalizedVehiclePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function joinVehicleParts(parts: string[]): string {
  const out: string[] = [];
  for (const part of parts.map((value) => uppercaseVinTokens(stringValue(value))).filter(Boolean)) {
    if (looksLikeVin(part)) continue;
    const normalized = normalizedVehiclePart(part);
    if (!normalized) continue;
    const alreadyIncluded = out.some((existing) => {
      const existingNormalized = normalizedVehiclePart(existing);
      return (
        existingNormalized === normalized ||
        existingNormalized.includes(normalized) ||
        normalized.includes(existingNormalized)
      );
    });
    if (!alreadyIncluded) out.push(part);
  }
  return out.join(" ").trim();
}

function vehicleLabelFromDetails(details: Record<string, unknown>): string {
  const year = firstDetail(details, ["year", "modelYear", "vehicleYear", "model_year"]);
  const make = firstDetail(details, [
    "make",
    "vehicleMake",
    "manufacturer",
    "manufacturerName",
    "vehicle_make",
  ]);
  const model = firstDetail(details, ["model", "vehicleModel", "modelName", "vehicle_model"]);
  const trim = firstDetail(details, [
    "trim",
    "vehicleTrim",
    "trimLevel",
    "series",
    "series2",
    "vehicleSeries",
    "vehicle_trim",
  ]);
  if (make || model) return joinVehicleParts([year, make, model, trim]);

  const description = firstDetail(details, [
    "yearMakeModel",
    "makeModel",
    "vehicleDescription",
    "vehicle",
    "assetName",
  ]);
  return looksLikeVin(description) ? "" : uppercaseVinTokens(description);
}

export function assetDisplayName(asset: Pick<Asset, "type" | "label" | "details">): string {
  const label = stringValue(asset.label);
  if (asset.type === "luxury_vehicle") {
    return (
      vehicleLabelFromDetails(asset.details ?? {}) ||
      (looksLikeVin(label) ? "Luxury Vehicle" : uppercaseVinTokens(label)) ||
      "Luxury Vehicle"
    );
  }
  return uppercaseVinTokens(label) || assetTypeDisplayLabel(asset.type);
}

export function buildAssetLabelFromDetails(input: {
  type: AssetType;
  details: Record<string, unknown>;
  categoryLabel?: string;
  fallbackLabel?: string;
}): string {
  const { type, details } = input;
  if (type === "luxury_vehicle") {
    return (
      vehicleLabelFromDetails(details) ||
      (looksLikeVin(input.fallbackLabel) ? "" : uppercaseVinTokens(stringValue(input.fallbackLabel))) ||
      input.categoryLabel ||
      assetTypeDisplayLabel(type)
    );
  }

  const label =
    firstDetail(details, [
      "assetName",
      "propertyAddress",
      "riskAddress",
      "address",
      "primaryResidenceAddress",
      "garagingAddress",
    ]) ||
    stringValue(input.fallbackLabel) ||
    input.categoryLabel ||
    assetTypeDisplayLabel(type);
  return uppercaseVinTokens(label);
}

export function formatAssetDetailValue(key: string, value: unknown): string {
  const text = stringValue(value);
  if (isVinInputField({ key, label: key })) return uppercaseVinInput(text);
  return uppercaseVinTokens(text);
}

export function normalizeAssetDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? formatAssetDetailValue(key, value) : value,
    ])
  );
}
