import { api } from "@/lib/api";
import { addMonthsToDateInput, isoFromDateInput } from "@/lib/agencyContract";
import { isLivePlatformAgency } from "@/lib/demoData";
import { db } from "@/lib/db";
import {
  normalizeSoftwarePlanTerm,
  normalizeSoftwareProduct,
  TIER_LIMITS,
} from "@/lib/tiers";
import type { Agency, SoftwareSale } from "@/types";

export function softwareSaleHasCompletedPayment(sale: SoftwareSale): boolean {
  return (
    sale.status === "paid" ||
    sale.status === "provisioning" ||
    sale.status === "closed" ||
    sale.stripePaymentStatus === "paid" ||
    !!sale.stripePaidAt ||
    sale.invoiceEmailStatus === "sent" ||
    !!sale.invoiceEmailSentAt
  );
}

function softwareSaleNeedsAgencyReconciliation(sale: SoftwareSale): boolean {
  return sale.status !== "closed" && softwareSaleHasCompletedPayment(sale);
}

export function reconcilePaidSoftwareSalesToAgencies(): Agency[] {
  const provisionedAgencies: Agency[] = [];

  for (const sale of db.list("softwareSales")) {
    if (!softwareSaleNeedsAgencyReconciliation(sale)) continue;

    const agency = provisionAgencyForCompletedSale(sale);
    provisionedAgencies.push(agency);

    if ((sale.invoiceEmailStatus === "sent" || sale.invoiceEmailSentAt) && sale.status !== "closed") {
      api.softwareSales.update(sale.id, { status: "closed" });
    } else if (sale.status === "checkout_pending") {
      api.softwareSales.update(sale.id, { status: "paid" });
    }
  }

  return provisionedAgencies;
}

export function listReconciledLivePlatformAgencies(): Agency[] {
  return listLivePlatformAgencies();
}

export function listLivePlatformAgencies(): Agency[] {
  return db.list("agencies").filter(isLivePlatformAgency);
}

export function provisionAgencyForCompletedSale(sale: SoftwareSale): Agency {
  const startedAtInput = new Date().toISOString().slice(0, 10);
  const termMonths = normalizeSoftwarePlanTerm(sale.termMonths);
  const softwarePlanStartedAt =
    sale.stripeSubscriptionTermStartedAt ??
    sale.stripePaidAt ??
    isoFromDateInput(startedAtInput);
  const softwarePlanRenewsAt =
    sale.stripeSubscriptionTermEndsAt ??
    isoFromDateInput(addMonthsToDateInput(softwarePlanStartedAt.slice(0, 10), termMonths));
  const product = normalizeSoftwareProduct(sale.product);
  const tierLimits = TIER_LIMITS[sale.tier];
  const planLimits = tierLimits;
  const now = new Date().toISOString();
  const saleEmail = sale.email.trim().toLowerCase();
  const saleName = sale.agencyName.trim().toLowerCase();
  const saleStripeCustomerId = sale.stripeCustomerId?.trim();
  const saleStripeSessionId = sale.stripeCheckoutSessionId?.trim();
  const existingAgency = db
    .list("agencies")
    .filter(isLivePlatformAgency)
    .find(
      (agency) =>
        (!!saleStripeCustomerId && agency.stripeCustomerId === saleStripeCustomerId) ||
        (!!saleStripeSessionId && agency.stripeCustomerId === saleStripeSessionId) ||
        agency.contactEmail.toLowerCase() === saleEmail ||
        agency.name.trim().toLowerCase() === saleName
    );
  const billingSuspended =
    existingAgency?.active === false &&
    existingAgency.monthlyPriceOverrideUsd === 0 &&
    /suspended|deactivated/i.test(existingAgency.monthlyPriceOverrideReason ?? "");
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
    active: existingAgency?.active ?? true,
    serviceAreas: existingAgency?.serviceAreas ?? [],
    softwareProduct: product,
    websiteAppAddOn: sale.websiteAppAddOn ?? "none",
    softwarePlanTermMonths: termMonths,
    softwarePlanStartedAt,
    softwarePlanRenewsAt,
    monthlyPriceOverrideUsd: billingSuspended
      ? existingAgency.monthlyPriceOverrideUsd
      : sale.customMonthlyPriceUsd,
    monthlyPriceOverrideReason: billingSuspended
      ? existingAgency.monthlyPriceOverrideReason
      : sale.customMonthlyPriceReason,
    monthlyPriceOverrideUpdatedAt:
      billingSuspended
        ? existingAgency.monthlyPriceOverrideUpdatedAt ?? now
        : sale.customMonthlyPriceUsd !== undefined
        ? priceOverrideChanged
          ? now
          : existingAgency?.monthlyPriceOverrideUpdatedAt ?? now
        : undefined,
    stripeCustomerId: sale.stripeCustomerId ?? sale.stripeCheckoutSessionId ?? existingAgency?.stripeCustomerId,
    stripeSubscriptionId: sale.stripeSubscriptionId ?? existingAgency?.stripeSubscriptionId,
    stripeSubscriptionTermStartedAt: sale.stripeSubscriptionTermStartedAt ?? existingAgency?.stripeSubscriptionTermStartedAt,
    stripeSubscriptionTermEndsAt: sale.stripeSubscriptionTermEndsAt ?? existingAgency?.stripeSubscriptionTermEndsAt,
    stripeSubscriptionCancelAt: sale.stripeSubscriptionCancelAt ?? existingAgency?.stripeSubscriptionCancelAt,
    ...planLimits,
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
