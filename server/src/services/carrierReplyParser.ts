export type ParsedCarrierReply = {
  outcome: "accepted" | "quoted" | "declined" | "pending" | "more_info_required";
  confidence: number;
  policyType?: string;
  coverages: Array<{
    label: string;
    limit?: string;
    premium?: string;
    deductible?: string;
    terms?: string;
    sourceText?: string;
  }>;
  limits: string[];
  premiums: string[];
  deductibles: string[];
  terms: string[];
  carrierNotes: string[];
  conditions: string[];
  nextSteps: string[];
  requestedItems: string[];
  supplementalAttachmentNames: string[];
  declineReason?: string;
  evidenceSnippets: string[];
  responseDeadline?: string;
  requiresAgentReview: boolean;
  agentReviewReason?: string;
};

type CarrierReplyEmail = {
  subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<{ fileName?: string; fileType?: string }>;
};

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function plainText(email: CarrierReplyEmail): string {
  return [email.subject ?? "", email.text ?? "", email.html ?? ""]
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function labeledValue(text: string, label: RegExp): string | undefined {
  const match = text.match(new RegExp(`${label.source}\\s*:?\\s*([^\\n]+)`, label.flags));
  return match?.[1]?.replace(/^[-*•]\s*/, "").replace(/[*_]/g, "").trim() || undefined;
}

function money(value: string | undefined): string | undefined {
  return value?.match(/\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0]?.replace(/\s+/g, "");
}

function parseDeadline(text: string): string | undefined {
  const match = text.match(
    /\bby\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?)/i
  );
  if (!match) return undefined;
  const date = new Date(match[1]);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

function relevantLines(text: string, pattern: RegExp, limit = 8): string[] {
  return unique(
    text
      .split(/\n+|(?<=[.!?])\s+/)
      .map((line) => line.replace(/^\s*[-*•]+\s*/, "").replace(/[*_]/g, "").trim())
      .filter((line) => line && pattern.test(line))
  ).slice(0, limit);
}

export function parseCarrierReplyDeterministically(email: CarrierReplyEmail): ParsedCarrierReply {
  const text = plainText(email);
  const lower = text.toLowerCase();
  const annualPremium = money(labeledValue(text, /(?:estimated\s+)?annual\s+premium/i));
  const policyType = labeledValue(text, /policy\s+type/i);
  const effectiveDate = labeledValue(text, /(?:proposed\s+)?effective\s+date/i);
  const deductible = money(labeledValue(text, /(?:property\s+)?deductible/i));
  const commission = labeledValue(text, /commission/i);
  const declineEvidence = relevantLines(
    text,
    /\b(declin(?:e|ed|ing)|no appetite|unable to quote|cannot quote|not able to offer)\b/i
  );
  const approvalEvidence = relevantLines(
    text,
    /\b(approv(?:e|ed|al)|accepted|can proceed|we can consider|appetite)\b/i
  );
  const quoteEvidence = relevantLines(text, /\b(quote|premium|proposal|indication|bind(?:able|ing)?)\b/i);
  const conditionEvidence = relevantLines(
    text,
    /\b(required prior to bind(?:ing)?|subject to|to bind|coverage is not bound|written authorization)\b/i
  );
  const requestedEvidence = relevantLines(
    text,
    /\b(supplemental|additional information|more information|please provide|need(?:ed|s))\b/i
  ).filter((line) => !conditionEvidence.includes(line));
  const supplementalAttachmentNames = unique(
    (email.attachments ?? [])
      .filter((attachment) => /pdf|supplement|questionnaire|application|loss.?run/i.test(
        `${attachment.fileName ?? ""} ${attachment.fileType ?? ""}`
      ))
      .map((attachment) => attachment.fileName)
  );
  const limitLines = relevantLines(
    text,
    /\b(general liability|products and completed operations|commercial property|business income|policy limits?)\b/i
  );
  const terms = unique([
    effectiveDate ? `Effective date: ${effectiveDate}` : undefined,
    commission ? `Commission: ${commission}` : undefined,
  ]);
  const responseDeadline = parseDeadline(text);

  if (declineEvidence.length > 0) {
    return {
      outcome: "declined",
      confidence: 0.9,
      coverages: [],
      limits: [],
      premiums: [],
      deductibles: [],
      terms,
      carrierNotes: [],
      conditions: [],
      nextSteps: [],
      requestedItems: [],
      supplementalAttachmentNames,
      declineReason: declineEvidence[0],
      evidenceSnippets: declineEvidence,
      responseDeadline,
      requiresAgentReview: false,
    };
  }

  if (annualPremium && (approvalEvidence.length > 0 || quoteEvidence.length > 0)) {
    return {
      outcome: "quoted",
      confidence: approvalEvidence.length > 0 ? 0.94 : 0.82,
      policyType,
      coverages: [],
      limits: limitLines,
      premiums: [annualPremium],
      deductibles: deductible ? [deductible] : [],
      terms,
      carrierNotes: unique([...approvalEvidence, ...quoteEvidence]).slice(0, 8),
      conditions: conditionEvidence,
      nextSteps: conditionEvidence,
      requestedItems: [],
      supplementalAttachmentNames,
      evidenceSnippets: unique([...approvalEvidence, ...quoteEvidence, ...conditionEvidence]).slice(0, 10),
      responseDeadline,
      requiresAgentReview: false,
    };
  }

  if (supplementalAttachmentNames.length > 0 || requestedEvidence.length > 0) {
    return {
      outcome: "more_info_required",
      confidence: supplementalAttachmentNames.length > 0 ? 0.86 : 0.76,
      policyType,
      coverages: [],
      limits: limitLines,
      premiums: annualPremium ? [annualPremium] : [],
      deductibles: deductible ? [deductible] : [],
      terms,
      carrierNotes: quoteEvidence,
      conditions: conditionEvidence,
      nextSteps: requestedEvidence,
      requestedItems: requestedEvidence.length > 0 ? requestedEvidence : ["Carrier requested supplemental information."],
      supplementalAttachmentNames,
      evidenceSnippets: unique([...requestedEvidence, ...quoteEvidence]).slice(0, 8),
      responseDeadline,
      requiresAgentReview: false,
    };
  }

  const hasCarrierSignal = /\b(application|underwriting|quote|carrier|policy|premium|supplemental|decline)\b/i.test(lower);
  return {
    outcome: "pending",
    confidence: hasCarrierSignal ? 0.48 : 0.25,
    policyType,
    coverages: [],
    limits: limitLines,
    premiums: annualPremium ? [annualPremium] : [],
    deductibles: deductible ? [deductible] : [],
    terms,
    carrierNotes: quoteEvidence,
    conditions: conditionEvidence,
    nextSteps: [],
    requestedItems: [],
    supplementalAttachmentNames,
    evidenceSnippets: quoteEvidence.slice(0, 6),
    responseDeadline,
    requiresAgentReview: true,
    agentReviewReason: "The carrier response does not state an unambiguous quote, decline, or information request.",
  };
}
