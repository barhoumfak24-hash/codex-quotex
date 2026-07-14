import type {
  Agency,
  SoftwareProduct,
  SoftwarePlanTermMonths,
  SoftwareSaleWebsiteAppAddOn,
  SubscriptionTier,
} from "@/types";

export const SOFTWARE_USER_MONTHLY_PRICE_USD = 300;
export const ADD_ON_USER_SLOT_MONTHLY_PRICE_USD = SOFTWARE_USER_MONTHLY_PRICE_USD;
export const ADD_ON_CARRIER_MONTHLY_PRICE_USD = 150;
export const ADD_ON_AI_MESSAGE_BLOCK_SIZE = 1000;
export const ADD_ON_AI_MESSAGE_BLOCK_MONTHLY_PRICE_USD = 75;
export const SOFTWARE_SETUP_FEE_USD = 0;
export const COMPANY_WEBSITE_MONTHLY_ADD_ON_USD = 3_000;
export const COMPANY_APP_MONTHLY_ADD_ON_USD = 3_000;
export const COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD = 1_000;
export const COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD =
  COMPANY_WEBSITE_MONTHLY_ADD_ON_USD +
  COMPANY_APP_MONTHLY_ADD_ON_USD -
  COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD;
export const SOFTWARE_USER_BLOCK_DISCOUNT_SIZE = 10;
export const SOFTWARE_USER_BLOCK_MONTHLY_DISCOUNT_USD = 0;

export const SOFTWARE_PRODUCT_OPTIONS: Record<
  SoftwareProduct,
  {
    label: string;
    shortLabel: string;
    description: string;
    userMonthlyPriceUsd: number;
    supportsWebsiteAppAddOns: boolean;
  }
> = {
  full_platform: {
    label: "Full Quotex software",
    shortLabel: "Full software",
    description:
      "Complete agency operating system with clients, policies, messages, documents, carrier workflows, and AI quoting.",
    userMonthlyPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD,
    supportsWebsiteAppAddOns: true,
  },
};

export const SOFTWARE_PLAN_TERM_OPTIONS: Array<{
  months: SoftwarePlanTermMonths;
  label: string;
  discountPercent: number;
}> = [
  { months: 12, label: "12 months", discountPercent: 0 },
  { months: 24, label: "24 months", discountPercent: 5 },
  { months: 36, label: "36 months", discountPercent: 8 },
];

export const WEBSITE_APP_ADD_ON_OPTIONS: Record<
  SoftwareSaleWebsiteAppAddOn,
  {
    label: string;
    description: string;
    monthlyPriceUsd: number;
  }
> = {
  none: {
    label: "Software only",
    description: "No company website or Quotex app activation.",
    monthlyPriceUsd: 0,
  },
  website: {
    label: "Company website",
    description:
      "Add the branded company website with client portal access and quote intake connected to the software.",
    monthlyPriceUsd: COMPANY_WEBSITE_MONTHLY_ADD_ON_USD,
  },
  app: {
    label: "Quotex client app",
    description:
      "Activate the agency inside the universal Quotex client app with portal access and quote intake connected to the software.",
    monthlyPriceUsd: COMPANY_APP_MONTHLY_ADD_ON_USD,
  },
  website_app: {
    label: "Company website + Quotex app",
    description:
      "Bundle the separate branded company website with Quotex app activation. Both connect client portal access and quote intake to the software. Save $1,000/mo.",
    monthlyPriceUsd: COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD,
  },
};

export const TIER_LIMITS: Record<
  SubscriptionTier,
  {
    allowedUsers: number;
    allowedProspectsPerMonth: number;
    allowedAiMessagesPerMonth: number;
    allowedCarriers: number;
    customBranding: boolean;
    customDomain: boolean;
    support: string;
    seatPriceUsd: number;
    minimumBillableSeats: number;
    monthlyPriceUsd: number;
  }
> = {
  minimum: {
    allowedUsers: 10,
    allowedProspectsPerMonth: 200,
    allowedAiMessagesPerMonth: 1000,
    allowedCarriers: 5,
    customBranding: false,
    customDomain: false,
    support: "Basic",
    seatPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD,
    minimumBillableSeats: 10,
    monthlyPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD * 10,
  },
  mid: {
    allowedUsers: 25,
    allowedProspectsPerMonth: 1000,
    allowedAiMessagesPerMonth: 5000,
    allowedCarriers: 12,
    customBranding: true,
    customDomain: false,
    support: "Priority",
    seatPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD,
    minimumBillableSeats: 25,
    monthlyPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD * 25,
  },
  ultra: {
    allowedUsers: 50,
    allowedProspectsPerMonth: 999_999,
    allowedAiMessagesPerMonth: 999_999,
    allowedCarriers: 999,
    customBranding: true,
    customDomain: true,
    support: "Dedicated",
    seatPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD,
    minimumBillableSeats: 50,
    monthlyPriceUsd: SOFTWARE_USER_MONTHLY_PRICE_USD * 50,
  },
};

export function billableSeatsForTier(tier: SubscriptionTier, requestedSeats: number): number {
  const safeSeats = Math.max(1, Math.ceil(requestedSeats) || 1);
  return Math.max(safeSeats, TIER_LIMITS[tier].minimumBillableSeats);
}

export function monthlyPriceForSeats(tier: SubscriptionTier, _requestedSeats: number): number {
  return TIER_LIMITS[tier].monthlyPriceUsd;
}

export function monthlyPriceForTier(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].monthlyPriceUsd;
}

export function websiteAppAddOnMonthlyUsd(addOn?: SoftwareSaleWebsiteAppAddOn): number {
  return WEBSITE_APP_ADD_ON_OPTIONS[addOn ?? "none"].monthlyPriceUsd;
}

export function normalizeSoftwareProduct(_product?: SoftwareProduct | string | null): SoftwareProduct {
  return "full_platform";
}

export function softwareProductSupportsWebsiteAppAddOns(product?: SoftwareProduct | string | null): boolean {
  return SOFTWARE_PRODUCT_OPTIONS[normalizeSoftwareProduct(product)].supportsWebsiteAppAddOns;
}

export function softwareSeatMonthlyPrice(product?: SoftwareProduct | string | null): number {
  return SOFTWARE_PRODUCT_OPTIONS[normalizeSoftwareProduct(product)].userMonthlyPriceUsd;
}

export function websiteAppAddOnRetailMonthlyUsd(addOn?: SoftwareSaleWebsiteAppAddOn): number {
  return addOn === "website_app"
    ? COMPANY_WEBSITE_MONTHLY_ADD_ON_USD + COMPANY_APP_MONTHLY_ADD_ON_USD
    : websiteAppAddOnMonthlyUsd(addOn);
}

export function websiteAppAddOnBundleDiscountUsd(addOn?: SoftwareSaleWebsiteAppAddOn): number {
  return addOn === "website_app" ? COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD : 0;
}

export function normalizeSoftwarePlanTerm(
  termMonths?: SoftwarePlanTermMonths | number
): SoftwarePlanTermMonths {
  if (termMonths === 24 || termMonths === 36) return termMonths;
  return 12;
}

export function softwarePlanTermDiscountPercent(
  termMonths?: SoftwarePlanTermMonths | number
): number {
  const normalized = normalizeSoftwarePlanTerm(termMonths);
  return (
    SOFTWARE_PLAN_TERM_OPTIONS.find((option) => option.months === normalized)?.discountPercent ?? 0
  );
}

export function normalizeSoftwareUserCount(seats: number): number {
  return Math.max(1, Math.ceil(Number.isFinite(seats) ? seats : 1));
}

export function softwareUserDiscountBlocks(seats: number): number {
  void seats;
  return 0;
}

export function softwareUserMonthlySubtotal(
  seats: number,
  product?: SoftwareProduct | string | null
): number {
  return normalizeSoftwareUserCount(seats) * softwareSeatMonthlyPrice(product);
}

export function softwareUserMonthlyDiscount(seats: number): number {
  void seats;
  return 0;
}

export function softwareUsersUntilNextDiscount(seats: number): number {
  void seats;
  return 0;
}

export function softwareNextMonthlyDiscount(seats: number): number {
  void seats;
  return 0;
}

export function softwareUserMonthlyTotal(seats: number): number {
  return Math.max(0, softwareUserMonthlySubtotal(seats) - softwareUserMonthlyDiscount(seats));
}

export function softwareSaleMonthlyTotalForSeats(
  seats: number,
  addOn?: SoftwareSaleWebsiteAppAddOn,
  termMonths?: SoftwarePlanTermMonths | number,
  product?: SoftwareProduct | string | null
): number {
  const beforeTermDiscount = softwarePlanMonthlyBeforeTermDiscount(seats, addOn, product);
  return Math.max(
    0,
    beforeTermDiscount - softwarePlanTermDiscountMonthlyUsd(beforeTermDiscount, termMonths)
  );
}

export function softwareSaleMonthlyTotal(
  tier: SubscriptionTier,
  addOn?: SoftwareSaleWebsiteAppAddOn
): number {
  return monthlyPriceForTier(tier) + websiteAppAddOnMonthlyUsd(addOn);
}

export function includedUserSlotsForTier(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].allowedUsers;
}

export function softwarePlanMonthlyBeforeTermDiscount(
  seats: number,
  addOn?: SoftwareSaleWebsiteAppAddOn,
  product?: SoftwareProduct | string | null
): number {
  const normalizedProduct = normalizeSoftwareProduct(product);
  const normalizedAddOn = softwareProductSupportsWebsiteAppAddOns(normalizedProduct)
    ? addOn
    : "none";
  return softwareUserMonthlySubtotal(seats, normalizedProduct) + websiteAppAddOnMonthlyUsd(normalizedAddOn);
}

export function softwarePlanTermDiscountMonthlyUsd(
  monthlyBeforeTermDiscount: number,
  termMonths?: SoftwarePlanTermMonths | number
): number {
  const discountPercent = softwarePlanTermDiscountPercent(termMonths);
  return discountPercent > 0
    ? Math.round(Math.max(0, monthlyBeforeTermDiscount) * (discountPercent / 100))
    : 0;
}

export function extraUserSlotsForAgency(
  agency: Pick<Agency, "tier" | "allowedUsers">
): number {
  return Math.max(0, agency.allowedUsers - includedUserSlotsForTier(agency.tier));
}

export function agencySlotAddOnMonthlyUsd(
  agency: Pick<Agency, "tier" | "allowedUsers">
): number {
  return extraUserSlotsForAgency(agency) * ADD_ON_USER_SLOT_MONTHLY_PRICE_USD;
}

export function extraCarriersForAgency(
  agency: Pick<Agency, "tier"> & Partial<Pick<Agency, "allowedCarriers">>
): number {
  const included = TIER_LIMITS[agency.tier].allowedCarriers;
  return Math.max(0, (agency.allowedCarriers ?? included) - included);
}

export function agencyCarrierAddOnMonthlyUsd(
  agency: Pick<Agency, "tier"> & Partial<Pick<Agency, "allowedCarriers">>
): number {
  return extraCarriersForAgency(agency) * ADD_ON_CARRIER_MONTHLY_PRICE_USD;
}

export function extraAiMessageBlocksForAgency(
  agency: Pick<Agency, "tier"> & Partial<Pick<Agency, "allowedAiMessagesPerMonth">>
): number {
  const included = TIER_LIMITS[agency.tier].allowedAiMessagesPerMonth;
  const extraMessages = Math.max(0, (agency.allowedAiMessagesPerMonth ?? included) - included);
  return Math.ceil(extraMessages / ADD_ON_AI_MESSAGE_BLOCK_SIZE);
}

export function agencyAiMessageAddOnMonthlyUsd(
  agency: Pick<Agency, "tier"> & Partial<Pick<Agency, "allowedAiMessagesPerMonth">>
): number {
  return extraAiMessageBlocksForAgency(agency) * ADD_ON_AI_MESSAGE_BLOCK_MONTHLY_PRICE_USD;
}

export function standardAgencyMonthlyPriceUsd(
  agency: Pick<Agency, "tier" | "allowedUsers"> &
    Partial<Pick<Agency, "softwareProduct" | "websiteAppAddOn" | "softwarePlanTermMonths">>
): number {
  const product = normalizeSoftwareProduct(agency.softwareProduct);
  return softwareSaleMonthlyTotalForSeats(
    Math.max(1, Math.ceil(agency.allowedUsers || TIER_LIMITS[agency.tier].allowedUsers)),
    softwareProductSupportsWebsiteAppAddOns(product) ? agency.websiteAppAddOn : "none",
    agency.softwarePlanTermMonths,
    product
  );
}

export function agencyMonthlyPriceUsd(
  agency: Pick<Agency, "tier" | "allowedUsers"> &
    Partial<
      Pick<
        Agency,
        | "allowedCarriers"
        | "allowedAiMessagesPerMonth"
        | "softwareProduct"
        | "websiteAppAddOn"
        | "softwarePlanTermMonths"
        | "monthlyPriceOverrideUsd"
      >
    >
): number {
  if (typeof agency.monthlyPriceOverrideUsd === "number" && agency.monthlyPriceOverrideUsd >= 0) {
    return agency.monthlyPriceOverrideUsd;
  }
  return standardAgencyMonthlyPriceUsd(agency);
}
