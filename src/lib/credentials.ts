import type { Role, SubscriptionTier } from "@/types";

// =====================================================================
// Staff credential generator (demo only).
//
// Real backend MUST:
//  - hash passwords (argon2id / bcrypt) and never return them in API responses
//  - issue one-time-use reveal links for distribution (signed, short TTL)
//  - require password rotation on first login + MFA enrollment
//
// This file is fine for the demo: passwords are stored in plain text in the
// mock DB so the master portal can display them once, then regenerate.
// =====================================================================

const ADJECTIVES = [
  "amber", "arctic", "azure", "bronze", "cedar", "coral", "crimson", "ebony", "emerald", "fern",
  "garnet", "hazel", "indigo", "ivory", "jade", "lilac", "linen", "marble", "mocha", "nickel",
  "onyx", "opal", "pearl", "plum", "quartz", "rose", "ruby", "sable", "sage", "saffron",
  "silver", "slate", "topaz", "umber", "violet", "willow", "winter",
];

const NOUNS = [
  "albatross", "anchor", "atlas", "bay", "beacon", "breeze", "caravan", "chart", "clipper",
  "compass", "coast", "current", "delta", "eagle", "falcon", "harbor", "harbour", "harbor",
  "helm", "horizon", "isle", "lagoon", "lantern", "lighthouse", "manor", "marina", "marlin",
  "meridian", "nautilus", "orchid", "osprey", "passage", "peninsula", "pinnacle", "promenade",
  "regatta", "reef", "ridge", "river", "schooner", "shore", "shoreline", "skiff", "summit",
  "swallow", "tide", "vessel", "voyage", "wharf",
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
  return out;
}

// "amber-falcon-3917" — readable + impossible to guess.
export function generatePassword(): string {
  return `${rand(ADJECTIVES)}-${rand(NOUNS)}-${randDigits(4)}`;
}

// Slug for usernames: "Demo Agency" → "demo-agency". Keeps ascii letters,
// numbers, hyphens.
export function slugifyAgency(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agency"
  );
}

export function normalizeAgencyCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const AGENCY_CODE_CIPHER_PREFIX = "qac1.";
const AGENCY_CODE_DEMO_KEY = "quotex-agency-code";
const CONNECTION_SECRET_CIPHER_PREFIX = "qcs1.";
const CONNECTION_SECRET_DEMO_KEY = "quotex-connection-secret";

function xorText(value: string, key: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    out += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function toHex(value: string): string {
  return Array.from(value)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 2) {
    out += String.fromCharCode(parseInt(value.slice(i, i + 2), 16));
  }
  return out;
}

export function encryptAgencyCode(code: string): string {
  const normalized = normalizeAgencyCode(code);
  return `${AGENCY_CODE_CIPHER_PREFIX}${toHex(xorText(normalized, AGENCY_CODE_DEMO_KEY))}`;
}

export function decryptAgencyCode(encrypted?: string | null): string | null {
  if (!encrypted?.startsWith(AGENCY_CODE_CIPHER_PREFIX)) return null;
  try {
    const payload = encrypted.slice(AGENCY_CODE_CIPHER_PREFIX.length);
    return normalizeAgencyCode(xorText(fromHex(payload), AGENCY_CODE_DEMO_KEY));
  } catch {
    return null;
  }
}

export function agencyCodePreview(code: string): string {
  const normalized = normalizeAgencyCode(code);
  return normalized.slice(-4);
}

export function maskedAgencyCode(preview?: string | null): string {
  return preview ? `**** ${preview}` : "Encrypted";
}

export function protectAgencyCode(code: string): {
  agencyCodeEncrypted: string;
  agencyCodePreview: string;
} {
  const normalized = normalizeAgencyCode(code);
  return {
    agencyCodeEncrypted: encryptAgencyCode(normalized),
    agencyCodePreview: agencyCodePreview(normalized),
  };
}

export function generateConnectionSecret(prefix = "qtx_site"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${out}`;
}

export function encryptConnectionSecret(secret: string): string {
  return `${CONNECTION_SECRET_CIPHER_PREFIX}${toHex(xorText(secret, CONNECTION_SECRET_DEMO_KEY))}`;
}

export function decryptConnectionSecret(encrypted?: string | null): string | null {
  if (!encrypted?.startsWith(CONNECTION_SECRET_CIPHER_PREFIX)) return null;
  try {
    const payload = encrypted.slice(CONNECTION_SECRET_CIPHER_PREFIX.length);
    return xorText(fromHex(payload), CONNECTION_SECRET_DEMO_KEY);
  } catch {
    return null;
  }
}

export function connectionSecretPreview(secret: string): string {
  return secret.slice(-6);
}

export function maskedConnectionSecret(preview?: string | null): string {
  return preview ? `****** ${preview}` : "Protected";
}

export function protectConnectionSecret(secret: string): {
  encrypted: string;
  preview: string;
} {
  return {
    encrypted: encryptConnectionSecret(secret),
    preview: connectionSecretPreview(secret),
  };
}

export function revealProtectedAgencyCode(agency: {
  agencyCode?: string;
  agencyCodeEncrypted?: string;
}): string | null {
  const decrypted = decryptAgencyCode(agency.agencyCodeEncrypted);
  if (decrypted) return decrypted;
  const legacy = normalizeAgencyCode(agency.agencyCode ?? "");
  return legacy || null;
}

export function agencyCodeMatches(
  agency: { agencyCode?: string; agencyCodeEncrypted?: string },
  submittedCode: string
): boolean {
  const protectedCode = revealProtectedAgencyCode(agency);
  return !!protectedCode && protectedCode === normalizeAgencyCode(submittedCode);
}

function agencyCodePrefix(name: string): string {
  const words = slugifyAgency(name).split("-").filter(Boolean);
  const initials = words.map((word) => word[0]).join("").toUpperCase();
  const compact = words.join("").toUpperCase();
  return (initials || compact || "QTX").slice(0, 5).padEnd(3, "X");
}

function randomCodeSuffix(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function generateAgencyCode(
  agencyName: string,
  existingCodes: Iterable<string> = []
): string {
  const used = new Set(Array.from(existingCodes, normalizeAgencyCode));
  const prefix = agencyCodePrefix(agencyName);
  for (let i = 0; i < 50; i++) {
    const next = normalizeAgencyCode(`${prefix}${randomCodeSuffix()}`);
    if (!used.has(next)) return next;
  }
  let seq = used.size + 1;
  while (used.has(normalizeAgencyCode(`${prefix}${seq}`))) seq++;
  return normalizeAgencyCode(`${prefix}${seq}`);
}

export function generateUsername(role: Role, agencyName: string, idx: number): string {
  const slug = slugifyAgency(agencyName);
  const seq = String(idx).padStart(2, "0");
  if (role === "manager") return `manager${seq}-${slug}`;
  if (role === "agent") return `agent${seq}-${slug}`;
  return `${role}${seq}-${slug}`;
}

// How many staff seats to provision when a new agency is created, broken
// down by role. Counts are deliberately capped — even on Ultra we only
// provision 25 placeholder accounts at create time so the Users page stays
// readable; the agency can request more via the tier limits.
export function tierProvisionPlan(
  tier: SubscriptionTier
): { agent: number; manager: number; total: number } {
  switch (tier) {
    case "minimum":
      return { agent: 2, manager: 1, total: 3 };
    case "mid":
      return { agent: 7, manager: 3, total: 10 };
    case "ultra":
      return { agent: 18, manager: 7, total: 25 };
  }
}
