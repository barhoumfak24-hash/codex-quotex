import type { SubscriptionTier } from "@/types";

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
    monthlyPriceUsd: number;
  }
> = {
  minimum: {
    allowedUsers: 3,
    allowedProspectsPerMonth: 200,
    allowedAiMessagesPerMonth: 1000,
    allowedCarriers: 5,
    customBranding: false,
    customDomain: false,
    support: "Basic",
    monthlyPriceUsd: 299,
  },
  mid: {
    allowedUsers: 10,
    allowedProspectsPerMonth: 1000,
    allowedAiMessagesPerMonth: 5000,
    allowedCarriers: 12,
    customBranding: true,
    customDomain: false,
    support: "Priority",
    monthlyPriceUsd: 899,
  },
  ultra: {
    allowedUsers: 999_999,
    allowedProspectsPerMonth: 999_999,
    allowedAiMessagesPerMonth: 999_999,
    allowedCarriers: 999,
    customBranding: true,
    customDomain: true,
    support: "Dedicated",
    monthlyPriceUsd: 2499,
  },
};