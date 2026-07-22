import type { AssetType } from "@/types";

export type QuoteReplyLine = "personal" | "commercial" | "unknown";
export type QuoteReplyIdentifierKind = "vin" | "address" | "hin" | "asset_id";

export type PersonalQuoteReplyIntake = {
  line: QuoteReplyLine;
  identifierKind: QuoteReplyIdentifierKind;
  identifier: string;
  assetType: AssetType;
};

const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/i;
const ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z0-9][A-Z0-9.'-]*(?:\s+[A-Z0-9][A-Z0-9.'-]*){0,7}\s+(?:ST(?:REET)?|AVE(?:NUE)?|RD|ROAD|DR(?:IVE)?|LN|LANE|BLVD|BOULEVARD|CT|COURT|CIR(?:CLE)?|WAY|HWY|HIGHWAY|PKWY|PARKWAY|PL(?:ACE)?|TER(?:RACE)?|TRL|TRAIL)\b(?:[^\n\r;]{0,80})?/i;
const HIN_PATTERN = /\b(?:HIN|HULL(?:\s+IDENTIFICATION)?(?:\s+NUMBER)?)[\s:#-]*([A-HJ-NPR-Z0-9]{12})\b/i;
const ASSET_ID_PATTERN =
  /\b(?:ASSET|SERIAL|ITEM|APPRAISAL|REGISTRATION|DOCUMENT)(?:\s+(?:ID|NUMBER|NO\.?|#))?[\s:#-]+([A-Z0-9][A-Z0-9-]{4,31})\b/i;
const QUOTE_CONTEXT_PATTERN =
  /\b(?:quote|quotation|quoted|pricing|premium|rate|coverage|insur(?:ance|ed)?|add (?:a |an )?(?:vehicle|car|truck|home|property|boat|yacht|item))\b/i;
const COMMERCIAL_PATTERN =
  /\b(?:commercial|business|company|corporate|work(?:\s+use|\s+vehicle)?|fleet|for (?:my|the) business)\b/i;
const PERSONAL_PATTERN =
  /\b(?:personal|private passenger|household|family|for (?:me|myself|my family)|non-commercial)\b/i;

function newestMessageText(body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  const separators = [
    /^On .+wrote:\s*$/im,
    /^From:\s.+$/im,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{5,}$/m,
  ];
  let end = normalized.length;
  separators.forEach((pattern) => {
    const match = pattern.exec(normalized);
    if (match?.index != null) end = Math.min(end, match.index);
  });
  return normalized.slice(0, end).trim();
}

function cleanAddress(value: string): string {
  const zipBounded = value.match(/^.*?\b\d{5}(?:-\d{4})?\b/)?.[0] ?? value;
  return zipBounded
    .replace(/\s+/g, " ")
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

function inferredAssetType(text: string, kind: QuoteReplyIdentifierKind): AssetType {
  if (kind === "vin") return "luxury_vehicle";
  if (kind === "address") return "coastal_home";
  if (kind === "hin" || /\b(?:boat|yacht|vessel|watercraft|marine)\b/i.test(text)) {
    return "yacht";
  }
  if (/\b(?:jewel(?:ry)?|ring|watch|necklace|bracelet|appraisal)\b/i.test(text)) {
    return "jewelry";
  }
  return "other";
}

export function extractQuoteReplyIntake(input: {
  subject?: string;
  body: string;
  priorQuoteContext?: string;
  contactLine?: "personal" | "commercial";
}): PersonalQuoteReplyIntake | null {
  const currentBody = newestMessageText(input.body);
  const context = [input.subject, currentBody, input.priorQuoteContext]
    .filter(Boolean)
    .join("\n");
  if (!QUOTE_CONTEXT_PATTERN.test(context)) return null;

  const explicitlyCommercial = COMMERCIAL_PATTERN.test(currentBody) || COMMERCIAL_PATTERN.test(input.subject ?? "");
  const explicitlyPersonal = PERSONAL_PATTERN.test(currentBody) || PERSONAL_PATTERN.test(input.subject ?? "");
  const line: QuoteReplyLine = explicitlyCommercial
    ? "commercial"
    : explicitlyPersonal
      ? "personal"
      : input.contactLine ?? "unknown";

  const vin = currentBody.match(VIN_PATTERN)?.[0]?.toUpperCase();
  if (vin) {
    return { line, identifierKind: "vin", identifier: vin, assetType: "luxury_vehicle" };
  }

  const hin = currentBody.match(HIN_PATTERN)?.[1]?.toUpperCase();
  if (hin) {
    return { line, identifierKind: "hin", identifier: hin, assetType: "yacht" };
  }

  const address = currentBody.match(ADDRESS_PATTERN)?.[0];
  if (address) {
    return {
      line,
      identifierKind: "address",
      identifier: cleanAddress(address),
      assetType: "coastal_home",
    };
  }

  const assetId = currentBody.match(ASSET_ID_PATTERN)?.[1]?.toUpperCase();
  if (assetId) {
    return {
      line,
      identifierKind: "asset_id",
      identifier: assetId,
      assetType: inferredAssetType(context, "asset_id"),
    };
  }

  return null;
}

export function normalizedQuoteIdentifier(kind: QuoteReplyIdentifierKind, value: unknown): string {
  const text = String(value ?? "").trim();
  if (kind === "address") return text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
