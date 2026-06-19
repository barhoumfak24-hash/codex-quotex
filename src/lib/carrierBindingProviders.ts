import type {
  Carrier,
  CarrierPolicyBindingTrace,
  CarrierQuote,
  Policy,
  QuotingSession,
} from "@/types";

type BindingProvider = CarrierPolicyBindingTrace["provider"];

export interface CarrierPolicyBindingInput {
  carrier: Carrier;
  session: QuotingSession;
  quote: CarrierQuote;
  policy: Policy;
  implementedById: string;
}

export interface CarrierPolicyBindingRequest {
  requestId: string;
  carrierId: string;
  carrierName: string;
  customerId: string;
  assetId: string;
  policyId: string;
  policyNumber?: string;
  premium?: number;
  effectiveDate?: string;
  renewalDate?: string;
  lineOfBusiness?: "personal" | "commercial";
  quoteRequestId?: string;
  quoteExecutionId?: string;
  carrierReference: string;
  publicFields: Record<string, unknown>;
  questionnaireResponses: Record<string, string>;
  assetDetails: Record<string, string>;
}

function readClientEnv(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "boolean") return value ? "true" : undefined;
  return undefined;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function providerFor(carrier: Carrier, quote: CarrierQuote): BindingProvider {
  const quoteProvider = quote.providerTrace?.provider;
  if (quoteProvider === "carrier_portal_automation") return "carrier_portal_automation";
  if (carrier.agentPortalUrl) return "manual_required";
  return "demo_adapter";
}

function providerLabel(provider: BindingProvider, carrier: Carrier, quote: CarrierQuote): string {
  if (carrier.bindingApi?.provider?.trim()) return carrier.bindingApi.provider.trim();
  if (provider === "carrier_portal_automation") return "AI carrier portal runner";
  if (provider === "manual_required") {
    return quote.providerTrace?.providerLabel
      ? `${quote.providerTrace.providerLabel} manual bind`
      : "Manual carrier bind";
  }
  return "Demo carrier adapter";
}

function transportFor(provider: BindingProvider): CarrierPolicyBindingTrace["transport"] {
  if (provider === "carrier_portal_automation") return "browser_automation";
  if (provider === "manual_required") return "manual";
  return "demo";
}

export function buildCarrierPolicyBindingRequest(
  input: CarrierPolicyBindingInput
): CarrierPolicyBindingRequest {
  const { carrier, session, quote, policy } = input;
  const requestId = `BND-${session.id.slice(-8).toUpperCase()}-${carrier.id.slice(-5).toUpperCase()}`;
  const carrierReference =
    policy.carrierBindingReference ??
    quote.implementation?.carrierReference ??
    quote.providerTrace?.executionId ??
    `${policy.policyNumber ?? policy.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  return {
    requestId,
    carrierId: carrier.id,
    carrierName: carrier.name,
    customerId: policy.customerId,
    assetId: policy.assetId,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    premium: policy.finalPremium ?? policy.premiumEstimate ?? quote.premium,
    effectiveDate: policy.effectiveDate,
    renewalDate: policy.renewalDate,
    lineOfBusiness: policy.department,
    quoteRequestId: quote.providerTrace?.requestId,
    quoteExecutionId: quote.providerTrace?.executionId,
    carrierReference,
    publicFields: session.publicFields ?? {},
    questionnaireResponses: session.questionnaireResponses ?? {},
    assetDetails: session.assetDetails ?? {},
  };
}

function blockingReasonsFor(
  carrier: Carrier,
  quote: CarrierQuote,
  provider: BindingProvider
): string[] {
  const reasons: string[] = [];
  const bridgeUrl = readClientEnv("VITE_QUOTEX_CARRIER_BINDING_BRIDGE_URL");
  if (provider === "demo_adapter") {
    reasons.push("no carrier portal handoff configured");
  }
  if (provider === "manual_required") {
    reasons.push("carrier-side issuance requires opening the carrier portal");
  }
  if (provider === "carrier_portal_automation") {
    if (!carrier.agentPortalUrl) reasons.push("missing carrier agent portal URL");
    if (!bridgeUrl) reasons.push("AI carrier portal runner bridge not configured");
  }
  return reasons;
}

export function prepareCarrierPolicyBinding(
  input: CarrierPolicyBindingInput
): CarrierPolicyBindingTrace {
  const provider = providerFor(input.carrier, input.quote);
  const request = buildCarrierPolicyBindingRequest(input);
  const blockingReasons = blockingReasonsFor(input.carrier, input.quote, provider);
  const bridgeUrl = readClientEnv("VITE_QUOTEX_CARRIER_BINDING_BRIDGE_URL");
  const liveReady = blockingReasons.length === 0 && !!bridgeUrl;
  const executionId =
    provider === "carrier_portal_automation"
      ? `RPA-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(request.requestId) % 10000}`
      : undefined;
  const status: CarrierPolicyBindingTrace["status"] =
    provider === "manual_required"
      ? "manual_required"
      : provider === "demo_adapter"
        ? "prepared_not_sent"
        : "prepared_not_sent";
  const messages =
    provider === "manual_required"
      ? [
          `Prepared carrier bind handoff ${request.requestId}.`,
          "Carrier-side registration still requires opening the carrier / rater portal and issuing the policy there.",
          ...blockingReasons,
        ]
      : provider === "carrier_portal_automation"
        ? [
            `Prepared AI carrier portal runner task ${request.requestId}.`,
            liveReady
              ? "Runner bridge is configured; production can open the carrier portal, complete MFA, and submit only after the carrier, insured, premium, effective date, and policy number match."
              : "Runner checklist prepared. Carrier-side submission is blocked until the AI runner bridge, carrier portal URL, and protected credentials are configured.",
            "No carrier page is submitted unless every verification checkpoint passes.",
            ...blockingReasons,
          ]
      : provider === "demo_adapter"
        ? [
            `Recorded demo implementation ${request.requestId}.`,
            "No carrier-side bind request was sent.",
          ]
        : [
            `Prepared carrier portal handoff ${request.requestId}.`,
            "Carrier-side issuance remains a staff-supervised carrier portal step.",
            ...blockingReasons,
          ];

  return {
    provider,
    providerLabel: providerLabel(provider, input.carrier, input.quote),
    transport: transportFor(provider),
    requestId: request.requestId,
    executionId,
    liveReady,
    submittedAt: new Date().toISOString(),
    status,
    carrierReference: request.carrierReference,
    carrierPolicyNumber: input.policy.policyNumber,
    messages,
    blockingReasons,
  };
}

export async function runCarrierPolicyBinding(
  input: CarrierPolicyBindingInput
): Promise<CarrierPolicyBindingTrace> {
  const prepared = prepareCarrierPolicyBinding(input);
  const bridgeUrl = readClientEnv("VITE_QUOTEX_CARRIER_BINDING_BRIDGE_URL");
  if (!bridgeUrl || !prepared.liveReady) return prepared;

  try {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrier: {
          id: input.carrier.id,
          name: input.carrier.name,
          agentPortalUrl: input.carrier.agentPortalUrl,
          bindingApi: input.carrier.bindingApi,
          quotingApi: input.carrier.quotingApi,
        },
        session: {
          id: input.session.id,
          tenantId: input.session.tenantId,
          customerId: input.session.customerId,
          prospectId: input.session.prospectId,
          assetId: input.session.assetId,
          assetType: input.session.assetType,
          state: input.session.state,
          lineOfBusiness: input.session.lineOfBusiness,
          publicFields: input.session.publicFields,
          questionnaireResponses: input.session.questionnaireResponses,
          assetDetails: input.session.assetDetails,
        },
        quote: {
          carrierId: input.quote.carrierId,
          premium: input.quote.premium,
          providerTrace: input.quote.providerTrace,
        },
        policy: input.policy,
        implementedById: input.implementedById,
      }),
    });
    const data = (await response.json()) as { bindingTrace?: CarrierPolicyBindingTrace; message?: string };
    if (response.ok && data.bindingTrace) return data.bindingTrace;
    return {
      ...prepared,
      status: "failed",
      liveReady: false,
      messages: [
        ...prepared.messages,
        data.message ?? `Carrier binding bridge returned HTTP ${response.status}.`,
      ],
      blockingReasons: [...prepared.blockingReasons, "carrier binding bridge failed"],
    };
  } catch (err) {
    return {
      ...prepared,
      status: "failed",
      liveReady: false,
      messages: [
        ...prepared.messages,
        err instanceof Error ? err.message : "Carrier binding bridge request failed.",
      ],
      blockingReasons: [...prepared.blockingReasons, "carrier binding bridge request failed"],
    };
  }
}
