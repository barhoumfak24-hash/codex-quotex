import type {
  PublicDataEvidenceMap,
  PublicDataFieldEvidence,
  PublicDataFieldSourceKind,
} from "@/types";

export type AiProductionSystemKey =
  | "agency_data_import"
  | "document_autofill"
  | "public_data_sweep"
  | "carrier_portal_runner"
  | "quote_pricing"
  | "custom_sort"
  | "portal_assistant"
  | "marketing_ai";

export interface AiProductionGateInput {
  system: AiProductionSystemKey;
  action: string;
  tenantScoped?: boolean;
  confidence?: number;
  evidenceCount?: number;
  verifiedEvidenceCount?: number;
  humanReviewed?: boolean;
  humanApproved?: boolean;
  writesDocument?: boolean;
  writesSystemOfRecord?: boolean;
  sendsOutboundMessage?: boolean;
  touchesExternalSystem?: boolean;
  usesOnlyProvidedFacts?: boolean;
}

export interface AiProductionGateDecision {
  allowed: boolean;
  requiresHumanReview: boolean;
  blockedReasons: string[];
  warnings: string[];
  auditLabel: string;
}

export const AI_DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR = 0.8;
export const AI_AUTHORITATIVE_WRITE_CONFIDENCE_FLOOR = 0.85;
export const AI_QUESTIONNAIRE_PREFILL_CONFIDENCE_FLOOR = 0.55;

const UNSAFE_DOCUMENT_SOURCE_KINDS = new Set<PublicDataFieldSourceKind>([
  "model_estimate",
  "public_web",
  "imagery_vision",
  "unknown",
]);

const UNSAFE_QUESTIONNAIRE_PREFILL_SOURCE_KINDS = new Set<PublicDataFieldSourceKind>([
  "model_estimate",
  "unknown",
]);

export function normalizeAiEvidenceKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findAiPublicEvidence(
  evidence: PublicDataEvidenceMap | undefined,
  fieldKey: string
): PublicDataFieldEvidence | undefined {
  if (!evidence) return undefined;
  const normalizedFieldKey = normalizeAiEvidenceKey(fieldKey);
  const compactFieldKey = normalizedFieldKey.replace(/\s+/g, "");
  if (!normalizedFieldKey) return undefined;
  const matches = Object.entries(evidence)
    .map(([key, item]) => {
      const normalizedKey = normalizeAiEvidenceKey(key);
      const normalizedItemKey = normalizeAiEvidenceKey(item.fieldKey);
      const compactKey = normalizedKey.replace(/\s+/g, "");
      const compactItemKey = normalizedItemKey.replace(/\s+/g, "");
      const exact =
        normalizedKey === normalizedFieldKey ||
        normalizedItemKey === normalizedFieldKey;
      const compact = compactKey === compactFieldKey || compactItemKey === compactFieldKey;
      if (!exact && !compact) return null;
      return { exact, item };
    })
    .filter((match): match is { exact: boolean; item: PublicDataFieldEvidence } => Boolean(match));
  if (matches.length === 0) return undefined;
  return matches.sort((left, right) => {
    const leftSourceBacked = left.item.sourceKind !== "model_estimate" && left.item.sourceKind !== "unknown";
    const rightSourceBacked = right.item.sourceKind !== "model_estimate" && right.item.sourceKind !== "unknown";
    if (leftSourceBacked !== rightSourceBacked) return leftSourceBacked ? -1 : 1;
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    if (left.item.verified !== right.item.verified) return left.item.verified ? -1 : 1;
    return right.item.confidence - left.item.confidence;
  })[0]?.item;
}

export function aiEvidenceAllowsDocumentAutofill(
  item?: PublicDataFieldEvidence
): boolean {
  if (!item) return false;
  if (UNSAFE_DOCUMENT_SOURCE_KINDS.has(item.sourceKind)) return false;
  return (
    item.allowDocumentAutofill &&
    item.verified &&
    item.confidence >= AI_DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR
  );
}

export function aiEvidenceAllowsQuestionnairePrefill(
  item?: PublicDataFieldEvidence
): boolean {
  if (!item) return true;
  if (UNSAFE_QUESTIONNAIRE_PREFILL_SOURCE_KINDS.has(item.sourceKind)) return false;
  if (
    (item.sourceKind === "web_search" || item.sourceKind === "public_web") &&
    !evidenceHasCitationUrl(item)
  ) {
    return false;
  }
  if (item.sourceKind === "imagery_vision") {
    return item.confidence >= 0.65 && evidenceHasCitationUrl(item);
  }
  if (item.confidence < AI_QUESTIONNAIRE_PREFILL_CONFIDENCE_FLOOR) return false;
  return (
    item.verified ||
    item.sourceKind === "public_web" ||
    item.sourceKind === "web_search" ||
    item.sourceKind === "public_geocoder" ||
    item.sourceKind === "government_api" ||
    item.sourceKind === "commercial_provider"
  );
}

function evidenceHasCitationUrl(item: PublicDataFieldEvidence): boolean {
  if (urlLooksLikeHttpCitation(item.sourceUrl)) return true;
  return /\bsource url:\s*https?:\/\//i.test(item.notes ?? "");
}

function urlLooksLikeHttpCitation(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function aiEvidenceAllowsAuthoritativeWrite(
  item?: PublicDataFieldEvidence
): boolean {
  if (!item) return false;
  return (
    aiEvidenceAllowsDocumentAutofill(item) &&
    item.confidence >= AI_AUTHORITATIVE_WRITE_CONFIDENCE_FLOOR
  );
}

export function publicFieldIsSafeForDocument(
  publicFields: Record<string, unknown> | undefined,
  evidence: PublicDataEvidenceMap | undefined,
  label: string
): boolean {
  const raw = publicFields?.[label];
  const hasValue =
    raw !== null &&
    raw !== undefined &&
    String(raw).trim().length > 0;
  return hasValue && aiEvidenceAllowsDocumentAutofill(findAiPublicEvidence(evidence, label));
}

export function evaluateAiProductionGate(
  input: AiProductionGateInput
): AiProductionGateDecision {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  let requiresHumanReview = false;
  const confidence = Number.isFinite(input.confidence) ? input.confidence! : undefined;
  const verifiedEvidenceCount = Math.max(0, input.verifiedEvidenceCount ?? 0);
  const evidenceCount = Math.max(verifiedEvidenceCount, input.evidenceCount ?? 0);

  if (input.tenantScoped === false) {
    blockedReasons.push("tenant_scope_missing");
  }

  if (input.usesOnlyProvidedFacts === false) {
    blockedReasons.push("unbounded_ai_facts");
  }

  if (input.touchesExternalSystem && !input.humanApproved) {
    blockedReasons.push("external_action_requires_human_approval");
  }

  if (input.sendsOutboundMessage && !input.humanApproved) {
    blockedReasons.push("outbound_message_requires_human_approval");
  }

  if (input.writesDocument && verifiedEvidenceCount === 0 && !input.humanReviewed) {
    blockedReasons.push("document_write_requires_verified_evidence_or_review");
  }

  if (input.writesSystemOfRecord && !input.humanReviewed) {
    requiresHumanReview = true;
    warnings.push("system_record_write_requires_review");
  }

  if (
    confidence !== undefined &&
    confidence < AI_DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR &&
    (input.writesDocument || input.writesSystemOfRecord)
  ) {
    requiresHumanReview = true;
    warnings.push("low_confidence_output_requires_review");
  }

  switch (input.system) {
    case "agency_data_import":
      if (!input.humanReviewed) {
        requiresHumanReview = true;
        warnings.push("agency_import_is_review_queue_only");
      }
      break;
    case "carrier_portal_runner":
      if (input.touchesExternalSystem && (evidenceCount === 0 || verifiedEvidenceCount === 0)) {
        blockedReasons.push("carrier_runner_requires_verified_mapping_evidence");
      }
      break;
    case "document_autofill":
      if (verifiedEvidenceCount === 0 && !input.humanReviewed) {
        blockedReasons.push("document_autofill_requires_source_backed_fields");
      }
      break;
    case "quote_pricing":
      if (evidenceCount === 0) {
        warnings.push("pricing_is_preliminary_without_carrier_source");
      }
      break;
    case "marketing_ai":
      if (!input.humanApproved) {
        requiresHumanReview = true;
        warnings.push("marketing_send_requires_approval");
      }
      break;
    case "portal_assistant":
      if (input.writesSystemOfRecord && !input.humanApproved) {
        blockedReasons.push("assistant_mutation_requires_confirmation");
      }
      break;
    case "custom_sort":
      if (input.writesSystemOfRecord || input.sendsOutboundMessage || input.touchesExternalSystem) {
        blockedReasons.push("custom_sort_must_remain_read_only");
      }
      break;
    case "public_data_sweep":
      if (confidence !== undefined && confidence < AI_DOCUMENT_AUTOFILL_CONFIDENCE_FLOOR) {
        warnings.push("public_sweep_value_is_estimate_only");
      }
      break;
  }

  return {
    allowed: blockedReasons.length === 0 && !requiresHumanReview,
    requiresHumanReview,
    blockedReasons,
    warnings,
    auditLabel: `${input.system}:${input.action}`,
  };
}
