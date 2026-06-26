import { aiRankCarrierQuotes } from "./ai";
import { runCarrierPortalRunner } from "./carrierPortalRunner";
import type {
  AssetType,
  Carrier,
  CarrierQuote,
  CarrierQuoteProviderTrace,
  QuotingLineOfBusiness,
  QuotingSession,
} from "@/types";

type ProviderKind = CarrierQuoteProviderTrace["provider"];

export interface CarrierQuoteProviderReadiness {
  provider: ProviderKind;
  providerLabel: string;
  transport: CarrierQuoteProviderTrace["transport"];
  endpoint?: string;
  portalUrl?: string;
  hasHttpsEndpoint: boolean;
  hasPortalUrl: boolean;
  configuredStatus: NonNullable<Carrier["quotingApi"]>["status"];
  quoteApiStatus: CarrierQuote["apiStatus"];
  liveReady: boolean;
  blockingReasons: string[];
}

export interface CarrierQuoteProviderRequest {
  requestId: string;
  xrefKey: string;
  carrierId: string;
  carrierName: string;
  lineOfBusiness: QuotingLineOfBusiness;
  assetType: AssetType;
  estimatedValue: number;
  state?: string;
  publicFields: Record<string, unknown>;
  questionnaireResponses: Record<string, string>;
  assetDetails: Record<string, string>;
  portalAutomationPlan?: {
    entryUrl: string;
    surface: "agent_portal" | "customer_portal";
    browserSessionReference?: string;
    mfaMode?: NonNullable<Carrier["quotingAutomation"]>["mfaMode"];
    parallelGroupKey: string;
  };
}

export interface CarrierQuoteProviderRunInput {
  carrier: Carrier;
  session: QuotingSession;
  state?: string;
}

function readClientEnv(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const value = env?.[name];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "boolean") return value ? "true" : undefined;
  return undefined;
}

function providerFor(carrier: Carrier): ProviderKind {
  const automationProvider = `${carrier.quotingAutomation?.provider ?? ""} ${
    carrier.quotingAutomation?.agentPortalUrl ?? carrier.quotingAutomation?.customerPortalUrl ?? ""
  }`.toLowerCase();
  if (automationProvider || carrier.agentPortalUrl) return "carrier_portal_automation";
  return "configuration_only";
}

function providerLabel(provider: ProviderKind, carrier: Carrier): string {
  if (provider === "carrier_portal_automation") {
    return carrier.quotingAutomation?.provider?.trim() || "AI carrier portal runner";
  }
  return "AI carrier portal runner";
}

function transportFor(provider: ProviderKind): CarrierQuoteProviderTrace["transport"] {
  if (provider === "carrier_portal_automation") return "browser_automation";
  return "manual";
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalizeDetails(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, field]) => String(field ?? "").trim())
  );
}

export function getCarrierQuoteProviderReadiness(
  carrier: Carrier
): CarrierQuoteProviderReadiness {
  const provider = providerFor(carrier);
  const endpoint = undefined;
  const portalUrl =
    carrier.quotingAutomation?.agentPortalUrl?.trim() ||
    carrier.quotingAutomation?.customerPortalUrl?.trim() ||
    carrier.agentPortalUrl?.trim();
  const configuredStatus = carrier.quotingAutomation?.status ?? "not_configured";
  const automationStatus = carrier.quotingAutomation?.status ?? "configured";
  const hasHttpsEndpoint = false;
  const hasPortalUrl = !!portalUrl && /^https:\/\//i.test(portalUrl);
  const blockingReasons: string[] = [];
  const label = providerLabel(provider, carrier);

  if (provider === "carrier_portal_automation") {
    const automationBridge = readClientEnv("VITE_QUOTEX_CARRIER_AUTOMATION_BRIDGE_URL");
    const browserSessionReference = readClientEnv("VITE_QUOTEX_CARRIER_BROWSER_SESSION_REFERENCE");
    if (!portalUrl) blockingReasons.push("missing carrier portal URL");
    if (portalUrl && !hasPortalUrl) blockingReasons.push("carrier portal URL must be HTTPS");
    if (!automationBridge) {
      blockingReasons.push("server-side carrier automation worker is not configured");
    }
    if (automationBridge && !browserSessionReference) {
      blockingReasons.push("agent must be signed into the carrier portal in their browser before the runner can access it");
    }
    if (automationStatus === "not_configured") blockingReasons.push("carrier portal automation not configured");
    if (automationStatus === "configured") blockingReasons.push("carrier portal automation has not passed a live test");
    if (automationStatus === "error") blockingReasons.push("last carrier portal automation test failed");
  } else {
    blockingReasons.push("carrier portal runner not configured");
  }

  const liveReady =
    provider === "carrier_portal_automation" &&
    automationStatus === "connected" &&
    hasPortalUrl &&
    blockingReasons.length === 0;
  const quoteApiStatus: CarrierQuote["apiStatus"] = liveReady
    ? "connected"
    : provider === "carrier_portal_automation" && hasPortalUrl
    ? "simulated"
    : "no_api";

  return {
    provider,
    providerLabel: label,
    transport: transportFor(provider),
    endpoint,
    portalUrl,
    hasHttpsEndpoint,
    hasPortalUrl,
    configuredStatus,
    quoteApiStatus,
    liveReady,
    blockingReasons,
  };
}

export function buildCarrierQuoteProviderRequest(
  input: CarrierQuoteProviderRunInput
): CarrierQuoteProviderRequest {
  const { carrier, session, state } = input;
  const requestId = `QTX-${session.id.slice(-8).toUpperCase()}-${carrier.id.slice(-5).toUpperCase()}`;
  const xrefKey = [
    session.tenantId,
    session.customerId ?? session.prospectId ?? "new-risk",
    session.assetId ?? session.assetType,
  ].join(":");
  const lineOfBusiness = session.lineOfBusiness ?? "personal";
  const payload: CarrierQuoteProviderRequest = {
    requestId,
    xrefKey,
    carrierId: carrier.id,
    carrierName: carrier.name,
    lineOfBusiness,
    assetType: session.assetType,
    estimatedValue: session.estimatedValue || 1_000_000,
    state,
    publicFields: session.publicFields,
    questionnaireResponses: session.questionnaireResponses ?? {},
    assetDetails: normalizeDetails(session.assetDetails),
  };

  if (providerFor(carrier) === "carrier_portal_automation") {
    const entryUrl =
      carrier.quotingAutomation?.agentPortalUrl?.trim() ||
      carrier.quotingAutomation?.customerPortalUrl?.trim() ||
      carrier.agentPortalUrl?.trim();
    if (entryUrl) {
      const browserSessionReference = readClientEnv("VITE_QUOTEX_CARRIER_BROWSER_SESSION_REFERENCE");
      payload.portalAutomationPlan = {
        entryUrl,
        surface: carrier.quotingAutomation?.agentPortalUrl || carrier.agentPortalUrl ? "agent_portal" : "customer_portal",
        browserSessionReference,
        mfaMode: carrier.quotingAutomation?.mfaMode ?? "staff_prompt",
        parallelGroupKey: `parallel:${session.id}:${lineOfBusiness}`,
      };
    }
  }

  return payload;
}

function providerMessages(
  readiness: CarrierQuoteProviderReadiness,
  request: CarrierQuoteProviderRequest
): string[] {
  const runnerOnlyMessages = (
    current: CarrierQuoteProviderReadiness,
    providerRequest: CarrierQuoteProviderRequest
  ) => [
    `Prepared AI carrier portal runner plan ${providerRequest.requestId}.`,
    "Quotex will use the authorized carrier portal workflow for this carrier.",
    ...current.blockingReasons,
  ];
  if (readiness.provider === "carrier_portal_automation") {
    return [
      readiness.liveReady
        ? `Queued AI carrier portal runner job ${request.requestId} for ${request.portalAutomationPlan?.surface === "customer_portal" ? "customer quote portal" : "agent quote portal"} submission.`
        : `Prepared AI carrier portal automation job ${request.requestId}; production run is blocked until the server worker, signed-in browser session, and live carrier test are complete.`,
      request.portalAutomationPlan
        ? `Automation entry point: ${request.portalAutomationPlan.entryUrl}. Jobs sharing ${request.portalAutomationPlan.parallelGroupKey} run in parallel for selected carriers.`
        : "No portal automation entry point could be prepared.",
      ...readiness.blockingReasons,
    ];
  }
  return [
    `No carrier portal runner is configured for request ${request.requestId}; a configuration-only estimate remains available for comparison.`,
  ];
}

export function runCarrierQuoteProvider(input: CarrierQuoteProviderRunInput): CarrierQuote {
  const { carrier, session, state } = input;
  const readiness = getCarrierQuoteProviderReadiness(carrier);
  const request = buildCarrierQuoteProviderRequest(input);
  const ranked = aiRankCarrierQuotes({
    carriers: [carrier],
    assetType: session.assetType,
    estimatedValue: session.estimatedValue || 1_000_000,
    state,
    lineOfBusiness: session.lineOfBusiness,
  }).quotes[0];

  const base: CarrierQuote =
    ranked ??
    ({
      carrierId: carrier.id,
      premium: Math.round((session.estimatedValue || 1_000_000) * 0.01),
      confidence: 0.5,
      score: 0,
      fitReason: "no appetite row",
      apiStatus: readiness.quoteApiStatus,
    } satisfies CarrierQuote);

  const runnerTrace =
    readiness.provider === "carrier_portal_automation"
      ? runCarrierPortalRunner({
          carrier,
          session,
          state,
          baseQuote: base,
        })
      : undefined;
  const liveRunnerQuote = runnerTrace?.mode === "live_worker" && runnerTrace.status === "completed";
  const runnerPremium = liveRunnerQuote ? runnerTrace?.extractedQuote?.premium : undefined;
  const runnerScoreLift =
    liveRunnerQuote ? 0.04 : runnerTrace?.status === "queued" ? 0.02 : 0;
  const runnerConfidenceLift =
    liveRunnerQuote ? 0.03 : runnerTrace?.status === "queued" ? 0.01 : 0;

  const providerSuffix =
    readiness.quoteApiStatus === "connected"
      ? `${readiness.providerLabel} live bridge`
      : readiness.quoteApiStatus === "simulated"
      ? `${readiness.providerLabel} adapter ready`
      : "configuration-only estimate";
  const executionSuffix =
    readiness.provider === "carrier_portal_automation"
      ? runnerTrace?.jobId ?? `RPA-${carrier.id.slice(-5).toUpperCase()}-${stableHash(request.requestId) % 10000}`
      : undefined;
  const messages = providerMessages(readiness, request);
  if (runnerTrace) {
    messages.push(
      `Runner status: ${runnerTrace.status.replace(/_/g, " ")} (${
        runnerTrace.mode === "configuration_trace" ? "configuration trace" : runnerTrace.mode.replace(/_/g, " ")
      }).`,
      `${runnerTrace.mappedFieldCount} fields mapped; ${runnerTrace.requiredFieldCount} required fields identified.`,
      ...runnerTrace.validationChecks
        .filter((check) => check.status !== "pass")
        .map((check) => `${check.label}: ${check.detail}`),
      ...runnerTrace.auditEvents.slice(0, 3)
    );
  }

  return {
    ...base,
    premium: runnerPremium ?? base.premium,
    confidence: Math.min(0.98, base.confidence + runnerConfidenceLift),
    score: Math.min(1, base.score + runnerScoreLift),
    apiStatus: readiness.quoteApiStatus,
    fitReason: `${base.fitReason} - ${
      liveRunnerQuote ? "carrier portal quote imported" : providerSuffix
    }`,
    providerTrace: {
      provider: readiness.provider,
      providerLabel: readiness.providerLabel,
      transport: readiness.transport,
      requestId: request.requestId,
      executionId: executionSuffix,
      liveReady: readiness.liveReady,
      submittedAt: new Date().toISOString(),
      messages,
      runnerTrace,
    },
  };
}

export function runCarrierQuoteProviders(input: {
  carriers: Carrier[];
  session: QuotingSession;
  state?: string;
}): { quotes: CarrierQuote[]; summary: string } {
  const quotes = input.carriers
    .filter((carrier) => carrier.status === "active")
    .map((carrier) => runCarrierQuoteProvider({ carrier, session: input.session, state: input.state }))
    .sort((a, b) => b.score - a.score || a.premium - b.premium);
  const best = quotes[0];
  const liveCount = quotes.filter((quote) => quote.apiStatus === "connected").length;
  const simulatedCount = quotes.filter((quote) => quote.apiStatus === "simulated").length;
  const topCarrier = best
    ? input.carriers.find((carrier) => carrier.id === best.carrierId)?.name ?? "the top carrier"
    : undefined;
  const parts = [
    `${quotes.length} carrier${quotes.length === 1 ? "" : "s"} evaluated through the AI runner workflow`,
    liveCount > 0 ? `${liveCount} live-ready portal ${liveCount === 1 ? "runner" : "runners"}` : undefined,
    quotes.some((quote) => quote.providerTrace?.provider === "carrier_portal_automation")
      ? `${quotes.filter((quote) => quote.providerTrace?.provider === "carrier_portal_automation").length} AI carrier portal ${
          quotes.filter((quote) => quote.providerTrace?.provider === "carrier_portal_automation").length === 1
            ? "runner"
            : "runners"
        } prepared for parallel submission`
      : undefined,
    simulatedCount > 0
      ? `${simulatedCount} configured ${simulatedCount === 1 ? "adapter" : "adapters"} running in configuration-only mode`
      : undefined,
  ].filter(Boolean);
  const summary = best
    ? `${parts.join(". ")}. Top recommendation: ${topCarrier} based on ${best.fitReason}.`
    : `No active carriers configured for ${input.session.assetType.replace(/_/g, " ")}.`;
  return { quotes, summary };
}
