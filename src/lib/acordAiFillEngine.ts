import type {
  Agency,
  Asset,
  Carrier,
  Claim,
  Communication,
  CommunicationAttachment,
  CustomerProfile,
  Document,
  DocumentTemplateFieldBox,
  Note,
  Policy,
  Prospect,
  QuotingQuestion,
  QuotingSession,
  TemplateFieldMap,
} from "@/types";
import {
  buildAcordFilledFieldsForTemplate,
  type AcordMappedField,
  type AcordTemplateLike,
} from "./acordQuestionnaires";
import {
  aiEvidenceAllowsDocumentAutofill,
  findAiPublicEvidence,
} from "./aiProductionGuards";

type AcordFillSource =
  | "questionnaire"
  | "public_record"
  | "asset_detail"
  | "contact"
  | "system";

type CandidateKind =
  | "agency_name"
  | "agency_address"
  | "agency_phone"
  | "agency_email"
  | "agency_fax"
  | "agency_website"
  | "agency_customer_id"
  | "agency_contact_name"
  | "insured_name"
  | "insured_mailing_address"
  | "insured_name_address"
  | "insured_phone"
  | "insured_email"
  | "insured_fax"
  | "business_website"
  | "entity_type"
  | "years_in_business"
  | "secondary_email"
  | "secondary_phone"
  | "property_address"
  | "property_detail"
  | "carrier_name"
  | "policy_number"
  | "effective_date"
  | "expiration_date"
  | "policy_term"
  | "premium"
  | "coverage"
  | "deductible"
  | "revenue"
  | "payroll"
  | "fein"
  | "state"
  | "operations"
  | "loss_history"
  | "remarks"
  | "vehicle"
  | "document_summary"
  | "generic";

type CandidateValue = {
  label: string;
  value: string;
  source: AcordFillSource;
  confidence: number;
  kind: CandidateKind;
};

export type AcordAiFillDossier = {
  agency?: Agency;
  contact?: CustomerProfile | Prospect | null;
  assets: Asset[];
  policies: Policy[];
  carriers: Carrier[];
  claims: Claim[];
  documents: Document[];
  notes: Note[];
  communications: Communication[];
  session: QuotingSession;
  questions: QuotingQuestion[];
  responses: Record<string, string>;
  templateDocument?: Document;
};

export type AcordAiFillResult = {
  fields: TemplateFieldMap;
  mappings: NonNullable<CommunicationAttachment["fieldMappings"]>;
  missingFieldLabels: string[];
  audit: {
    sourceCount: number;
    candidateCount: number;
    fittedFieldCount: number;
    overflowFieldCount: number;
    sourcesUsed: string[];
    sourceFieldCounts: Record<AcordFillSource, number>;
  };
};

const SYSTEM_META_FIELDS = new Set([
  "ACORD form number",
  "Form name",
  "Line / category",
  "Typical use",
  "Source file",
  "Bundled PDF",
  "Agency action",
  "Source ACORD template ID",
  "Source ACORD file",
  "Source ACORD layout fields",
  "Completed packet type",
  "Completed by",
  "Completed field count",
  "Missing field count",
  "Missing fields",
  "AI dossier source count",
  "AI candidate field count",
  "AI fitted PDF field count",
  "AI overflow field count",
  "AI sources used",
  "AI source field counts",
  "ACORD PDF fill status",
  "Last filled at",
]);

export function fillAcordFromClientDossier(input: {
  template: AcordTemplateLike;
  dossier: AcordAiFillDossier;
  layout?: DocumentTemplateFieldBox[];
  kind: "application" | "supplemental";
}): AcordAiFillResult {
  const candidates = buildClientDossierCandidates(input.dossier);
  const baseline = buildAcordFilledFieldsForTemplate(input.template, {
    contactName: input.dossier.contact?.name,
    agencyName: input.dossier.agency?.name,
    estimatedValue: input.dossier.session.estimatedValue,
    state: input.dossier.session.state,
    publicFields: input.dossier.session.publicFields,
    publicFieldEvidence: input.dossier.session.publicFieldEvidence,
    assetDetails: input.dossier.session.assetDetails,
    responses: input.dossier.responses,
  });
  const safeBaselineFields = filterUnsafeBaselineFields(baseline.fields, input.dossier);
  const safeBaselineMappings = baseline.mappings.filter((mapping) =>
    canUseResolvedFieldValue(mapping.targetField, mapping.source, input.dossier)
  );
  const fields: TemplateFieldMap = {
    ...stripSystemTemplateFields(input.dossier.templateDocument?.templateFields),
    ...safeBaselineFields,
    ...canonicalCandidateFields(candidates),
  };

  const mappings: AcordMappedField[] = [...safeBaselineMappings];
  const overflow: string[] = [];
  let fittedFieldCount = 0;
  const layout = input.layout ?? [];
  layout.forEach((box) => {
    const candidate = bestCandidateForField(box.label, candidates);
    if (!candidate) return;
    const fit = fitValueForAcordBox(candidate.value, box);
    fields[box.label] = fit.value;
    if (fit.overflow) overflow.push(`${box.label}: ${fit.overflow}`);
    fittedFieldCount += 1;
    mappings.push({
      sourceLabel: candidate.label,
      targetField: box.label,
      value: fit.value,
      source: candidate.source,
    });
  });

  const missingFieldLabels = missingLabelsForLayout(layout, fields, baseline.missingFieldLabels);
  const dedupedMappings = dedupeMappings(mappings);
  const sourceFieldCounts = dedupedMappings.reduce<Record<AcordFillSource, number>>(
    (counts, mapping) => {
      counts[mapping.source] += 1;
      return counts;
    },
    {
      questionnaire: 0,
      public_record: 0,
      asset_detail: 0,
      contact: 0,
      system: 0,
    }
  );
  return {
    fields,
    mappings: dedupedMappings,
    missingFieldLabels,
    audit: {
      sourceCount: input.dossier.assets.length +
        input.dossier.policies.length +
        input.dossier.claims.length +
        input.dossier.documents.length +
        input.dossier.notes.length +
        input.dossier.communications.length +
        4,
      candidateCount: candidates.length,
      fittedFieldCount,
      overflowFieldCount: overflow.length,
      sourcesUsed: Array.from(new Set(dedupedMappings.map((mapping) => mapping.source))),
      sourceFieldCounts,
    },
  };
}

function buildClientDossierCandidates(dossier: AcordAiFillDossier): CandidateValue[] {
  const candidates: CandidateValue[] = [];
  const add = (
    label: string,
    value: unknown,
    source: AcordFillSource,
    confidence = 0.7,
    kind?: CandidateKind
  ) => {
    const text = stringifyValue(value);
    if (!text) return;
    candidates.push({ label, value: text, source, confidence, kind: kind ?? inferCandidateKind(label, source) });
  };
  const contact = dossier.contact;
  const customer = contact && "userId" in contact ? contact : undefined;
  const customerCode = customer?.clientCode ?? customer?.id;
  const mailingAddress = customer?.mailingAddress;
  const garagingAddress = customer?.garagingAddress;
  const insuredName = customer?.businessName ?? contact?.name;
  const insuredNameAndAddress = [insuredName, mailingAddress].filter(Boolean).join("\n");
  add("Agency", dossier.agency?.name, "system", 0.98, "agency_name");
  add("Agency name", dossier.agency?.name, "system", 0.98, "agency_name");
  add("Producer", dossier.agency?.name, "system", 0.98, "agency_name");
  add("Producer name", dossier.agency?.name, "system", 0.98, "agency_name");
  add("Agency address", dossier.agency?.address, "system", 0.96, "agency_address");
  add("Producer address", dossier.agency?.address, "system", 0.96, "agency_address");
  add("Agency phone", dossier.agency?.phone, "system", 0.96, "agency_phone");
  add("Producer phone", dossier.agency?.phone, "system", 0.96, "agency_phone");
  add("Agency email", dossier.agency?.contactEmail, "system", 0.96, "agency_email");
  add("Producer email", dossier.agency?.contactEmail, "system", 0.96, "agency_email");
  add("Agency website", dossier.agency?.website, "system", 0.92, "agency_website");
  add("Applicant name", contact?.name, "contact", 0.96, "insured_name");
  add("Client name", contact?.name, "contact", 0.96, "insured_name");
  add("Applicant name and mailing address", insuredNameAndAddress, "contact", 0.96, "insured_name_address");
  add("Named insured", insuredName, "contact", 0.96, "insured_name");
  add("Name insured", insuredName, "contact", 0.96, "insured_name");
  add("Insured", insuredName, "contact", 0.96, "insured_name");
  add("Insured name", insuredName, "contact", 0.96, "insured_name");
  add("First named insured", insuredName, "contact", 0.95, "insured_name");
  add("Named insured and mailing address", insuredNameAndAddress, "contact", 0.95, "insured_name_address");
  add("Insured name and address", insuredNameAndAddress, "contact", 0.95, "insured_name_address");
  add("Business legal name", insuredName, "contact", 0.95, "insured_name");
  add("Legal business name", insuredName, "contact", 0.95, "insured_name");
  add("Agency customer ID", customerCode, "contact", 0.86, "agency_customer_id");
  add("Customer number", customerCode, "contact", 0.86, "agency_customer_id");
  add("Primary contact", contact?.name, "contact", 0.92, "insured_name");
  add("Phone", contact?.phone, "contact", 0.92, "insured_phone");
  add("Applicant phone", contact?.phone, "contact", 0.92, "insured_phone");
  add("Insured phone", contact?.phone, "contact", 0.92, "insured_phone");
  add("Email", contact?.email, "contact", 0.92, "insured_email");
  add("Contact email", contact?.email, "contact", 0.92, "insured_email");
  add("Applicant email", contact?.email, "contact", 0.92, "insured_email");
  add("Insured email", contact?.email, "contact", 0.92, "insured_email");
  add("Mailing address", mailingAddress, "contact", 0.9, "insured_mailing_address");
  add("Insured mailing address", mailingAddress, "contact", 0.9, "insured_mailing_address");
  add("Client address", mailingAddress, "contact", 0.9, "insured_mailing_address");
  add("Garaging address", garagingAddress, "contact", 0.88, "property_address");
  add("Description of operations", customer?.operationsDescription, "contact", 0.88, "operations");
  add("Business operations", customer?.operationsDescription, "contact", 0.88, "operations");

  Object.entries(dossier.session.publicFields ?? {}).forEach(([key, value]) => {
    if (!fieldEvidenceAllowsDocumentUse(key, dossier.session.publicFieldEvidence, "public_record")) return;
    add(key, value, "public_record", 0.84);
  });
  Object.entries(dossier.session.assetDetails ?? {}).forEach(([key, value]) => {
    if (!fieldEvidenceAllowsDocumentUse(key, dossier.session.publicFieldEvidence, "asset_detail")) return;
    add(key, value, "asset_detail", 0.88);
  });
  dossier.questions.forEach((question) => {
    const value = dossier.responses[question.id];
    if (!value) return;
    const fieldLabels = question.acordFieldLabels ?? [];
    if (fieldLabels.length <= 1) {
      add(question.label, value, "questionnaire", 0.96);
      fieldLabels.forEach((fieldLabel) => add(fieldLabel, value, "questionnaire", 0.98));
    } else if (questionTargetsCarrySameValue(fieldLabels) && !looksLikeUngroundedCompositeAnswer(value)) {
      const mapped = mapCompositeQuestionnaireValueToFields(value, fieldLabels);
      mapped.forEach(({ fieldLabel, fieldValue }) =>
        add(fieldLabel, fieldValue, "questionnaire", 0.98)
      );
    } else {
      const mapped = mapCompositeQuestionnaireValueToFields(
        value,
        fieldLabels
      );
      mapped.forEach(({ fieldLabel, fieldValue }) =>
        add(fieldLabel, fieldValue, "questionnaire", 0.98)
      );
    }
  });

  add("Estimated exposure value", formatMoney(dossier.session.estimatedValue), "system", 0.76);
  add("State", dossier.session.state, "system", 0.85);

  dossier.assets.forEach((asset) => {
    const assetAddress =
      asset.details.address ??
      asset.details.propertyAddress ??
      asset.details.riskAddress ??
      asset.details.location;
    add("Asset name", asset.label, "asset_detail", 0.82, "property_detail");
    add("Location", assetAddress, "asset_detail", 0.86, "property_address");
    add("Premises address", assetAddress, "asset_detail", 0.86, "property_address");
    add("Premises", assetAddress, "asset_detail", 0.82, "property_address");
    add("Risk address", assetAddress, "asset_detail", 0.86, "property_address");
    add("Stated value", formatMoney(asset.estimatedValue), "asset_detail", 0.82, "premium");
    add("Property address", assetAddress, "asset_detail", 0.86, "property_address");
    add("Risk / property address", assetAddress, "asset_detail", 0.86, "property_address");
    Object.entries(asset.details).forEach(([key, value]) => add(key, value, "asset_detail", 0.82));
  });

  dossier.policies.forEach((policy) => {
    const carrier = dossier.carriers.find((candidate) => candidate.id === policy.carrierId);
    const policyTerm = [
      policy.policyNumber ? `Policy #${policy.policyNumber}` : undefined,
      policy.effectiveDate ? `Effective ${formatDate(policy.effectiveDate)}` : undefined,
      policy.renewalDate ? `Expires ${formatDate(policy.renewalDate)}` : undefined,
    ].filter(Boolean).join("; ");
    add("Carrier", carrier?.name, "system", 0.82, "carrier_name");
    add("Insurance carrier", carrier?.name, "system", 0.82, "carrier_name");
    add("Company", carrier?.name, "system", 0.78, "carrier_name");
    add("Prior carrier", carrier?.name, "system", 0.78, "carrier_name");
    add("Policy number", policy.policyNumber, "system", 0.9, "policy_number");
    add("Policy no", policy.policyNumber, "system", 0.9, "policy_number");
    add("Policy #", policy.policyNumber, "system", 0.9, "policy_number");
    add("Current policy number", policy.policyNumber, "system", 0.88, "policy_number");
    add("Expiring policy number", policy.policyNumber, "system", 0.86, "policy_number");
    add("Effective date", formatDate(policy.effectiveDate), "system", 0.86, "effective_date");
    add("Policy effective date", formatDate(policy.effectiveDate), "system", 0.86, "effective_date");
    add("Eff date", formatDate(policy.effectiveDate), "system", 0.84, "effective_date");
    add("Expiration date", formatDate(policy.renewalDate), "system", 0.86, "expiration_date");
    add("Policy expiration date", formatDate(policy.renewalDate), "system", 0.86, "expiration_date");
    add("Exp date", formatDate(policy.renewalDate), "system", 0.84, "expiration_date");
    add("Policy term", policyTerm, "system", 0.84, "policy_term");
    add(
      "Premium",
      policy.finalPremium || policy.premiumEstimate
        ? formatMoney(policy.finalPremium ?? policy.premiumEstimate ?? 0)
        : undefined,
      "system",
      0.8,
      "premium"
    );
    policy.coverages?.forEach((coverage) => {
      add(coverage.name, coverage.limit ? formatMoney(coverage.limit) : coverage.description, "system", 0.78, "coverage");
      if (/general liability/i.test(coverage.name)) {
        add("General liability limit", coverage.limit ? formatMoney(coverage.limit) : undefined, "system", 0.82, "coverage");
      }
      if (/auto/i.test(coverage.name)) {
        add("Automobile liability limit", coverage.limit ? formatMoney(coverage.limit) : undefined, "system", 0.82, "coverage");
      }
      if (/umbrella/i.test(coverage.name)) {
        add("Umbrella limit", coverage.limit ? formatMoney(coverage.limit) : undefined, "system", 0.82, "coverage");
      }
      if (/property|building/i.test(coverage.name)) {
        add("Coverage amount", coverage.limit ? formatMoney(coverage.limit) : undefined, "system", 0.8, "coverage");
      }
      if (coverage.deductible) add("Deductible", formatMoney(coverage.deductible), "system", 0.8, "deductible");
    });
    policy.participants?.forEach((participant) => {
      if (participant.participantType === "driver") add("Driver schedule", participantSummary(participant), "system", 0.74);
      if (participant.participantType === "operations_contact") add("Primary contact", participantSummary(participant), "system", 0.76);
    });
    policy.additionalInsureds?.forEach((party) => {
      if (party.holderType === "certificate_holder") add("Certificate holder", partySummary(party), "system", 0.82);
      if (party.holderType === "mortgagee" || party.holderType === "lienholder") {
        add("Mortgagee / lienholder", partySummary(party), "system", 0.82);
      }
      add("Additional interest name", partySummary(party), "system", 0.72);
    });
    policy.beneficiaries?.forEach((party) => add("Beneficiary", partySummary(party), "system", 0.68));
  });

  const lossSummary = dossier.claims
    .map((claim) => {
      const carrier = dossier.carriers.find((candidate) => candidate.id === claim.carrierId);
      return [
        formatDate(claim.openedAt),
        carrier?.name,
        claim.externalClaimNumber,
        claim.lossDescription,
        claim.lossAmountUsd ? formatMoney(claim.lossAmountUsd) : undefined,
        claim.status,
      ].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .join("; ");
  if (lossSummary) {
    add("Loss history", lossSummary, "system", 0.86, "loss_history");
    add("Claims history", lossSummary, "system", 0.86, "loss_history");
    add("Prior losses", lossSummary, "system", 0.86, "loss_history");
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function fieldEvidenceAllowsDocumentUse(
  fieldKey: string,
  evidence: QuotingSession["publicFieldEvidence"],
  source: "asset_detail" | "public_record"
): boolean {
  const match = findAiPublicEvidence(evidence, fieldKey);
  if (!match) return source !== "public_record";
  return aiEvidenceAllowsDocumentAutofill(match);
}

function bestCandidateForField(label: string, candidates: CandidateValue[]): CandidateValue | null {
  const normalizedLabel = normalize(label);
  const compatibleCandidates = candidates.filter((candidate) => isCandidateEligibleForField(label, candidate));
  if (requiresDirectQuestionnaireResponse(label)) {
    return compatibleCandidates.find((candidate) => isDirectQuestionnaireMatch(label, candidate)) ?? null;
  }
  const exact = compatibleCandidates.find((candidate) => normalize(candidate.label) === normalizedLabel);
  if (exact) return exact;
  const aliasSet = aliasesForField(label).map(normalize);
  const alias = compatibleCandidates.find((candidate) => aliasSet.includes(normalize(candidate.label)));
  if (alias) return alias;
  if (requiresExactOrAliasMatch(normalizedLabel) || !canUseFuzzyMatch(normalizedLabel)) return null;
  const fuzzy = compatibleCandidates.find((candidate) => {
    const normalizedCandidate = normalize(candidate.label);
    return normalizedCandidate.includes(normalizedLabel) || normalizedLabel.includes(normalizedCandidate);
  });
  return fuzzy ?? null;
}

function canonicalCandidateFields(candidates: CandidateValue[]): TemplateFieldMap {
  const fields: TemplateFieldMap = {};
  const set = (label: string, value: string) => {
    if (!fields[label]) fields[label] = value;
  };
  candidates.forEach((candidate) => {
    if (!isCandidateEligibleForCanonicalField(candidate)) return;
    const value = candidate.value;
    switch (candidate.kind) {
      case "agency_name":
        set(candidate.label, value);
        set("Agency", value);
        set("Agency name", value);
        set("Producer", value);
        set("Producer name", value);
        break;
      case "agency_address":
        set(candidate.label, value);
        set("Agency address", value);
        set("Producer address", value);
        break;
      case "agency_phone":
        set(candidate.label, value);
        set("Agency phone", value);
        set("Producer phone", value);
        break;
      case "agency_email":
        set(candidate.label, value);
        set("Agency email", value);
        set("Producer email", value);
        break;
      case "agency_website":
        set(candidate.label, value);
        set("Agency website", value);
        set("Producer website", value);
        break;
      case "agency_customer_id":
        set(candidate.label, value);
        set("Agency customer ID", value);
        set("Customer number", value);
        break;
      case "agency_contact_name":
        set(candidate.label, value);
        set("Producer contact", value);
        set("Producer contact name", value);
        set("Agency contact", value);
        break;
      case "insured_name":
        set(candidate.label, value);
        set("Applicant name", value);
        set("Client name", value);
        set("Named insured", value);
        set("Insured", value);
        set("Business legal name", value);
        set("Legal business name", value);
        break;
      case "insured_mailing_address":
        set(candidate.label, value);
        set("Mailing address", value);
        set("Insured mailing address", value);
        set("Client address", value);
        break;
      case "insured_phone":
        set(candidate.label, value);
        set("Phone", value);
        set("Applicant phone", value);
        set("Insured phone", value);
        break;
      case "insured_email":
        set(candidate.label, value);
        set("Email", value);
        set("Contact email", value);
        set("Applicant email", value);
        set("Insured email", value);
        break;
      case "agency_fax":
      case "insured_fax":
      case "secondary_email":
      case "secondary_phone":
      case "business_website":
      case "entity_type":
      case "years_in_business":
      case "property_address":
      case "property_detail":
      case "carrier_name":
      case "policy_number":
      case "effective_date":
      case "expiration_date":
      case "policy_term":
      case "premium":
      case "coverage":
      case "deductible":
      case "revenue":
      case "payroll":
      case "fein":
      case "state":
      case "operations":
      case "vehicle":
        set(candidate.label, value);
        break;
      case "insured_name_address":
      case "loss_history":
      case "remarks":
      case "document_summary":
      case "generic":
        break;
    }
  });
  return fields;
}

function aliasesForField(label: string): string[] {
  const normalized = normalize(label);
  if (normalized.includes("fax")) {
    return ["Fax", "Agency fax", "Producer fax", "Contact fax", "Applicant fax", "Insured fax"];
  }
  if (normalized.includes("secondary") || normalized.includes("alternate")) {
    if (normalized.includes("email")) return ["Secondary email", "Alternate email"];
    if (normalized.includes("phone")) return ["Secondary phone", "Alternate phone"];
    return [];
  }
  if (
    normalized.includes("client name") ||
    normalized.includes("applicant") ||
    normalized.includes("named insured") ||
    normalized.includes("name insured") ||
    normalized.includes("insured name") ||
    normalized === "insured" ||
    normalized.endsWith(" insured")
  ) {
    if (normalized.includes("address")) {
      return [
        "Applicant name and mailing address",
        "Named insured and mailing address",
        "Insured name and address",
        "Applicant name",
        "Named insured",
        "Name insured",
        "Insured name",
        "Insured",
        "Legal business name",
        "Business legal name",
      ];
    }
    return [
      "Applicant name",
      "Named insured",
      "Name insured",
      "Insured name",
      "Insured",
      "Legal business name",
      "Business legal name",
      "Primary contact",
    ];
  }
  if (normalized.includes("business legal name")) {
    return ["Legal business name", "Business legal name", "Named insured", "Applicant name"];
  }
  if (normalized.includes("agency")) {
    if (normalized.includes("address")) return ["Agency address", "Producer address"];
    if (normalized.includes("phone")) return ["Agency phone", "Producer phone"];
    if (normalized.includes("email")) return ["Agency email", "Producer email"];
    if (normalized.includes("website")) return ["Agency website"];
    if (normalized.includes("customer") || normalized.includes("code")) return ["Agency customer ID", "Customer number"];
    return ["Agency", "Agency name", "Producer", "Producer name"];
  }
  if (normalized.includes("producer")) {
    if (normalized.includes("address")) return ["Producer address", "Agency address"];
    if (normalized.includes("phone")) return ["Producer phone", "Agency phone"];
    if (normalized.includes("email")) return ["Producer email", "Agency email"];
    if (normalized.includes("website")) return ["Agency website"];
    if (normalized.includes("contact")) return ["Producer contact"];
    return ["Producer", "Producer name", "Agency", "Agency name"];
  }
  if (normalized.includes("description of operations")) return ["Description of operations", "Business operations", "Operations", "Products / services"];
  if (normalized.includes("remark") || normalized.includes("explanation")) {
    return ["Additional remarks", "Remarks"];
  }
  if (normalized.includes("loss history")) return ["Loss history", "Claims history", "Prior losses"];
  if (normalized.includes("property address") || normalized.includes("risk property")) {
    return ["Property address", "Risk / property address", "Location", "Locations", "Garaging address"];
  }
  if (normalized.includes("mailing address") || normalized.includes("client address")) {
    return ["Mailing address", "Insured mailing address", "Client address", "Named insured and mailing address", "Applicant name and mailing address"];
  }
  if (normalized.includes("phone")) return ["Phone", "Applicant phone", "Insured phone", "Agency phone", "Producer phone"];
  if (normalized.includes("email")) return ["Contact email", "Email", "Applicant email", "Insured email", "Agency email", "Producer email"];
  if (normalized.includes("annual revenue")) return ["Annual revenue", "Revenue", "Commercial exposures"];
  if (normalized.includes("annual payroll")) return ["Annual payroll", "Payroll", "Commercial exposures"];
  if (normalized.includes("carrier")) return ["Carrier", "Prior carrier"];
  if (normalized.includes("fein") || normalized.includes("federal ein") || normalized.includes("tax identifier")) {
    return ["FEIN", "Federal EIN", "Tax identifier", "Federal employer ID"];
  }
  if (normalized.includes("policy") && (normalized.includes("number") || normalized.includes("no"))) {
    return ["Policy number", "Policy no", "Policy #", "Current policy number", "Expiring policy number"];
  }
  if (normalized.includes("effective") || normalized.includes("eff date")) {
    return ["Effective date", "Policy effective date", "Eff date"];
  }
  if (normalized.includes("expiration") || normalized.includes("exp date")) {
    return ["Expiration date", "Policy expiration date", "Exp date"];
  }
  if (normalized.includes("policy term")) return ["Policy term", "Effective date", "Expiration date", "Policy number"];
  if (normalized.includes("premium")) return ["Premium", "Estimated exposure value"];
  return [];
}

function requiresExactOrAliasMatch(normalizedLabel: string): boolean {
  return (
    normalizedLabel.includes("fax") ||
    normalizedLabel.includes("secondary") ||
    normalizedLabel.includes("alternate") ||
    normalizedLabel.includes("email") ||
    normalizedLabel.includes("phone") ||
    normalizedLabel.includes("address") ||
    normalizedLabel.includes("name") ||
    normalizedLabel.includes("insured") ||
    normalizedLabel.includes("applicant") ||
    normalizedLabel.includes("agency") ||
    normalizedLabel.includes("producer") ||
    normalizedLabel.includes("carrier") ||
    normalizedLabel.includes("policy") ||
    normalizedLabel.includes("code")
  );
}

function inferCandidateKind(label: string, source: AcordFillSource): CandidateKind {
  const normalized = normalize(label);
  const agencyOrProducer = hasAny(normalized, ["agency", "producer"]);
  const insuredOrApplicant = hasAny(normalized, ["insured", "applicant", "client", "contact", "named insured"]);

  if (normalized.includes("fax")) return agencyOrProducer ? "agency_fax" : "insured_fax";
  if (hasAny(normalized, ["secondary email", "alternate email"])) return "secondary_email";
  if (hasAny(normalized, ["secondary phone", "alternate phone"])) return "secondary_phone";
  if (hasAny(normalized, ["customer id", "customer number", "account number", "agency customer"])) {
    return "agency_customer_id";
  }
  if (agencyOrProducer) {
    if (normalized.includes("address")) return "agency_address";
    if (normalized.includes("phone")) return "agency_phone";
    if (normalized.includes("email")) return "agency_email";
    if (normalized.includes("website")) return "agency_website";
    if (normalized.includes("contact")) return "agency_contact_name";
    return "agency_name";
  }
  if (hasAny(normalized, ["carrier", "insurance company", "company", "prior carrier", "insurer"])) {
    return "carrier_name";
  }
  if (hasAny(normalized, ["entity type", "legal entity", "business type"])) return "entity_type";
  if (normalized.includes("years in business")) return "years_in_business";
  if (normalized.includes("policy term")) return "policy_term";
  if (normalized.includes("policy") && hasAny(normalized, ["number", "no"])) return "policy_number";
  if (hasAny(normalized, ["effective date", "eff date"])) return "effective_date";
  if (hasAny(normalized, ["expiration date", "exp date", "renewal date"])) return "expiration_date";
  if (hasAny(normalized, ["fein", "federal ein", "tax identifier", "employer id"])) return "fein";
  if (normalized.includes("website")) return "business_website";
  if (normalized === "state") return "state";
  if (hasAny(normalized, ["revenue", "gross sales", "gross receipts"])) return "revenue";
  if (normalized.includes("payroll")) return "payroll";
  if (hasAny(normalized, ["premium", "stated value", "estimated exposure value", "coverage amount", "building value"])) {
    return "premium";
  }
  if (normalized.includes("deductible")) return "deductible";
  if (hasAny(normalized, ["coverage", "limit", "umbrella", "liability"])) return "coverage";
  if (hasAny(normalized, ["vin", "vehicle", "garaging", "year make model"])) return "vehicle";
  if (hasAny(normalized, ["property address", "risk address", "premises address", "location"])) {
    return "property_address";
  }
  if (normalized.includes("address")) {
    if (source === "asset_detail") return "property_address";
    if (hasAny(normalized, ["name", "insured", "applicant"])) return "insured_name_address";
    return "insured_mailing_address";
  }
  if (hasAny(normalized, ["description of operations", "business operations", "products", "services", "operations"])) {
    return "operations";
  }
  if (hasAny(normalized, ["loss", "claim"])) return "loss_history";
  if (hasAny(normalized, ["remark", "instruction", "explanation"])) return "remarks";
  if (hasAny(normalized, ["document summary", "documents on file"])) return "document_summary";
  if (normalized.includes("phone")) return "insured_phone";
  if (normalized.includes("email")) return "insured_email";
  if (insuredOrApplicant || hasAny(normalized, ["business legal name", "legal business name", "primary contact"])) {
    return normalized.includes("address") ? "insured_name_address" : "insured_name";
  }
  if (source === "asset_detail") return "property_detail";
  return "generic";
}

function isCandidateCompatibleWithField(label: string, candidate: CandidateValue): boolean {
  const normalized = normalize(label);
  const kind = candidate.kind;
  const agencyOrProducer = hasAny(normalized, ["agency", "producer"]);
  const insuredOrApplicant = hasAny(normalized, ["insured", "applicant", "client", "named insured"]);

  if (normalized.includes("fax")) {
    if (agencyOrProducer) return kind === "agency_fax";
    if (insuredOrApplicant || normalized.includes("contact")) return kind === "insured_fax";
    return kind === "agency_fax" || kind === "insured_fax";
  }
  if (hasAny(normalized, ["secondary email", "alternate email"])) return kind === "secondary_email";
  if (hasAny(normalized, ["secondary phone", "alternate phone"])) return kind === "secondary_phone";
  if (normalized.includes("email")) {
    if (agencyOrProducer) return kind === "agency_email";
    return kind === "insured_email";
  }
  if (normalized.includes("phone")) {
    if (agencyOrProducer) return kind === "agency_phone";
    return kind === "insured_phone";
  }
  if (normalized.includes("website")) {
    if (agencyOrProducer) return kind === "agency_website";
    return kind === "business_website";
  }
  if (hasAny(normalized, ["entity type", "legal entity", "business type"])) {
    return kind === "entity_type";
  }
  if (normalized.includes("years in business")) {
    return kind === "years_in_business";
  }
  if (hasAny(normalized, ["customer id", "customer number", "account number", "agency customer"])) {
    return kind === "agency_customer_id";
  }
  if (hasAny(normalized, ["subcode", "location code", "classification code", "class code"]) && kind !== "generic") {
    return false;
  }
  if (hasAny(normalized, ["fein", "federal ein", "tax identifier", "employer id"])) return kind === "fein";
  if (normalized.includes("address")) {
    if (agencyOrProducer) return kind === "agency_address";
    if (hasAny(normalized, ["property", "risk", "premises", "location", "garaging"])) return kind === "property_address";
    if (hasAny(normalized, ["name", "insured", "applicant"])) {
      return kind === "insured_name_address" || kind === "insured_mailing_address";
    }
    return kind === "insured_mailing_address";
  }
  if (agencyOrProducer) {
    if (normalized.includes("contact")) return kind === "agency_contact_name";
    return kind === "agency_name";
  }
  if (hasAny(normalized, ["carrier", "insurer", "insurance company", "prior carrier"])) return kind === "carrier_name";
  if (normalized.includes("company") && !hasAny(normalized, ["business", "legal"])) return kind === "carrier_name";
  if (normalized.includes("policy") && hasAny(normalized, ["number", "no", "#"])) return kind === "policy_number";
  if (hasAny(normalized, ["effective date", "eff date"])) return kind === "effective_date";
  if (hasAny(normalized, ["expiration date", "exp date", "renewal date"])) return kind === "expiration_date";
  if (normalized.includes("policy term")) return kind === "policy_term";
  if (hasAny(normalized, ["premium", "estimated exposure value", "stated value"])) {
    return kind === "premium";
  }
  if (hasAny(normalized, ["annual revenue", "gross sales", "gross receipts", "revenue"])) return kind === "revenue";
  if (normalized.includes("payroll")) return kind === "payroll";
  if (normalized.includes("deductible")) return kind === "deductible";
  if (hasAny(normalized, ["coverage", "limit", "liability", "umbrella", "forms and endorsements"])) {
    return kind === "coverage" || kind === "premium";
  }
  if (hasAny(normalized, ["vin", "vehicle", "year make model", "garaging address"])) {
    return kind === "vehicle" || kind === "property_address";
  }
  if (hasAny(normalized, ["property", "risk", "premises", "location", "occupancy", "construction", "roof", "stories"])) {
    return kind === "property_address" || kind === "property_detail" || kind === "premium";
  }
  if (hasAny(normalized, ["description of operations", "business operations", "products", "services", "operations"])) {
    return kind === "operations";
  }
  if (hasAny(normalized, ["loss", "claim"])) return kind === "loss_history";
  if (hasAny(normalized, ["remark", "instruction", "explanation"])) {
    return kind === "remarks" || kind === "document_summary";
  }
  if (hasAny(normalized, ["insured", "applicant", "client name", "business legal name", "legal business name", "primary contact"])) {
    return kind === "insured_name";
  }

  return !isSensitiveField(normalized);
}

function isCandidateEligibleForField(label: string, candidate: CandidateValue): boolean {
  if (!candidate.value.trim()) return false;
  if (candidate.kind === "remarks" || candidate.kind === "document_summary") return false;
  if (candidate.confidence < minimumConfidenceForCandidate(candidate)) return false;
  if (requiresDirectQuestionnaireResponse(label)) return isDirectQuestionnaireMatch(label, candidate);
  if (candidate.kind === "generic" && !isExactOrAliasMatch(label, candidate)) return false;
  return isCandidateCompatibleWithField(label, candidate);
}

function isCandidateEligibleForCanonicalField(candidate: CandidateValue): boolean {
  if (!candidate.value.trim()) return false;
  if (candidate.kind === "remarks" || candidate.kind === "document_summary" || candidate.kind === "generic") return false;
  if (candidate.kind === "loss_history") return false;
  return candidate.confidence >= minimumConfidenceForCandidate(candidate);
}

function minimumConfidenceForCandidate(candidate: CandidateValue): number {
  if (candidate.source === "questionnaire") return 0.92;
  if (candidate.source === "public_record") return 0.84;
  if (candidate.source === "asset_detail") return 0.82;
  return 0.86;
}

function isExactOrAliasMatch(label: string, candidate: CandidateValue): boolean {
  const normalizedLabel = normalize(label);
  const normalizedCandidate = normalize(candidate.label);
  if (normalizedCandidate === normalizedLabel) return true;
  return aliasesForField(label).map(normalize).includes(normalizedCandidate);
}

function isDirectQuestionnaireMatch(label: string, candidate: CandidateValue): boolean {
  return candidate.source === "questionnaire" && isExactOrAliasMatch(label, candidate);
}

function filterUnsafeBaselineFields(fields: TemplateFieldMap, dossier: AcordAiFillDossier): TemplateFieldMap {
  const clean: TemplateFieldMap = {};
  Object.entries(fields).forEach(([label, value]) => {
    if (!value.trim()) return;
    if (SYSTEM_META_FIELDS.has(label) || canUseResolvedFieldValue(label, "system", dossier)) {
      clean[label] = value;
    }
  });
  return clean;
}

function canUseResolvedFieldValue(
  label: string,
  source: AcordFillSource,
  dossier: AcordAiFillDossier
): boolean {
  if (!requiresDirectQuestionnaireResponse(label)) return true;
  return source === "questionnaire" && hasDirectQuestionnaireResponseForField(label, dossier);
}

function hasDirectQuestionnaireResponseForField(label: string, dossier: AcordAiFillDossier): boolean {
  const normalizedLabel = normalize(label);
  return dossier.questions.some((question) => {
    if (!dossier.responses[question.id]?.trim()) return false;
    return (question.acordFieldLabels ?? []).some((fieldLabel) => normalize(fieldLabel) === normalizedLabel);
  });
}

function requiresDirectQuestionnaireResponse(label: string): boolean {
  const normalized = normalize(label);
  if (!normalized) return false;
  if (hasAny(normalized, ["remark", "remarks", "explanation", "explain all yes", "additional information", "comment", "note"])) {
    return true;
  }
  if (/\b(any|does|do|has|have|is|are|was|were|will|can|should)\b/.test(normalized) && /(\?|if so|identify|describe|explain|list|y n|yes no)/.test(normalized)) {
    return true;
  }
  return hasAny(normalized, [
    "hold harmless",
    "mvr",
    "motor vehicle record",
    "driver recruiting",
    "not covered by workers compensation",
    "vehicles used by family members",
    "vehicles owned but not scheduled",
    "convictions",
    "moving traffic violations",
    "agent inspected vehicles",
  ]);
}

function questionTargetsCarrySameValue(labels: string[]): boolean {
  if (labels.length <= 1) return true;
  const kinds = labels.map((label) => inferCandidateKind(label, "questionnaire"));
  if (kinds.includes("generic")) return false;
  return new Set(kinds).size === 1;
}

function mapCompositeQuestionnaireValueToFields(
  value: string,
  fieldLabels: string[]
): { fieldLabel: string; fieldValue: string }[] {
  const lines = compositeQuestionnaireLines(value);
  const mapped = fieldLabels
    .map((fieldLabel) => {
      const fieldValue = compositeValueForFieldLabel(lines, fieldLabel);
      return fieldValue ? { fieldLabel, fieldValue } : null;
    })
    .filter((item): item is { fieldLabel: string; fieldValue: string } => item !== null);
  if (mapped.length > 0 || looksLikeUngroundedCompositeAnswer(value)) return mapped;

  const fallbackField =
    fieldLabels.find((label) => inferCandidateKind(label, "questionnaire") !== "generic") ??
    fieldLabels[0];
  return fallbackField ? [{ fieldLabel: fallbackField, fieldValue: value }] : [];
}

function looksLikeUngroundedCompositeAnswer(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) return false;
  return /[,;\n]/.test(cleaned) && !/^\s*[^:]{2,90}:\s*.+$/m.test(cleaned);
}

function compositeQuestionnaireLines(value: string): { label: string; value: string }[] {
  return value
    .split(/\r?\n|;\s+/)
    .map((line) => line.trim())
    .map((line) => line.match(/^([^:]{2,90}):\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => !!match?.[1] && !!match?.[2])
    .map((match) => ({ label: match[1].trim(), value: match[2].trim() }))
    .filter((line) => !!line.label && !!line.value);
}

function compositeValueForFieldLabel(
  lines: { label: string; value: string }[],
  fieldLabel: string
): string {
  if (lines.length === 0) return "";
  const normalizedField = normalize(fieldLabel);
  const exact = lines.find(({ label }) => {
    const normalizedLine = normalize(label);
    return (
      normalizedLine === normalizedField ||
      normalizedField.includes(normalizedLine) ||
      normalizedLine.includes(normalizedField)
    );
  });
  if (exact) return exact.value;

  const fieldKind = inferCandidateKind(fieldLabel, "questionnaire");
  if (fieldKind === "generic") return "";
  const kindMatch = lines.find(({ label }) => inferCandidateKind(label, "questionnaire") === fieldKind);
  return kindMatch?.value ?? "";
}

function canUseFuzzyMatch(normalizedLabel: string): boolean {
  return !isSensitiveField(normalizedLabel);
}

function isSensitiveField(normalizedLabel: string): boolean {
  return hasAny(normalizedLabel, [
    "fax",
    "secondary",
    "alternate",
    "email",
    "phone",
    "address",
    "name",
    "insured",
    "applicant",
    "agency",
    "producer",
    "carrier",
    "insurer",
    "policy",
    "code",
    "fein",
    "tax",
    "website",
    "entity",
    "years",
    "business type",
  ]);
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function fitValueForAcordBox(
  value: string,
  box: DocumentTemplateFieldBox
): { value: string; overflow?: string } {
  const normalized = value.replace(/\s+/g, " ").trim();
  const capacity = fieldCapacity(box);
  if (normalized.length <= capacity) return { value: normalized };
  const safe = normalized.slice(0, Math.max(0, capacity - 3)).replace(/\s+\S*$/, "").trim();
  const fitted = safe ? `${safe}...` : normalized.slice(0, capacity);
  return {
    value: fitted,
    overflow: normalized.slice(fitted.replace(/\.\.\.$/, "").length).trim(),
  };
}

function fieldCapacity(box: DocumentTemplateFieldBox): number {
  const lineCount = box.multiline ? Math.max(1, Math.floor(box.height / 1.8)) : 1;
  const perLine = Math.floor(box.width * (box.kind === "checkbox" ? 0.25 : 1.45));
  const base = perLine * lineCount;
  if (box.kind === "date") return Math.min(16, Math.max(8, base));
  if (box.kind === "currency" || box.kind === "number") return Math.min(20, Math.max(8, base));
  return Math.max(10, Math.min(box.multiline ? 360 : 90, base));
}

function missingLabelsForLayout(
  layout: DocumentTemplateFieldBox[],
  fields: TemplateFieldMap,
  fallbackMissing: string[]
): string[] {
  const missing = layout
    .filter((box) => box.required && !fields[box.label]?.trim())
    .map((box) => box.label);
  if (layout.length > 0) return Array.from(new Set(missing)).filter(Boolean);
  return Array.from(new Set([...missing, ...fallbackMissing])).filter(Boolean);
}

function stripSystemTemplateFields(fields?: TemplateFieldMap): TemplateFieldMap {
  const clean: TemplateFieldMap = {};
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (!SYSTEM_META_FIELDS.has(key) && !requiresDirectQuestionnaireResponse(key) && value.trim()) {
      clean[key] = value;
    }
  });
  return clean;
}

function dedupeMappings(mappings: AcordMappedField[]): NonNullable<CommunicationAttachment["fieldMappings"]> {
  const seen = new Set<string>();
  return mappings.filter((mapping) => {
    const key = `${mapping.targetField}|${mapping.value}|${mapping.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => `${humanize(key)}: ${stringifyValue(nested)}`)
      .filter((part) => !part.endsWith(": "))
      .join("; ");
  }
  return String(value).trim();
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US");
}

function participantSummary(participant: NonNullable<Policy["participants"]>[number]): string {
  return [
    participant.name,
    participant.relationship,
    participant.status,
    participant.licenseNumber ? `License ${participant.licenseNumber}` : undefined,
    participant.dateOfBirth ? `DOB ${formatDate(participant.dateOfBirth)}` : undefined,
    participant.notes,
  ].filter(Boolean).join(" - ");
}

function partySummary(party: NonNullable<Policy["additionalInsureds"]>[number] | NonNullable<Policy["beneficiaries"]>[number]): string {
  return [
    party.name,
    party.relationship ?? party.holderType?.replace(/_/g, " "),
    party.address,
    party.email,
    party.phone,
    party.notes,
  ].filter(Boolean).join(" - ");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
