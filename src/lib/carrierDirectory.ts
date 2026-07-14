import type { AssetType, Carrier } from "@/types";

export type CarrierDirectoryLine = "personal" | "hnw" | "commercial";

export interface CarrierDirectoryEntry {
  id: string;
  name: string;
  logoUrl?: string;
  loginUrl?: string;
  domainMatch?: string;
  lineOfBusiness: CarrierDirectoryLine;
  linesOfBusiness: CarrierDirectoryLine[];
  preferredAssetTypes: AssetType[];
  stateAvailability: string[];
  status: Carrier["status"];
}

export interface CarrierDirectoryPayload {
  generatedAt: string;
  count: number;
  carriers: CarrierDirectoryEntry[];
}

export function buildCarrierDirectory(
  carriers: Carrier[],
  generatedAt = new Date().toISOString()
): CarrierDirectoryPayload {
  const entries = carriers
    .map(toCarrierDirectoryEntry)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt,
    count: entries.length,
    carriers: entries,
  };
}

export function toCarrierDirectoryEntry(carrier: Carrier): CarrierDirectoryEntry {
  const loginUrl = firstNonBlank(
    carrier.quotingAutomation?.agentPortalUrl,
    carrier.agentPortalUrl,
    carrier.billingPortalUrl,
    carrier.claimsUrl
  );
  const linesOfBusiness = carrierLinesOfBusiness(carrier);
  return {
    id: carrier.id,
    name: carrier.name,
    logoUrl: firstNonBlank(carrier.logoUrl),
    loginUrl,
    domainMatch: loginUrl ? domainMatchForUrl(loginUrl) : undefined,
    lineOfBusiness: linesOfBusiness[0] ?? "personal",
    linesOfBusiness,
    preferredAssetTypes: carrier.preferredAssetTypes,
    stateAvailability: carrier.stateAvailability,
    status: carrier.status,
  };
}

export function domainMatchForUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host ? `*://*.${host}/*` : undefined;
  } catch {
    return undefined;
  }
}

function carrierLinesOfBusiness(carrier: Carrier): CarrierDirectoryLine[] {
  const lines = new Set<CarrierDirectoryLine>();
  if (carrier.appetites?.some((row) => row.line === "commercial")) {
    lines.add("commercial");
  }
  if (isHnwCarrier(carrier)) {
    lines.add("hnw");
  }
  if (
    lines.size === 0 ||
    carrier.appetites?.some((row) => !row.line || row.line === "personal") ||
    carrier.preferredAssetTypes.length > 0
  ) {
    lines.add("personal");
  }
  return Array.from(lines);
}

function isHnwCarrier(carrier: Carrier): boolean {
  const text = `${carrier.id} ${carrier.name} ${carrier.appetiteNotes ?? ""}`.toLowerCase();
  return [
    "hnw",
    "high-net-worth",
    "private client",
    "masterpiece",
    "pure",
    "vault",
    "berkley one",
    "crestbrook",
    "aig",
  ].some((needle) => text.includes(needle));
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return undefined;
}
