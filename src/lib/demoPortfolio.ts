import { api } from "./api";
import type { Asset, CustomerProfile, Policy } from "@/types";

function namedAddress(customer: CustomerProfile) {
  return customer.mailingAddress || "44 Sea Breeze Ln, Palm Beach, FL 33480";
}

function namedDriver(customer: CustomerProfile) {
  return customer.name || "Demo Customer";
}

function ensureAssetMap(customer: CustomerProfile): Record<string, Asset> {
  const existing = api.assets.listByCustomer(customer.id);
  const byType = Object.fromEntries(existing.map((asset) => [asset.type, asset])) as Record<string, Asset>;

  const create = (input: Omit<Asset, "id" | "createdAt">) => {
    const asset = api.assets.create(input);
    byType[asset.type] = asset;
    return asset;
  };

  byType.coastal_home ??= create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    type: "coastal_home",
    label: "Sea Breeze Estate",
    estimatedValue: 4_250_000,
    status: "insured",
    details: {
      address: namedAddress(customer),
      squareFootage: 6800,
      roofAge: 4,
      windMitigation: true,
      floodZone: "AE",
      constructionType: "Concrete block",
      alarm: "Central station fire and burglar",
    },
  });

  byType.luxury_vehicle ??= create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    type: "luxury_vehicle",
    label: "2023 Porsche 911 Turbo S",
    estimatedValue: 245_000,
    status: "insured",
    details: {
      vin: "WP0AD2A99NS260123",
      year: 2023,
      make: "Porsche",
      model: "911 Turbo S",
      garagingAddress: namedAddress(customer),
      usage: "Pleasure",
      drivers: [{ name: namedDriver(customer), license: "FL" }],
    },
  });

  byType.yacht ??= create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    type: "yacht",
    label: "M/Y Liora - 72ft",
    estimatedValue: 3_100_000,
    status: "pending",
    details: {
      length: 72,
      year: 2021,
      make: "Princess Yachts",
      model: "Y72",
      marinaLocation: "Palm Harbor Marina, Palm Beach, FL",
      navigationArea: "Florida coastal waters and Bahamas",
      operator: "Captain operated",
    },
  });

  byType.jewelry ??= create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    type: "jewelry",
    label: "Scheduled jewelry collection",
    estimatedValue: 385_000,
    status: "insured",
    details: {
      collectionType: "Jewelry, watches, and heirloom pieces",
      appraisalDate: "2026-02-14",
      vaultStorage: "Home safe plus bank vault for travel pieces",
      highestValueItem: "Diamond tennis necklace - $92,000",
    },
  });

  byType.umbrella_liability ??= create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    type: "umbrella_liability",
    label: "$10M family umbrella",
    estimatedValue: 10_000_000,
    status: "insured",
    details: {
      limit: "$10,000,000",
      underlyingPolicies: "Home, auto, yacht, watercraft, and personal liability",
      householdMembers: "2 adults, 1 youthful driver away at school",
    },
  });

  return byType;
}

function policyForAsset(policies: Policy[], assetId?: string) {
  return assetId ? policies.find((policy) => policy.assetId === assetId) : undefined;
}

function ensurePolicies(customer: CustomerProfile, assets: Record<string, Asset>) {
  const existing = api.policies.listByCustomer(customer.id);
  const byAsset = new Map(existing.map((policy) => [policy.assetId, policy]));
  const create = (input: Omit<Policy, "id" | "createdAt">) => {
    const policy = api.policies.create(input);
    byAsset.set(policy.assetId, policy);
    existing.push(policy);
    return policy;
  };

  if (assets.coastal_home && !byAsset.has(assets.coastal_home.id)) {
    create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      assetId: assets.coastal_home.id,
      carrierId: "carrier_chubb",
      policyNumber: "CHB-HM-558920",
      premiumEstimate: 18_400,
      finalPremium: 17_950,
      effectiveDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      renewalDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      status: "bound",
      renewalStatus: "upcoming",
      agentId: customer.assignedAgentId ?? "user_agent_pc",
      paymentFrequency: "quarterly",
      billingMethod: "direct_bill",
      billingPayer: "client",
      billingStatus: "current",
      nextPaymentDueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      nextPaymentAmount: 4_487,
      coverages: [
        { name: "Dwelling", limit: 2_400_000, deductible: 5_000 },
        { name: "Personal property", limit: 1_200_000, deductible: 5_000 },
        { name: "Personal liability", limit: 1_000_000 },
        { name: "Named storm deductible", deductible: 36_000, description: "1.5% of Coverage A." },
      ],
      endorsements: [
        { name: "Water backup", description: "$25,000 limit." },
        { name: "Equipment breakdown", description: "Generator, HVAC, and smart-home systems." },
      ],
      exclusions: ["Flood", "Wear and tear", "Intentional acts"],
      premiumBreakdown: { base: 16_800, fees: 350, taxes: 800, total: 17_950 },
    });
  }

  if (assets.luxury_vehicle && !byAsset.has(assets.luxury_vehicle.id)) {
    create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      assetId: assets.luxury_vehicle.id,
      carrierId: "carrier_pure",
      policyNumber: "PURE-AU-441188",
      premiumEstimate: 6_200,
      finalPremium: 6_050,
      effectiveDate: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
      renewalDate: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000).toISOString(),
      status: "bound",
      renewalStatus: "not_due",
      agentId: customer.assignedAgentId ?? "user_agent_pc",
      paymentFrequency: "semi_annual",
      billingMethod: "carrier_autopay",
      billingPayer: "client",
      billingStatus: "current",
      nextPaymentDueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      nextPaymentAmount: 3_025,
      coverages: [
        { name: "Bodily injury liability", limit: 500_000 },
        { name: "Comprehensive", deductible: 1_000 },
        { name: "Collision", deductible: 1_000 },
        { name: "Uninsured motorist", limit: 500_000 },
      ],
      endorsements: [
        { name: "Agreed value", description: "Settles at agreed value, not ACV." },
        { name: "OEM parts", description: "Repairs use original-equipment manufacturer parts." },
      ],
      exclusions: ["Racing or track-day use", "Commercial use / ride-share"],
      premiumBreakdown: { base: 5_800, fees: 100, taxes: 150, total: 6_050 },
    });
  }

  if (assets.jewelry && !byAsset.has(assets.jewelry.id)) {
    create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      assetId: assets.jewelry.id,
      carrierId: "carrier_chubb",
      policyNumber: "CHB-IM-774120",
      premiumEstimate: 3_850,
      finalPremium: 3_675,
      effectiveDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      renewalDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      status: "bound",
      renewalStatus: "not_due",
      agentId: customer.assignedAgentId ?? "user_agent_pc",
      paymentFrequency: "annual",
      billingMethod: "direct_bill",
      billingPayer: "client",
      billingStatus: "paid_in_full",
      coverages: [
        { name: "Scheduled jewelry", limit: 385_000 },
        { name: "Worldwide coverage", description: "Includes travel and temporary off-premises coverage." },
        { name: "Mysterious disappearance", limit: 385_000 },
      ],
      endorsements: [{ name: "Newly acquired items", description: "90 days automatic coverage." }],
      exclusions: ["Wear and tear", "Intentional parting"],
      premiumBreakdown: { base: 3_400, fees: 75, taxes: 200, total: 3_675 },
    });
  }

  if (assets.umbrella_liability && !byAsset.has(assets.umbrella_liability.id)) {
    create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      assetId: assets.umbrella_liability.id,
      carrierId: "carrier_chubb",
      policyNumber: "CHB-UMB-908211",
      premiumEstimate: 4_900,
      finalPremium: 4_750,
      effectiveDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      renewalDate: new Date(Date.now() + 95 * 24 * 60 * 60 * 1000).toISOString(),
      status: "bound",
      renewalStatus: "not_due",
      agentId: customer.assignedAgentId ?? "user_agent_pc",
      paymentFrequency: "annual",
      billingMethod: "direct_bill",
      billingPayer: "client",
      billingStatus: "current",
      coverages: [
        { name: "Personal excess liability", limit: 10_000_000 },
        { name: "Worldwide defense", description: "Defense outside the limit where available." },
        { name: "Uninsured / underinsured motorist excess", limit: 1_000_000 },
      ],
      endorsements: [{ name: "Trust and LLC interest", description: "Extends named insured wording to listed entities." }],
      exclusions: ["Business pursuits", "Aircraft ownership", "Intentional acts"],
      premiumBreakdown: { base: 4_300, fees: 100, taxes: 350, total: 4_750 },
    });
  }

  return api.policies.listByCustomer(customer.id);
}

function ensureDocuments(customer: CustomerProfile, assets: Record<string, Asset>, policies: Policy[]) {
  if (api.documents.listByEntity({ customerId: customer.id }).length > 0) return;
  const uploadedById = customer.assignedAgentId ?? "user_agent_pc";
  const doc = (
    fileName: string,
    type: string,
    asset?: Asset,
    policy?: Policy,
    extra?: { customerEsignRequired?: boolean }
  ) =>
    api.documents.create({
      tenantId: customer.tenantId,
      uploadedById,
      fileName,
      fileType: "application/pdf",
      type,
      visibility: "customer_visible",
      status: "approved",
      customerId: customer.id,
      assetId: asset?.id,
      policyId: policy?.id,
      customerEsignRequired: extra?.customerEsignRequired,
    });

  const homePolicy = policyForAsset(policies, assets.coastal_home?.id);
  const autoPolicy = policyForAsset(policies, assets.luxury_vehicle?.id);
  const jewelryPolicy = policyForAsset(policies, assets.jewelry?.id);
  const umbrellaPolicy = policyForAsset(policies, assets.umbrella_liability?.id);

  doc("Chubb-Home-Declarations.pdf", "declarations_page", assets.coastal_home, homePolicy);
  doc("PURE-Auto-ID-Card.pdf", "insurance_id_card", assets.luxury_vehicle, autoPolicy);
  doc("Jewelry-Appraisal-Schedule.pdf", "appraisal", assets.jewelry, jewelryPolicy);
  doc("Umbrella-Underlying-Schedule.pdf", "policy_document", assets.umbrella_liability, umbrellaPolicy);
  doc("Yacht-Survey-Request.pdf", "asset_information", assets.yacht, undefined, { customerEsignRequired: true });
}

function ensureClaims(customer: CustomerProfile, assets: Record<string, Asset>, policies: Policy[]) {
  const autoPolicy = policyForAsset(policies, assets.luxury_vehicle?.id) ?? policies[0];
  const homePolicy = policyForAsset(policies, assets.coastal_home?.id) ?? policies[0];
  const restoreActivePolicyStatuses = () => {
    [autoPolicy, homePolicy].filter(Boolean).forEach((policy) => {
      api.policies.update(policy!.id, { status: "bound" });
    });
  };
  if (api.claims.listByCustomer(customer.id).length > 0) {
    restoreActivePolicyStatuses();
    return;
  }
  if (autoPolicy) {
    api.claims.create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      policyId: autoPolicy.id,
      carrierId: autoPolicy.carrierId,
      externalClaimNumber: "CR-PURE-441188-1",
      lossDescription: "Windshield chip repair opened from the carrier portal.",
      lossAmountUsd: 950,
      status: "in_review",
    });
  }
  if (homePolicy) {
    const closed = api.claims.create({
      tenantId: customer.tenantId,
      customerId: customer.id,
      policyId: homePolicy.id,
      carrierId: homePolicy.carrierId,
      externalClaimNumber: "CR-CHB-558920-2",
      lossDescription: "Water leak inspection closed with no covered damage.",
      lossAmountUsd: 0,
      status: "opened",
    });
    api.claims.close(closed.id, "system");
  }
  restoreActivePolicyStatuses();
}

function ensureQuotes(customer: CustomerProfile) {
  if (api.quotes.listByCustomer(customer.id).length > 0) return;
  api.quotes.create({
    tenantId: customer.tenantId,
    customerId: customer.id,
    assetType: "yacht",
    lineOfBusiness: "personal",
    categoryLabel: "Yacht",
    rawDescription: "Quote request for a 72ft Princess yacht based in Palm Beach with Bahamas cruising.",
    parsedData: {
      length: 72,
      year: 2021,
      make: "Princess Yachts",
      model: "Y72",
      navigationArea: "Florida coastal waters and Bahamas",
      operator: "Captain operated",
      estimatedValue: 3_100_000,
    },
    aiPremiumEstimateMin: 28_500,
    aiPremiumEstimateMax: 34_000,
    aiRecommendedCarrierId: "carrier_pure",
    aiRecommendationReason: "Strong appetite for captain-operated yachts with current survey and marina contract.",
    missingDocuments: ["Captain credentials", "Most recent survey", "Marina contract"],
    status: "submitted_to_agent",
    assignedAgentId: customer.assignedAgentId ?? "user_agent_pc",
    currentStep: "underwriting review",
    completionPercent: 80,
    lastTouchedAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
  });
}

function ensureTimeline(customer: CustomerProfile) {
  const existing = api.status.listFor({ customerId: customer.id }).filter((event) => event.visibility === "customer_visible");
  if (existing.length >= 3) return;
  api.status.create({
    tenantId: customer.tenantId,
    source: "system",
    message: "Demo portfolio loaded with home, auto, jewelry, umbrella, yacht, documents, claims, and quote activity.",
    visibility: "customer_visible",
    customerId: customer.id,
  });
  api.status.create({
    tenantId: customer.tenantId,
    source: "agent",
    message: "Olivia Marsh shared updated policy documents to your portal.",
    visibility: "customer_visible",
    customerId: customer.id,
    createdById: customer.assignedAgentId ?? "user_agent_pc",
  });
}

export function ensureDemoCustomerPortfolio(customer: CustomerProfile) {
  if (!customer.assignedAgentId || !customer.mailingAddress) {
    api.customers.update(customer.id, {
      assignedAgentId: customer.assignedAgentId ?? "user_agent_pc",
      assignedCsrId: customer.assignedCsrId ?? "user_csr_pc",
      mailingAddress: customer.mailingAddress ?? "44 Sea Breeze Ln, Palm Beach, FL 33480",
      garagingAddress: customer.garagingAddress ?? "44 Sea Breeze Ln, Palm Beach, FL 33480",
      additionalContacts:
        customer.additionalContacts && customer.additionalContacts.length > 0
          ? customer.additionalContacts
          : [
              {
                name: "Marcus Whitford",
                relation: "Spouse",
                phone: "+1 (555) 220-0191",
                email: "marcus.whitford@example.com",
              },
            ],
    });
  }

  const hydratedCustomer = api.customers.get(customer.id) ?? customer;
  const assets = ensureAssetMap(hydratedCustomer);
  const policies = ensurePolicies(hydratedCustomer, assets);
  ensureDocuments(hydratedCustomer, assets, policies);
  ensureClaims(hydratedCustomer, assets, policies);
  ensureQuotes(hydratedCustomer);
  ensureTimeline(hydratedCustomer);
}
