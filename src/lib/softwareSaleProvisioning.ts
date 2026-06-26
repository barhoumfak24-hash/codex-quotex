import { api } from "@/lib/api";
import { addMonthsToDateInput, isoFromDateInput } from "@/lib/agencyContract";
import { isLivePlatformAgency } from "@/lib/demoData";
import { normalizeSoftwarePlanTerm, TIER_LIMITS } from "@/lib/tiers";
import type { Agency, SoftwareSale } from "@/types";

export function provisionAgencyForCompletedSale(sale: SoftwareSale): Agency {
  const startedAtInput = new Date().toISOString().slice(0, 10);
  const termMonths = normalizeSoftwarePlanTerm(sale.termMonths);
  const tierLimits = TIER_LIMITS[sale.tier];
  const now = new Date().toISOString();
  const existingAgency = api.agencies
    .list()
    .filter(isLivePlatformAgency)
    .find(
      (agency) =>
        agency.contactEmail.toLowerCase() === sale.email.toLowerCase() ||
        agency.name.trim().toLowerCase() === sale.agencyName.trim().toLowerCase()
    );
  const priceOverrideChanged =
    !existingAgency ||
    existingAgency.monthlyPriceOverrideUsd !== sale.customMonthlyPriceUsd ||
    existingAgency.monthlyPriceOverrideReason !== sale.customMonthlyPriceReason;
  const planPatch = {
    name: sale.agencyName,
    contactEmail: sale.email,
    phone: sale.phone,
    website: sale.website,
    tier: sale.tier,
    active: true,
    serviceAreas: existingAgency?.serviceAreas ?? [],
    websiteAppAddOn: sale.websiteAppAddOn ?? "none",
    softwarePlanTermMonths: termMonths,
    softwarePlanStartedAt: isoFromDateInput(startedAtInput),
    softwarePlanRenewsAt: isoFromDateInput(addMonthsToDateInput(startedAtInput, termMonths)),
    monthlyPriceOverrideUsd: sale.customMonthlyPriceUsd,
    monthlyPriceOverrideReason: sale.customMonthlyPriceReason,
    monthlyPriceOverrideUpdatedAt:
      sale.customMonthlyPriceUsd !== undefined
        ? priceOverrideChanged
          ? now
          : existingAgency?.monthlyPriceOverrideUpdatedAt ?? now
        : undefined,
    stripeCustomerId: sale.stripeCheckoutSessionId,
    ...tierLimits,
  };

  if (existingAgency) {
    if (!agencyPatchHasChanges(existingAgency, planPatch)) return existingAgency;
    return api.agencies.update(existingAgency.id, planPatch) ?? existingAgency;
  }

  return api.agencies.create({
    ...planPatch,
    address: "",
  });
}

function agencyPatchHasChanges(agency: Agency, patch: Partial<Agency>) {
  return Object.entries(patch).some(([key, value]) => {
    const current = agency[key as keyof Agency];
    if (Array.isArray(current) || Array.isArray(value)) {
      return JSON.stringify(current ?? []) !== JSON.stringify(value ?? []);
    }
    return current !== value;
  });
}
