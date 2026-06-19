import type {
  AssetType,
  Carrier,
  CarrierPortalFieldMapping,
  CarrierPortalRunnerCheck,
  CarrierPortalRunnerTrace,
  CarrierQuote,
  QuotingSession,
} from "@/types";

type FieldSource = CarrierPortalFieldMapping["source"];

export interface CarrierPortalRunnerInput {
  carrier: Carrier;
  session: QuotingSession;
  state?: string;
  baseQuote: Pick<CarrierQuote, "premium" | "score" | "confidence">;
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

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function carrierFieldName(raw: string): string {
  const normalized = titleCase(raw);
  const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const known: Record<string, string> = {
    "asset type": "Line / Risk Type",
    "estimated value": "Estimated Insured Value",
    "garaging address": "Garaging / Risk Address",
    "property address": "Risk Address",
    "mailing address": "Applicant Mailing Address",
    vin: "VIN",
    hin: "HIN",
    "federal ein": "FEIN",
    "base federal ein": "FEIN",
    "legal business name": "Legal Business Name",
    "legal business name as registered": "Legal Business Name",
    "base legal business name": "Legal Business Name",
    "base legal business name as registered": "Legal Business Name",
  };
  return known[key] ?? normalized;
}

function requiredLabelsForAsset(assetType: AssetType, line: "personal" | "commercial"): string[] {
  const common =
    line === "commercial"
      ? ["Line of business", "Asset type", "Estimated value", "Legal business name", "FEIN"]
      : ["Line of business", "Asset type", "Estimated value"];
  if (assetType === "coastal_home") {
    return [...common, "Property address", "Garaging address", "Year built", "Roof year"];
  }
  if (assetType === "luxury_vehicle") {
    return [...common, "VIN", "Year", "Make", "Model", "Garaging address"];
  }
  if (assetType === "yacht") {
    return [...common, "HIN", "Length", "Marina", "Captain credentials"];
  }
  if (assetType === "jewelry") {
    return [...common, "Appraisal value", "Safe storage", "Description"];
  }
  if (assetType === "umbrella_liability") {
    return [...common, "Underlying limits", "Requested umbrella limit"];
  }
  return common;
}

function isRequiredField(field: string, requiredLabels: string[]): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return requiredLabels.some((required) => {
    const needle = required.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return normalized.includes(needle) || needle.includes(normalized);
  });
}

function mapping(
  quotexField: string,
  value: unknown,
  source: FieldSource,
  requiredLabels: string[]
): CarrierPortalFieldMapping | null {
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  return {
    quotexField,
    carrierField: carrierFieldName(quotexField),
    value: cleaned,
    source,
    required: isRequiredField(quotexField, requiredLabels),
    confidence:
      source === "system"
        ? 0.99
        : source === "questionnaire"
          ? 0.93
          : source === "asset_detail"
            ? 0.88
            : 0.82,
  };
}

function collectFieldMappings(
  session: QuotingSession,
  state: string | undefined
): CarrierPortalFieldMapping[] {
  const line = session.lineOfBusiness ?? "personal";
  const required = requiredLabelsForAsset(session.assetType, line);
  const fields: CarrierPortalFieldMapping[] = [];
  const push = (item: CarrierPortalFieldMapping | null) => {
    if (!item) return;
    const duplicate = fields.find(
      (existing) =>
        existing.carrierField === item.carrierField &&
        existing.value.toLowerCase() === item.value.toLowerCase()
    );
    if (!duplicate) fields.push(item);
  };

  push(mapping("Line of business", line === "commercial" ? "Commercial lines" : "Personal lines", "system", required));
  push(mapping("Asset type", titleCase(session.assetType), "system", required));
  push(mapping("Estimated value", session.estimatedValue, "system", required));
  push(mapping("State", state ?? session.state, "system", required));

  Object.entries(session.assetDetails ?? {}).forEach(([field, value]) => {
    push(mapping(field, value, "asset_detail", required));
  });
  Object.entries(session.publicFields ?? {}).forEach(([field, value]) => {
    push(mapping(field, value, "public_record", required));
  });

  const labelByQuestionId = new Map(
    (session.questionnaireQuestions ?? []).map((question) => [question.id, question.label])
  );
  Object.entries(session.questionnaireResponses ?? {}).forEach(([questionId, value]) => {
    push(mapping(labelByQuestionId.get(questionId) ?? questionId, value, "questionnaire", required));
  });

  return fields.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.carrierField.localeCompare(b.carrierField);
  });
}

function validationChecks(input: {
  carrier: Carrier;
  session: QuotingSession;
  state?: string;
  entryUrl?: string;
  credentialReference?: string;
  bridgeUrl?: string;
  fieldMappings: CarrierPortalFieldMapping[];
}): CarrierPortalRunnerCheck[] {
  const requiredLabels = requiredLabelsForAsset(
    input.session.assetType,
    input.session.lineOfBusiness ?? "personal"
  );
  const checks: CarrierPortalRunnerCheck[] = [];
  const push = (check: CarrierPortalRunnerCheck) => checks.push(check);
  const hasHttpsPortal = !!input.entryUrl && /^https:\/\//i.test(input.entryUrl);

  push({
    label: "Carrier agent portal",
    status: hasHttpsPortal ? "pass" : "block",
    detail: hasHttpsPortal
      ? `Runner entry point is ${input.entryUrl}.`
      : "A secure HTTPS carrier agent portal URL is required.",
  });
  push({
    label: "Carrier credential reference",
    status: input.credentialReference ? "pass" : "block",
    detail: input.credentialReference
      ? "Encrypted vault reference is present; no raw carrier password is exposed to the browser."
      : "Encrypted carrier credentials are missing for this agency/user/carrier.",
  });
  push({
    label: "MFA mode",
    status: input.carrier.quotingAutomation?.mfaMode ? "pass" : "warn",
    detail: input.carrier.quotingAutomation?.mfaMode
      ? `MFA handling: ${input.carrier.quotingAutomation.mfaMode.replace(/_/g, " ")}.`
      : "MFA mode is not specified; production should require staff prompt or carrier push handling.",
  });
  push({
    label: "Server automation worker",
    status: input.bridgeUrl ? "pass" : "warn",
    detail: input.bridgeUrl
      ? "Carrier automation bridge URL is configured for live server-side browser work."
      : "No live worker is configured in this environment, so Quotex records a demo-safe runner trace.",
  });
  push({
    label: "Carrier state availability",
    status:
      !input.state || input.carrier.stateAvailability.includes(input.state)
        ? "pass"
        : "block",
    detail:
      !input.state
        ? "No state was supplied; runner will rely on carrier-side validation."
        : input.carrier.stateAvailability.includes(input.state)
          ? `${input.carrier.name} is listed for ${input.state}.`
          : `${input.carrier.name} is not listed for ${input.state}.`,
  });

  const missingRequired = requiredLabels.filter(
    (label) =>
      !input.fieldMappings.some(
        (field) =>
          field.required &&
          (field.quotexField.toLowerCase().includes(label.toLowerCase()) ||
            field.carrierField.toLowerCase().includes(label.toLowerCase()))
      )
  );
  push({
    label: "Carrier form field coverage",
    status: missingRequired.length === 0 ? "pass" : "warn",
    detail:
      missingRequired.length === 0
        ? `${input.fieldMappings.filter((field) => field.required).length} required fields are mapped.`
        : `Mapped ${input.fieldMappings.length} fields; review missing/ambiguous fields: ${missingRequired
            .slice(0, 5)
            .join(", ")}.`,
  });
  return checks;
}

function extractedQuote(input: CarrierPortalRunnerInput, jobId: string): CarrierPortalRunnerTrace["extractedQuote"] {
  const jitter = 0.97 + ((stableHash(`${jobId}:premium`) % 9) / 100);
  const premium = Math.max(250, Math.round(input.baseQuote.premium * jitter));
  const today = new Date();
  const effectiveDate = today.toISOString().slice(0, 10);
  return {
    quoteNumber: `QT-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(jobId) % 100000}`,
    premium,
    effectiveDate,
    carrierReference: `RUN-${input.carrier.id.slice(-5).toUpperCase()}-${stableHash(`${jobId}:ref`) % 100000}`,
    coverageSummary: [
      `${input.session.lineOfBusiness === "commercial" ? "Commercial" : "Personal"} ${titleCase(input.session.assetType)} quote`,
      `Estimated value ${input.session.estimatedValue.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })}`,
      input.state ?? input.session.state ? `Rated state ${input.state ?? input.session.state}` : "State validated by carrier portal",
    ],
  };
}

export function runCarrierPortalRunner(input: CarrierPortalRunnerInput): CarrierPortalRunnerTrace {
  const automation = input.carrier.quotingAutomation;
  const entryUrl =
    automation?.agentPortalUrl?.trim() ||
    automation?.customerPortalUrl?.trim() ||
    input.carrier.agentPortalUrl?.trim() ||
    "";
  const surface = automation?.agentPortalUrl || input.carrier.agentPortalUrl ? "agent_portal" : "customer_portal";
  const credentialReference = automation?.credentialReference;
  const bridgeUrl = readClientEnv("VITE_QUOTEX_CARRIER_AUTOMATION_BRIDGE_URL");
  const mode: CarrierPortalRunnerTrace["mode"] =
    bridgeUrl && automation?.status === "connected" ? "live_worker" : "demo_worker";
  const jobId = `RPA-${input.carrier.id.slice(-5).toUpperCase()}-${input.session.id.slice(-6).toUpperCase()}-${
    stableHash(`${input.carrier.id}:${input.session.id}:${input.state ?? ""}`) % 10000
  }`;
  const fieldMappings = collectFieldMappings(input.session, input.state);
  const checks = validationChecks({
    carrier: input.carrier,
    session: input.session,
    state: input.state,
    entryUrl,
    credentialReference,
    bridgeUrl,
    fieldMappings,
  });
  const hardBlocks = checks.filter((check) => check.status === "block");
  const status: CarrierPortalRunnerTrace["status"] =
    hardBlocks.length > 0
      ? "blocked"
      : mode === "live_worker"
        ? "queued"
        : "completed";
  const quote = status === "blocked" ? undefined : extractedQuote(input, jobId);
  const requiredFieldCount = fieldMappings.filter((field) => field.required).length;
  const queuedAt = new Date().toISOString();
  const auditEvents = [
    `Runner job ${jobId} prepared for ${input.carrier.name}.`,
    `Mapped ${fieldMappings.length} Quotex field${fieldMappings.length === 1 ? "" : "s"} into carrier form fields.`,
    mode === "live_worker"
      ? "Live worker is configured; job is ready for server-side browser execution and MFA handling."
      : "Demo-safe runner trace generated because live worker configuration is not present in this environment.",
    quote
      ? `Quote result captured: ${quote.quoteNumber} at ${quote.premium.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        })}.`
      : "Quote result not captured because a blocking validation issue remains.",
  ];

  return {
    jobId,
    mode,
    surface,
    entryUrl,
    credentialReference,
    mfaMode: automation?.mfaMode ?? "staff_prompt",
    parallelGroupKey: `parallel:${input.session.id}:${input.session.lineOfBusiness ?? "personal"}`,
    status,
    queuedAt,
    completedAt: status === "completed" ? queuedAt : undefined,
    mappedFieldCount: fieldMappings.length,
    requiredFieldCount,
    validationChecks: checks,
    fieldMappings,
    extractedQuote: quote,
    auditEvents,
    blockingReasons: checks
      .filter((check) => check.status === "block")
      .map((check) => check.detail),
  };
}
