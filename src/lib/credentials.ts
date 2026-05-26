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