// =====================================================================
// AI service layer — provider-agnostic abstraction.
// Switch with AI_PROVIDER env var. Real keys must only live in this env.
// =====================================================================

import { provider } from "./provider.js";

const PRELIMINARY =
  "This is a preliminary AI-generated estimate. Final pricing, binding, and coverage decisions must be reviewed and approved by a licensed insurance professional. A deposit does not constitute proof of active coverage.";

export async function aiParseIntake(rawDescription: string) {
  const system =
    "You are a structured-data extractor for a private-client insurance intake. Output JSON only. Never make coverage decisions.";
  const user = `Extract the asset type and known fields from this customer description. Reply with strict JSON: { assetType, fields, confidence, followUpQuestions[] }.\n\n"""${rawDescription}"""`;
  const json = await provider.completeJson({ system, user });
  return json;
}

export async function aiPremiumEstimate(input: { assetType: string; parsedData: Record<string, unknown> }) {
  const system =
    "You produce preliminary insurance premium ranges for licensed agent review. Never claim coverage will be bound. Always include a disclaimer.";
  const user = `Given assetType=${input.assetType} and parsedData=${JSON.stringify(input.parsedData)}, return JSON: { min, max, rationale, missingDocuments[], recommendedNextSteps[], disclaimer }.`;
  const json = await provider.completeJson({ system, user });
  return { ...json, disclaimer: PRELIMINARY };
}

export async function aiCarrierMatch(
  input: { assetType: string; parsedData: Record<string, unknown> },
  carriers: { id: string; name: string; preferredAssetTypes: string[]; appetiteNotes?: string }[]
) {
  const system =
    "You rank carriers by appetite alignment. Output JSON only. Recommendation is INTERNAL ONLY and never bound.";
  const user = `Asset: ${input.assetType}\nData: ${JSON.stringify(input.parsedData)}\nCarriers: ${JSON.stringify(carriers)}\nReturn { carrierId, carrierName, score, reason, alternates[{carrierId,carrierName,score,reason}] }.`;
  return provider.completeJson({ system, user });
}

export async function aiMarketingMessage(
  prospect: { name: string; assetType: string },
  channel: "email" | "sms"
) {
  const system =
    "You write concierge-tone outreach for high-net-worth insurance prospects. Always include opt-out language for SMS and unsubscribe for email. Never make coverage claims.";
  const user = `Write a ${channel} message to ${prospect.name} about completing their ${prospect.assetType} quote. JSON: { subject?, body }.`;
  return provider.completeJson({ system, user });
}