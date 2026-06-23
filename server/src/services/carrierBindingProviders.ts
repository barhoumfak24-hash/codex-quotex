type BindingProvider = "ezlynx_bind" | "carrier_direct" | "manual_required" | "configuration_only";

export interface ServerCarrierBindingRequest {
  carrier: {
    id: string;
    name: string;
    agentPortalUrl?: string;
    bindingApi?: {
      provider?: string;
      endpoint?: string;
      status: "not_configured" | "configured" | "connected" | "error";
    };
    quotingApi?: {
      provider?: string;
      endpoint?: string;
      status: "not_configured" | "configured" | "connected" | "error";
    };
  };
  session: {
    id: string;
    tenantId: string;
    customerId?: string;
    prospectId?: string;
    assetId?: string;
    assetType: string;
    state?: string;
    lineOfBusiness?: "personal" | "commercial";
    publicFields?: Record<string, unknown>;
    questionnaireResponses?: Record<string, string>;
    assetDetails?: Record<string, string>;
  };
  quote: {
    carrierId: string;
    premium: number;
    providerTrace?: {
      provider: "ezlynx_qas" | "carrier_direct" | "configuration_only";
      requestId: string;
      executionId?: string;
      providerLabel: string;
    };
  };
  policy: {
    id: string;
    customerId: string;
    assetId: string;
    policyNumber?: string;
    finalPremium?: number;
    premiumEstimate?: number;
    effectiveDate?: string;
    renewalDate?: string;
    department?: "personal" | "commercial";
  };
  implementedById: string;
}

export interface ServerCarrierBindingTrace {
  provider: BindingProvider;
  providerLabel: string;
  transport: "soap" | "rest" | "manual";
  requestId: string;
  executionId?: string;
  liveReady: boolean;
  submittedAt: string;
  status: "bound_on_carrier" | "prepared_not_sent" | "manual_required" | "failed";
  carrierReference: string;
  carrierPolicyNumber?: string;
  messages: string[];
  blockingReasons: string[];
  rawCarrierResponseSummary?: string;
}

export interface ServerCarrierBindingResponse {
  carrierId: string;
  bindingTrace: ServerCarrierBindingTrace;
  rawCarrierResponse?: unknown;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function providerFor(input: ServerCarrierBindingRequest): BindingProvider {
  const binding = `${input.carrier.bindingApi?.provider ?? ""} ${input.carrier.bindingApi?.endpoint ?? ""}`.toLowerCase();
  if (binding.includes("ezlynx")) return "ezlynx_bind";
  if (binding || input.carrier.bindingApi?.endpoint) return "carrier_direct";
  if (input.quote.providerTrace?.provider === "ezlynx_qas" || input.quote.providerTrace?.provider === "carrier_direct") {
    return "manual_required";
  }
  return "configuration_only";
}

function providerLabel(kind: BindingProvider, input: ServerCarrierBindingRequest): string {
  if (input.carrier.bindingApi?.provider?.trim()) return input.carrier.bindingApi.provider.trim();
  if (kind === "ezlynx_bind") return "EZLynx binding bridge";
  if (kind === "carrier_direct") return "Carrier direct bind API";
  if (kind === "manual_required") {
    return input.quote.providerTrace?.providerLabel
      ? `${input.quote.providerTrace.providerLabel} manual bind`
      : "Manual carrier bind";
  }
  return "Configuration-only carrier workflow";
}

function transportFor(kind: BindingProvider): ServerCarrierBindingTrace["transport"] {
  if (kind === "ezlynx_bind") return "soap";
  if (kind === "carrier_direct") return "rest";
  if (kind === "manual_required") return "manual";
  return "manual";
}

function requestId(input: ServerCarrierBindingRequest) {
  return `BND-${input.session.id.slice(-8).toUpperCase()}-${input.carrier.id.slice(-5).toUpperCase()}`;
}

function carrierReference(input: ServerCarrierBindingRequest, id: string) {
  return input.quote.providerTrace?.executionId ??
    `${input.policy.policyNumber ?? input.policy.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${stableHash(id) % 1000}`;
}

function readiness(input: ServerCarrierBindingRequest, kind: BindingProvider): {
  liveReady: boolean;
  endpoint?: string;
  blockingReasons: string[];
} {
  const binding = input.carrier.bindingApi;
  const endpoint =
    kind === "ezlynx_bind"
      ? binding?.endpoint?.trim() || process.env.EZLYNX_BIND_ENDPOINT?.trim()
      : binding?.endpoint?.trim();
  const blockingReasons: string[] = [];

  if (kind === "manual_required") {
    blockingReasons.push("carrier or rater requires manual bind / issue confirmation");
  }
  if (kind === "configuration_only") {
    blockingReasons.push("no carrier binding API configured");
  }
  if (kind === "carrier_direct" || kind === "ezlynx_bind") {
    if (!endpoint) blockingReasons.push("missing carrier binding endpoint");
    if (endpoint && !/^https:\/\//i.test(endpoint)) blockingReasons.push("binding endpoint must be HTTPS");
    if ((binding?.status ?? "not_configured") !== "connected") {
      blockingReasons.push("carrier binding API has not passed live testing");
    }
  }
  if (kind === "carrier_direct" && process.env.CARRIER_BINDING_ENABLE_LIVE_DIRECT !== "true") {
    blockingReasons.push("CARRIER_BINDING_ENABLE_LIVE_DIRECT must be true before direct bind traffic is sent");
  }
  if (kind === "ezlynx_bind") {
    if (!process.env.EZLYNX_ACCOUNT_USERNAME) blockingReasons.push("EZLYNX_ACCOUNT_USERNAME missing");
    if (process.env.EZLYNX_ENABLE_LIVE_BIND !== "true") {
      blockingReasons.push("EZLYNX_ENABLE_LIVE_BIND must be true before EZLynx bind traffic is sent");
    }
    if (!process.env.EZLYNX_BIND_OPERATION) blockingReasons.push("EZLYNX_BIND_OPERATION missing");
    if (!process.env.EZLYNX_BIND_SOAP_ACTION) blockingReasons.push("EZLYNX_BIND_SOAP_ACTION missing");
  }

  return { liveReady: blockingReasons.length === 0, endpoint, blockingReasons };
}

function buildEzlynxBindSoap(input: ServerCarrierBindingRequest, id: string) {
  const operation = process.env.EZLYNX_BIND_OPERATION!;
  const xrefKey = [
    input.session.tenantId,
    input.policy.customerId,
    input.policy.assetId,
    input.policy.policyNumber ?? input.policy.id,
  ].join(":");
  const fields = Object.entries({
    QuoteRequestId: input.quote.providerTrace?.requestId,
    QuoteExecutionId: input.quote.providerTrace?.executionId,
    PolicyNumber: input.policy.policyNumber,
    Premium: input.policy.finalPremium ?? input.policy.premiumEstimate ?? input.quote.premium,
    EffectiveDate: input.policy.effectiveDate,
    RenewalDate: input.policy.renewalDate,
    LineOfBusiness: input.policy.department ?? input.session.lineOfBusiness,
    State: input.session.state,
    ...(input.session.assetDetails ?? {}),
    ...(input.session.publicFields ?? {}),
    ...(input.session.questionnaireResponses ?? {}),
  })
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(
      ([key, value]) =>
        `<value><Name>${xmlEscape(key)}</Name><Value>${xmlEscape(value)}</Value></value>`
    )
    .join("");

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`,
    `<soap:Header><AuthenticationHeaderAcct xmlns="http://www.ezlynx.com/"><AccountUsername>${xmlEscape(
      process.env.EZLYNX_ACCOUNT_USERNAME
    )}</AccountUsername></AuthenticationHeaderAcct></soap:Header>`,
    `<soap:Body><${operation} xmlns="http://www.ezlynx.com/">`,
    `<PolicyBindRequest xmlns="http://www.ezlynx.com/XMLSchema/EzLynxQuoteRequest/V200">`,
    `<PolicyData XrefKey="${xmlEscape(xrefKey)}" RequestID="${xmlEscape(id)}" xmlns="">`,
    `<CarrierExecution><CarrierID>${stableHash(input.carrier.id) % 100000}</CarrierID></CarrierExecution>`,
    `<PropertyValues>${fields}</PropertyValues>`,
    `</PolicyData></PolicyBindRequest></${operation}></soap:Body></soap:Envelope>`,
  ].join("");
}

function baseTrace(input: ServerCarrierBindingRequest, kind: BindingProvider): ServerCarrierBindingTrace {
  const id = requestId(input);
  const ready = readiness(input, kind);
  const reference = carrierReference(input, id);
  const executionId =
    kind === "ezlynx_bind"
      ? `EZB-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(id) % 10000}`
      : kind === "carrier_direct"
        ? `BND-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(id) % 10000}`
        : undefined;
  return {
    provider: kind,
    providerLabel: providerLabel(kind, input),
    transport: transportFor(kind),
    requestId: id,
    executionId,
    liveReady: ready.liveReady,
    submittedAt: new Date().toISOString(),
    status: kind === "manual_required" ? "manual_required" : "prepared_not_sent",
    carrierReference: reference,
    carrierPolicyNumber: input.policy.policyNumber,
    messages: [],
    blockingReasons: ready.blockingReasons,
  };
}

export async function runServerCarrierBindingProvider(
  input: ServerCarrierBindingRequest
): Promise<ServerCarrierBindingResponse> {
  const kind = providerFor(input);
  const ready = readiness(input, kind);
  const trace = baseTrace(input, kind);

  if (!ready.liveReady) {
    return {
      carrierId: input.carrier.id,
      bindingTrace: {
        ...trace,
        messages:
          kind === "manual_required"
            ? [
                `Prepared carrier bind handoff ${trace.requestId}.`,
                "Carrier-side registration still requires manual issue / bind confirmation.",
                ...ready.blockingReasons,
              ]
            : [
                `Prepared carrier bind request ${trace.requestId}.`,
                "Server did not send live carrier bind traffic because credentials, endpoint, or explicit live flags are missing.",
                ...ready.blockingReasons,
              ],
      },
    };
  }

  if (kind === "ezlynx_bind") {
    const endpoint = ready.endpoint!;
    const soap = buildEzlynxBindSoap(input, trace.requestId);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: process.env.EZLYNX_BIND_SOAP_ACTION!,
      },
      body: soap,
    });
    const text = await response.text();
    return {
      carrierId: input.carrier.id,
      bindingTrace: {
        ...trace,
        status: response.ok ? "bound_on_carrier" : "failed",
        liveReady: response.ok,
        messages: [
          `Sent EZLynx bind request ${trace.requestId}.`,
          response.ok
            ? "Carrier/rater bind confirmation received."
            : `Binding endpoint returned HTTP ${response.status}; policy must remain under carrier review.`,
        ],
        rawCarrierResponseSummary: text.slice(0, 2000),
      },
      rawCarrierResponse: text.slice(0, 20_000),
    };
  }

  if (kind === "carrier_direct") {
    const response = await fetch(ready.endpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    return {
      carrierId: input.carrier.id,
      bindingTrace: {
        ...trace,
        status: response.ok ? "bound_on_carrier" : "failed",
        liveReady: response.ok,
        messages: [
          `Sent carrier direct bind request ${trace.requestId}.`,
          response.ok
            ? "Carrier policy registration confirmation received."
            : `Carrier direct bind returned HTTP ${response.status}; policy must remain under carrier review.`,
        ],
        rawCarrierResponseSummary: text.slice(0, 2000),
      },
      rawCarrierResponse: text.slice(0, 20_000),
    };
  }

  return {
    carrierId: input.carrier.id,
    bindingTrace: trace,
  };
}
