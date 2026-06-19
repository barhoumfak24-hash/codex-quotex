import type { Asset, PolicyParty } from "@/types";

export interface PolicyAssociatedAddress {
  id: string;
  label: string;
  address: string;
}

const ADDRESS_KEY_MATCHERS = [
  /address/i,
  /location/i,
  /premises/i,
  /marina/i,
  /mooring/i,
];

export function buildPolicyAssociatedAddresses(input: {
  asset?: Asset;
  holders?: PolicyParty[];
  customerGaragingAddress?: string;
}): PolicyAssociatedAddress[] {
  const rows: PolicyAssociatedAddress[] = [];
  const seen = new Set<string>();

  function add(label: string, value: unknown, idHint: string) {
    const address = cleanAddressValue(value);
    if (!address) return;
    const key = normalizeAddressKey(address);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      id: `${idHint}:${key}`,
      label,
      address,
    });
  }

  const asset = input.asset;
  if (asset) {
    Object.entries(asset.details ?? {}).forEach(([key, value]) => {
      if (/mailing/i.test(key)) return;
      if (!ADDRESS_KEY_MATCHERS.some((matcher) => matcher.test(key))) return;
      add(assetAddressLabel(key, asset), value, `asset:${asset.id}:${key}`);
    });
  }
  add("Garaging address", input.customerGaragingAddress, "customer:garaging");

  (input.holders ?? []).forEach((holder, index) => {
    add(`${policyPartyAddressLabel(holder)} address`, holder.address, `holder:${index}`);
  });

  return rows;
}

function cleanAddressValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || clean === "-" || (clean.length === 1 && clean.charCodeAt(0) === 8212)) return undefined;
  return clean;
}

function normalizeAddressKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function assetAddressLabel(key: string, asset: Asset): string {
  if (/marina|mooring/i.test(key)) return "Marina / mooring location";
  if (/premises/i.test(key)) return "Premises address";
  if (/business/i.test(key)) return "Business address";
  if (/storage/i.test(key)) return "Storage location";
  if (/garaging/i.test(key)) {
    return asset.type === "luxury_vehicle" ? "Vehicle location" : "Covered location";
  }
  if (/location/i.test(key)) return locationLabelForAsset(asset);
  return primaryAddressLabelForAsset(asset);
}

function primaryAddressLabelForAsset(asset: Asset): string {
  if (asset.type === "coastal_home") return "Property address";
  if (asset.type === "luxury_vehicle") return "Vehicle location";
  if (asset.type === "yacht") return "Marina / mooring location";
  if (asset.type === "jewelry") return "Storage location";
  if (asset.type === "full_portfolio") return "Portfolio address";
  return "Associated address";
}

function locationLabelForAsset(asset: Asset): string {
  if (asset.type === "luxury_vehicle") return "Vehicle location";
  if (asset.type === "yacht") return "Marina / mooring location";
  if (asset.type === "jewelry") return "Storage location";
  return "Covered location";
}

function policyPartyAddressLabel(holder: Pick<PolicyParty, "holderType" | "relationship" | "name">): string {
  if (holder.relationship?.trim()) return holder.relationship.trim();
  if (!holder.holderType) return holder.name || "Policy contact";
  const labels: Record<NonNullable<PolicyParty["holderType"]>, string> = {
    named_insured: "Named insured",
    additional_insured: "Additional insured",
    listed_driver: "Listed driver",
    lienholder: "Lienholder",
    mortgagee: "Mortgagee",
    certificate_holder: "Certificate holder",
    beneficiary: "Beneficiary",
    other: "Policy contact",
  };
  return labels[holder.holderType];
}
