type QuoteApiStatus = "connected" | "simulated" | "no_api";
type ProviderKind = "ezlynx_qas" | "carrier_direct" | "configuration_only";

export interface ServerCarrierQuoteRequest {
  carrier: {
    id: string;
    name: string;
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
    estimatedValue?: number;
    state?: string;
    lineOfBusiness?: "personal" | "commercial";
    publicFields?: Record<string, unknown>;
    questionnaireResponses?: Record<string, string>;
    assetDetails?: Record<string, string>;
  };
}

export interface ServerCarrierQuoteResponse {
  carrierId: string;
  apiStatus: QuoteApiStatus;
  providerTrace: {
    provider: ProviderKind;
    providerLabel: string;
    transport: "soap" | "rest" | "manual";
    requestId: string;
    executionId?: string;
    liveReady: boolean;
    submittedAt: string;
    messages: string[];
  };
  rawCarrierResponse?: unknown;
}

function providerFor(input: ServerCarrierQuoteRequest["carrier"]): ProviderKind {
  const value = `${input.quotingApi?.provider ?? ""} ${input.quotingApi?.endpoint ?? ""}`.toLowerCase();
  if (value.includes("ezlynx") || value.includes("qas")) return "ezlynx_qas";
  if (input.quotingApi?.endpoint) return "carrier_direct";
  return "configuration_only";
}

function providerLabel(kind: ProviderKind, input: ServerCarrierQuoteRequest["carrier"]) {
  if (input.quotingApi?.provider?.trim()) return input.quotingApi.provider.trim();
  if (kind === "ezlynx_qas") return "EZLynx QAS";
  if (kind === "carrier_direct") return "Carrier direct API";
  return "Configuration-only carrier workflow";
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

function buildRequestId(input: ServerCarrierQuoteRequest) {
  return `QTX-${input.session.id.slice(-8).toUpperCase()}-${input.carrier.id.slice(-5).toUpperCase()}`;
}

function buildEzlynxSoap(input: ServerCarrierQuoteRequest, requestId: string) {
  const xrefKey = [
    input.session.tenantId,
    input.session.customerId ?? input.session.prospectId ?? "new-risk",
    input.session.assetId ?? input.session.assetType,
  ].join(":");
  const propertyValues = Object.entries({
    LineOfBusiness: input.session.lineOfBusiness ?? "personal",
    AssetType: input.session.assetType,
    EstimatedValue: input.session.estimatedValue ?? 1_000_000,
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
      process.env.EZLYNX_ACCOUNT_USERNAME ?? "server-provided"
    )}</AccountUsername></AuthenticationHeaderAcct></soap:Header>`,
    `<soap:Body><SubmitQuote xmlns="http://www.ezlynx.com/">`,
    `<QuoteRequest xmlns="http://www.ezlynx.com/XMLSchema/EzLynxQuoteRequest/V200">`,
    `<QuoteData XrefKey="${xmlEscape(xrefKey)}" DataUploadFlags="0" AlwaysSaveXrefKey="true" xmlns="">`,
    `<RequestID>${xmlEscape(requestId)}</RequestID>`,
    `<CarrierExecution><CarrierID>${stableHash(input.carrier.id) % 100000}</CarrierID></CarrierExecution>`,
    `<PropertyValues>${propertyValues}</PropertyValues>`,
    `</QuoteData></QuoteRequest></SubmitQuote></soap:Body></soap:Envelope>`,
  ].join("");
}

function liveReady(input: ServerCarrierQuoteRequest, kind: ProviderKind): {
  value: boolean;
  blockingReasons: string[];
} {
  const endpoint = input.carrier.quotingApi?.endpoint?.trim();
  const status = input.carrier.quotingApi?.status ?? "not_configured";
  const blockingReasons: string[] = [];
  if (!endpoint) blockingReasons.push("missing quoting API endpoint");
  if (endpoint && !/^https:\/\//i.test(endpoint)) blockingReasons.push("endpoint must be HTTPS");
  if (status !== "connected") blockingReasons.push("carrier API has not passed live testing");
  if (kind === "ezlynx_qas") {
    if (!process.env.EZLYNX_ACCOUNT_USERNAME) blockingReasons.push("EZLYNX_ACCOUNT_USERNAME missing");
    if (process.env.EZLYNX_ENABLE_LIVE_QAS !== "true") {
      blockingReasons.push("EZLYNX_ENABLE_LIVE_QAS must be true before server sends QAS traffic");
    }
  }
  return { value: blockingReasons.length === 0, blockingReasons };
}

export async function runServerCarrierQuoteProvider(
  input: ServerCarrierQuoteRequest
): Promise<ServerCarrierQuoteResponse> {
  const kind = providerFor(input.carrier);
  const readiness = liveReady(input, kind);
  const requestId = buildRequestId(input);
  const label = providerLabel(kind, input.carrier);
  const submittedAt = new Date().toISOString();
  const executionId =
    kind === "ezlynx_qas"
      ? `QAS-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(requestId) % 10000}`
      : kind === "carrier_direct"
      ? `DIR-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(requestId) % 10000}`
      : undefined;
  const baseTrace = {
    provider: kind,
    providerLabel: label,
    transport: kind === "ezlynx_qas" ? "soap" : kind === "carrier_direct" ? "rest" : "manual",
    requestId,
    executionId,
    liveReady: readiness.value,
    submittedAt,
    messages: [] as string[],
  } satisfies ServerCarrierQuoteResponse["providerTrace"];

  if (!readiness.value) {
    return {
      carrierId: input.carrier.id,
      apiStatus:
        input.carrier.quotingApi?.status === "configured" ||
        input.carrier.quotingApi?.status === "connected"
          ? "simulated"
          : "no_api",
      providerTrace: {
        ...baseTrace,
        messages:
          kind === "ezlynx_qas"
            ? [
                `Prepared EZLynx SubmitQuote payload ${requestId}.`,
                "Server did not send live QAS traffic because credentials or the explicit live flag are missing.",
                ...readiness.blockingReasons,
              ]
            : [`Prepared provider payload ${requestId}.`, ...readiness.blockingReasons],
      },
    };
  }

  if (kind === "ezlynx_qas") {
    const endpoint = input.carrier.quotingApi!.endpoint!.trim();
    const soap = buildEzlynxSoap(input, requestId);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://www.ezlynx.com/SubmitQuote",
      },
      body: soap,
    });
    const text = await response.text();
    return {
      carrierId: input.carrier.id,
      apiStatus: response.ok ? "connected" : "simulated",
      providerTrace: {
        ...baseTrace,
        messages: [
          `Sent EZLynx SubmitQuote request ${requestId}.`,
          response.ok
            ? "QAS response received from EZLynx."
            : `QAS returned HTTP ${response.status}; quote should remain under agent review.`,
        ],
      },
      rawCarrierResponse: text.slice(0, 20_000),
    };
  }

  return {
    carrierId: input.carrier.id,
    apiStatus: "connected",
    providerTrace: {
      ...baseTrace,
      messages: [`Carrier direct endpoint is live-ready for request ${requestId}.`],
    },
  };
}
