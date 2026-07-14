import { describe, expect, it } from "vitest";
import {
  aiEvidenceAllowsAuthoritativeWrite,
  aiEvidenceAllowsDocumentAutofill,
  aiEvidenceAllowsQuestionnairePrefill,
  evaluateAiProductionGate,
  findAiPublicEvidence,
} from "../aiProductionGuards";
import type { PublicDataEvidenceMap } from "@/types";

const evidence: PublicDataEvidenceMap = {
  "Year built": {
    fieldKey: "yearBuilt",
    sourceKind: "government_api",
    sourceLabel: "County assessor",
    confidence: 0.92,
    verified: true,
    allowDocumentAutofill: true,
    collectedAt: "2026-06-22T12:00:00.000Z",
  },
  "Roof year": {
    fieldKey: "roofYear",
    sourceKind: "model_estimate",
    sourceLabel: "AI estimate",
    confidence: 0.96,
    verified: true,
    allowDocumentAutofill: true,
    collectedAt: "2026-06-22T12:00:00.000Z",
  },
  "Website": {
    fieldKey: "website",
    sourceKind: "public_web",
    sourceLabel: "Business website",
    sourceUrl: "https://example.com/business",
    confidence: 0.72,
    verified: false,
    allowDocumentAutofill: false,
    collectedAt: "2026-06-22T12:00:00.000Z",
  },
  "Pool": {
    fieldKey: "detachedStructuresAndRecreation",
    sourceKind: "imagery_vision",
    sourceLabel: "Google aerial imagery",
    sourceUrl: "https://maps.googleapis.com/maps/api/staticmap?key=redacted",
    confidence: 0.88,
    verified: false,
    allowDocumentAutofill: false,
    collectedAt: "2026-06-22T12:00:00.000Z",
  },
  "Low confidence estimate": {
    fieldKey: "lowEstimate",
    sourceKind: "model_estimate",
    sourceLabel: "AI estimate",
    confidence: 0.35,
    verified: false,
    allowDocumentAutofill: false,
    collectedAt: "2026-06-22T12:00:00.000Z",
  },
  "OpenAI uncited review answer": {
    fieldKey: "yearBuilt",
    sourceKind: "web_search",
    sourceLabel: "OpenAI public data sweep - county assessor",
    confidence: 0.78,
    verified: false,
    allowDocumentAutofill: false,
    collectedAt: "2026-06-22T12:00:00.000Z",
    notes: "Review-only questionnaire prefill from OpenAI web search.",
  },
};

describe("aiProductionGuards", () => {
  it("allows document autofill only from verified source-backed evidence", () => {
    expect(aiEvidenceAllowsDocumentAutofill(findAiPublicEvidence(evidence, "year built"))).toBe(true);
    expect(aiEvidenceAllowsAuthoritativeWrite(findAiPublicEvidence(evidence, "yearBuilt"))).toBe(true);
    expect(aiEvidenceAllowsDocumentAutofill(findAiPublicEvidence(evidence, "roof year"))).toBe(false);
  });

  it("allows cited review facts to prefill questionnaires and rejects uncited OpenAI web answers", () => {
    const webEvidence = findAiPublicEvidence(evidence, "website");
    const imageryEvidence = findAiPublicEvidence(evidence, "pool");
    const estimateEvidence = findAiPublicEvidence(evidence, "roof year");
    const weakEstimateEvidence = findAiPublicEvidence(evidence, "low confidence estimate");
    const uncitedOpenAiEvidence = findAiPublicEvidence(evidence, "OpenAI uncited review answer");
    expect(aiEvidenceAllowsQuestionnairePrefill(webEvidence)).toBe(true);
    expect(aiEvidenceAllowsDocumentAutofill(webEvidence)).toBe(false);
    expect(aiEvidenceAllowsQuestionnairePrefill(imageryEvidence)).toBe(true);
    expect(aiEvidenceAllowsDocumentAutofill(imageryEvidence)).toBe(false);
    expect(aiEvidenceAllowsQuestionnairePrefill(uncitedOpenAiEvidence)).toBe(false);
    expect(aiEvidenceAllowsDocumentAutofill(uncitedOpenAiEvidence)).toBe(false);
    expect(aiEvidenceAllowsQuestionnairePrefill(estimateEvidence)).toBe(false);
    expect(aiEvidenceAllowsDocumentAutofill(estimateEvidence)).toBe(false);
    expect(aiEvidenceAllowsQuestionnairePrefill(weakEstimateEvidence)).toBe(false);
  });

  it("blocks unapproved outbound AI marketing sends", () => {
    const blocked = evaluateAiProductionGate({
      system: "marketing_ai",
      action: "launch_campaign",
      tenantScoped: true,
      sendsOutboundMessage: true,
      writesSystemOfRecord: true,
      usesOnlyProvidedFacts: true,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedReasons).toContain("outbound_message_requires_human_approval");
  });

  it("keeps custom AI sort read-only", () => {
    const blocked = evaluateAiProductionGate({
      system: "custom_sort",
      action: "normalize_query",
      tenantScoped: true,
      writesSystemOfRecord: true,
      usesOnlyProvidedFacts: true,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedReasons).toContain("custom_sort_must_remain_read_only");
  });

  it("blocks live carrier runner work without external-action approval", () => {
    const blocked = evaluateAiProductionGate({
      system: "carrier_portal_runner",
      action: "agent_portal",
      tenantScoped: true,
      touchesExternalSystem: true,
      evidenceCount: 3,
      verifiedEvidenceCount: 3,
      usesOnlyProvidedFacts: true,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedReasons).toContain("external_action_requires_human_approval");
  });
});
