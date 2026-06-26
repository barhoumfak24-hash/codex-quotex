// =====================================================================
// AI service layer — provider-agnostic abstraction.
// Switch with AI_PROVIDER env var. Real keys must only live in this env.
// =====================================================================

import { provider } from "./provider.js";

const PRELIMINARY =
  "This is a preliminary AI-generated estimate. Final pricing, binding, and coverage decisions must be reviewed and approved by a licensed insurance professional. A deposit does not constitute proof of active coverage.";

const ASSET_TYPES = [
  "coastal_home",
  "luxury_vehicle",
  "yacht",
  "jewelry",
  "umbrella_liability",
  "full_portfolio",
  "other",
] as const;

type AssetType = (typeof ASSET_TYPES)[number];

const STRING_ARRAY_SCHEMA = { type: "array", items: { type: "string" } };
const ASSET_TYPE_SCHEMA = { type: "string", enum: [...ASSET_TYPES] };

const QUOTEX_INTELLIGENCE_SYSTEM = [
  "You are Quotex Intelligence, the senior AI copilot for a private-client insurance agency SaaS.",
  "Operate like an expert licensed-agency assistant: precise, conservative, compliance-aware, and action-oriented.",
  "Use only the supplied facts. Never invent carrier decisions, binding status, coverage availability, savings, legal advice, or claim outcomes.",
  "When information is missing, state the missing item and the next best action instead of guessing.",
  "Output valid JSON only, matching the requested schema exactly.",
].join(" ");

function domainSystem(task: string): string {
  return `${QUOTEX_INTELLIGENCE_SYSTEM} Task: ${task}`;
}

function objectSchema(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function asAssetType(value: unknown): AssetType {
  return ASSET_TYPES.includes(value as AssetType) ? (value as AssetType) : "other";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function coerceFieldValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (/^(true|yes)$/i.test(trimmed)) return true;
  if (/^(false|no)$/i.test(trimmed)) return false;
  const money = trimmed.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?$/i);
  if (money) {
    let n = Number(money[1].replace(/,/g, ""));
    const unit = (money[2] ?? "").toLowerCase();
    if (unit === "k" || unit === "thousand") n *= 1_000;
    if (unit === "m" || unit === "million") n *= 1_000_000;
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}

function inferAssetType(text: string): AssetType {
  const t = text.toLowerCase();
  if (/(yacht|boat|vessel|hull|marina)/.test(t)) return "yacht";
  if (/(home|house|property|condo|estate|coastal)/.test(t)) return "coastal_home";
  if (/(porsche|ferrari|lamborghini|bentley|car|vehicle|auto)/.test(t)) return "luxury_vehicle";
  if (/(jewel|ring|watch|necklace|earring|appraisal)/.test(t)) return "jewelry";
  if (/(umbrella|liability)/.test(t)) return "umbrella_liability";
  if (/(portfolio|everything|collection)/.test(t)) return "full_portfolio";
  return "other";
}

function extractValue(text: string): number | undefined {
  const m = text.match(/\$?\s?([\d,]+(?:\.\d+)?)\s?(k|m|million|thousand)?/i);
  if (!m) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  if (unit === "m" || unit === "million") n *= 1_000_000;
  return n > 1_000 ? n : undefined;
}

export async function aiParseIntake(rawDescription: string) {
  const system = domainSystem(
    "Extract a prospect's insurance intake into structured underwriting data for agent review."
  );
  const user = `Allowed assetType values: ${ASSET_TYPES.join(", ")}.
Extract the asset type and every known underwriting field from this customer description.
Rules:
- Normalize values into useful field names such as estimatedValue, address, roofAge, vin, garagingAddress, lossHistory, entityType, revenue, employeeCount.
- Do not infer a value unless the text clearly implies it.
- Follow-up questions must be specific, agent-usable, and ordered by underwriting importance.
- Return underwriting data as fieldEntries with key/value pairs.

"""${rawDescription.slice(0, 8_000)}"""`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "intake_extraction",
    schema: objectSchema({
      assetType: ASSET_TYPE_SCHEMA,
      fieldEntries: {
        type: "array",
        items: objectSchema({
          key: { type: "string" },
          value: { type: "string" },
        }),
      },
      confidence: { type: "number" },
      followUpQuestions: STRING_ARRAY_SCHEMA,
    }),
    quality: "advanced",
    maxOutputTokens: 1_300,
  });
  const record = isRecord(json) ? json : {};
  const fields: Record<string, unknown> = {};
  asObjectArray(record.fieldEntries).forEach((entry) => {
    const key = asString(entry.key);
    const value = asString(entry.value);
    if (key && value) fields[key] = coerceFieldValue(value);
  });
  if (isRecord(record.fields)) Object.assign(fields, record.fields);
  const value = extractValue(rawDescription);
  if (value && fields.estimatedValue == null) fields.estimatedValue = value;
  const assetType = asAssetType(record.assetType ?? inferAssetType(rawDescription));
  const followUpQuestions = asStringArray(record.followUpQuestions);
  if (followUpQuestions.length === 0) {
    followUpQuestions.push("Confirm the asset details and any missing underwriting documents.");
  }
  return {
    assetType,
    fields,
    confidence: clamp(asNumber(record.confidence, assetType === "other" ? 0.35 : 0.65), 0, 0.95),
    followUpQuestions,
  };
}

export async function aiPremiumEstimate(input: { assetType: string; parsedData: Record<string, unknown> }) {
  const system = domainSystem(
    "Produce a preliminary premium range for licensed-agent review, with transparent uncertainty."
  );
  const user = `Given assetType=${asAssetType(input.assetType)} and parsedData=${JSON.stringify(input.parsedData).slice(0, 8_000)}, return JSON: { "min": number, "max": number, "rationale": string, "missingDocuments": string[], "recommendedNextSteps": string[], "disclaimer": string }.
If data is incomplete, widen the range, explain the uncertainty, and list exact missing documents/data.
Never say the quote is final, guaranteed, bound, approved, or carrier-confirmed.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "premium_estimate",
    schema: objectSchema({
      min: { type: "number" },
      max: { type: "number" },
      rationale: { type: "string" },
      missingDocuments: STRING_ARRAY_SCHEMA,
      recommendedNextSteps: STRING_ARRAY_SCHEMA,
      disclaimer: { type: "string" },
    }),
    quality: "advanced",
    maxOutputTokens: 1_200,
  });
  const record = isRecord(json) ? json : {};
  const value = asNumber(input.parsedData?.estimatedValue, 1_000_000);
  const fallbackMin = Math.max(250, Math.round(value * 0.006));
  const fallbackMax = Math.max(fallbackMin + 250, Math.round(value * 0.018));
  return {
    min: Math.max(0, Math.round(asNumber(record.min, fallbackMin))),
    max: Math.max(0, Math.round(asNumber(record.max, fallbackMax))),
    rationale:
      typeof record.rationale === "string" && record.rationale.trim()
        ? record.rationale.trim()
        : "Range is preliminary and based on asset type, declared value, and incomplete underwriting data.",
    missingDocuments: asStringArray(record.missingDocuments),
    recommendedNextSteps:
      asStringArray(record.recommendedNextSteps).length > 0
        ? asStringArray(record.recommendedNextSteps)
        : ["Confirm underwriting details with the customer", "Collect missing documents", "Submit to licensed carrier underwriters"],
    disclaimer: PRELIMINARY,
  };
}

export async function aiCarrierMatch(
  input: { assetType: string; parsedData: Record<string, unknown> },
  carriers: { id: string; name: string; preferredAssetTypes: string[]; appetiteNotes?: string }[]
) {
  const active = carriers.filter(
    (c) => typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.preferredAssetTypes)
  );
  if (active.length === 0) return null;
  const system = domainSystem(
    "Rank carriers by appetite alignment for internal agent review, using only the provided carrier data."
  );
  const user = `Asset: ${asAssetType(input.assetType)}
Data: ${JSON.stringify(input.parsedData).slice(0, 8_000)}
Carriers: ${JSON.stringify(active).slice(0, 12_000)}
Return JSON: { "carrierId": string, "carrierName": string, "score": number from 0 to 1, "reason": string, "alternates": [{ "carrierId": string, "carrierName": string, "score": number, "reason": string }] }.
Only choose a carrier from the provided list. Score appetite alignment, state availability, value band fit, exclusions, and evidence quality.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "carrier_match",
    schema: objectSchema({
      carrierId: { type: "string" },
      carrierName: { type: "string" },
      score: { type: "number" },
      reason: { type: "string" },
      alternates: {
        type: "array",
        items: objectSchema({
          carrierId: { type: "string" },
          carrierName: { type: "string" },
          score: { type: "number" },
          reason: { type: "string" },
        }),
      },
    }),
    quality: "advanced",
    maxOutputTokens: 1_500,
  });
  const record = isRecord(json) ? json : {};
  const chosen = active.find((c) => c.id === record.carrierId) ?? fallbackCarrier(input.assetType, active);
  if (!chosen) return null;
  const alternatesRaw = Array.isArray(record.alternates) ? record.alternates : [];
  const alternates = alternatesRaw
    .filter(isRecord)
    .map((alt) => {
      const c = active.find((carrier) => carrier.id === alt.carrierId);
      if (!c || c.id === chosen.id) return null;
      return {
        carrierId: c.id,
        carrierName: c.name,
        score: clamp(asNumber(alt.score, 0.55), 0, 0.99),
        reason:
          typeof alt.reason === "string" && alt.reason.trim()
            ? alt.reason.trim()
            : c.appetiteNotes ?? "Secondary appetite match.",
      };
    })
    .filter((alt): alt is { carrierId: string; carrierName: string; score: number; reason: string } => alt !== null)
    .slice(0, 3);
  return {
    carrierId: chosen.id,
    carrierName: chosen.name,
    score: clamp(asNumber(record.score, 0.72), 0, 0.99),
    reason:
      typeof record.reason === "string" && record.reason.trim()
        ? record.reason.trim()
        : `Best available appetite alignment for ${asAssetType(input.assetType).replace(/_/g, " ")}.`,
    alternates,
  };
}

export async function aiMarketingMessage(
  prospect: { name: string; assetType: string },
  channel: "email" | "sms"
) {
  const system = domainSystem(
    "Write concierge-grade prospect outreach that feels personal, specific, and compliant."
  );
  const user = `Write a ${channel} message to ${prospect.name} about completing their ${asAssetType(prospect.assetType).replace(/_/g, " ")} quote.
Requirements:
- Sound like a polished private-client advisor, not a generic sales bot.
- Include a clear next step.
- SMS must be under 320 characters and include STOP opt-out.
- Email must include a tasteful opt-out sentence.
- Do not promise coverage, savings, approvals, or binding.
Return JSON: { "subject": string, "body": string }.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "marketing_message",
    schema: objectSchema({ subject: { type: "string" }, body: { type: "string" } }),
    quality: "advanced",
    maxOutputTokens: 900,
  });
  const record = isRecord(json) ? json : {};
  const first = (prospect.name ?? "there").split(/\s+/)[0] || "there";
  const fallback =
    channel === "sms"
      ? `Hi ${first}, Quotex Insurance here. Ready to continue your coverage review? Reply YES for a quick callback. Reply STOP to opt out.`
      : `Hi ${first},\n\nI wanted to follow up on your coverage review. If you have 15 minutes this week, I can walk through the next steps and what our carrier partners still need for a firm quote.\n\nReply with a time that works, or let me know if you would prefer not to receive follow-ups.\n\nBest,\nYour Quotex agent`;
  return {
    subject:
      channel === "email"
        ? typeof record.subject === "string" && record.subject.trim()
          ? record.subject.trim()
          : `Continuing your ${asAssetType(prospect.assetType).replace(/_/g, " ")} coverage review`
        : undefined,
    body:
      typeof record.body === "string" && record.body.trim()
        ? enforceOptOut(record.body.trim(), channel)
        : fallback,
  };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

type ContactLine = "personal" | "commercial";

type ContactExtractionResult = {
  lineOfBusiness?: ContactLine;
  businessName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  assetType?: AssetType;
  estimatedValue?: number;
  notes?: string;
  summary: string;
  confidence: number;
  sources: string[];
};

function compactContactText(input: { fileName: string; text?: string }): string {
  return `${input.fileName}\n${input.text ?? ""}`
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function labeledContactValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(
      String.raw`(?:^|\n)\s*(?:${label})\s*[:#-]?\s*([^\n]{2,140})`,
      "i"
    );
    const value = text.match(pattern)?.[1]?.trim().replace(/\s{2,}/g, " ");
    if (value && !/^(n\/a|none|unknown|not provided)$/i.test(value)) return value;
  }
  return "";
}

function titleCaseContactName(value: string): string {
  return value
    .replace(/\b(MR|MRS|MS|DR)\.?\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) =>
      /^(LLC|INC|CO|CORP|LTD|LP|LLP)$/i.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join(" ");
}

function extractContactEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function extractContactPhone(text: string): string | undefined {
  const match = text.match(
    /(?:phone|mobile|cell|tel|telephone|contact)?\s*[:#-]?\s*(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/i
  );
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function extractContactAddress(text: string): string | undefined {
  const labeled = labeledContactValue(text, [
    "mailing address",
    "insured address",
    "applicant address",
    "property address",
    "risk address",
    "garaging address",
    "address",
  ]);
  if (/\d{1,6}\s+/.test(labeled) && /,\s*[A-Z]{2}\s+\d{5}/i.test(labeled)) return labeled;
  const match = text.match(
    /\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Way|Court|Ct\.?|Circle|Cir\.?|Trail|Trl\.?|Place|Pl\.?|Highway|Hwy\.?)\b[^\n,]*(?:,\s*[A-Za-z .'-]+){1,2},?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?/i
  );
  return match?.[0]?.replace(/\s+/g, " ").trim();
}

function extractContactBusinessName(text: string): string | undefined {
  const labeled = labeledContactValue(text, [
    "business name",
    "company name",
    "named insured",
    "applicant business",
    "entity name",
    "legal name",
  ]);
  const businessLike = /\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|CO\.?|COMPANY|LTD\.?|LP|LLP|DBA)\b/i;
  if (labeled && businessLike.test(labeled)) return labeled.replace(/\s+/g, " ").trim();
  const match = text.match(
    /\b([A-Z][A-Za-z0-9&'., -]{2,80}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|LP|LLP))\b/
  );
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function extractContactPersonName(text: string, businessName?: string): string | undefined {
  const first = labeledContactValue(text, ["first name", "given name"]);
  const last = labeledContactValue(text, ["last name", "surname"]);
  if (first && last) return titleCaseContactName(`${first} ${last}`);
  const labeled = labeledContactValue(text, [
    "contact name",
    "primary contact",
    "client name",
    "applicant name",
    "customer name",
    "name",
  ]);
  if (
    labeled &&
    labeled !== businessName &&
    !/\b(LLC|INC|CORP|COMPANY|AGENCY|INSURANCE|CARRIER)\b/i.test(labeled)
  ) {
    return titleCaseContactName(labeled);
  }
  const email = extractContactEmail(text);
  if (email) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ");
    if (/[a-z]{2,}\s+[a-z]{2,}/i.test(local)) return titleCaseContactName(local);
  }
  return undefined;
}

function inferContactLine(text: string, businessName?: string, assetType?: AssetType): ContactLine | undefined {
  const lower = text.toLowerCase();
  if (
    businessName ||
    /\b(commercial|business owners'? policy|business owner'?s policy|bop|general liability|workers comp|workers compensation|commercial auto|professional liability|premises|operations|payroll|fein|naics|sic)\b/.test(lower)
  ) {
    return "commercial";
  }
  if (
    /\b(homeowners?|personal auto|personal lines|dwelling|umbrella|jewelry|yacht|primary residence|household|vin|garaging address|driver)\b/.test(lower)
  ) {
    return "personal";
  }
  return assetType && assetType !== "other" ? "personal" : undefined;
}

function inferContactAssetType(text: string): AssetType | undefined {
  const assetType = inferAssetType(text);
  return assetType === "other" ? undefined : assetType;
}

function extractContactValue(text: string): number | undefined {
  const labeled = labeledContactValue(text, [
    "estimated value",
    "replacement cost",
    "dwelling limit",
    "coverage a",
    "building limit",
    "appraised value",
    "scheduled value",
    "hull value",
    "market value",
    "requested limit",
    "agreed value",
    "asset value",
  ]);
  const labeledValue = extractValue(labeled);
  if (labeledValue) return labeledValue;
  const values = Array.from(text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?(m|mm|million|k|thousand)?/gi))
    .map((match) => extractValue(match[0]))
    .filter((value): value is number => typeof value === "number" && value >= 5_000);
  return values.length ? Math.max(...values) : undefined;
}

function uniqueContactStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)));
}

function extractContactNotes(text: string, assetType?: AssetType): string | undefined {
  const snippets = uniqueContactStrings([
    labeledContactValue(text, ["notes", "remarks", "description", "operations", "coverage requested"]),
    labeledContactValue(text, ["current carrier", "carrier"]),
    labeledContactValue(text, ["policy number", "prior policy"]),
  ]);
  if (assetType === "luxury_vehicle") {
    const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0];
    if (vin) snippets.push(`VIN: ${vin.toUpperCase()}`);
  }
  if (assetType === "yacht") {
    const hin = text.match(/\b[A-Z]{3}[A-Z0-9]{9}\b/i)?.[0];
    if (hin) snippets.push(`Hull ID: ${hin.toUpperCase()}`);
  }
  return snippets.join("\n") || undefined;
}

function contactExtractionFieldCount(contact: Partial<ContactExtractionResult>): number {
  return [
    contact.lineOfBusiness,
    contact.businessName,
    contact.name,
    contact.email,
    contact.phone,
    contact.address,
    contact.assetType,
    contact.estimatedValue,
    contact.notes,
  ].filter(Boolean).length;
}

function localContactExtraction(input: {
  fileName: string;
  text?: string;
  dataUrl?: string;
}): ContactExtractionResult {
  const text = compactContactText(input);
  if (input.text && text.length > input.fileName.length + 8) {
    const businessName = extractContactBusinessName(text);
    const assetType = inferContactAssetType(text);
    const lineOfBusiness = inferContactLine(text, businessName, assetType);
    const name = extractContactPersonName(text, businessName);
    const email = extractContactEmail(text);
    const phone = extractContactPhone(text);
    const address = extractContactAddress(text);
    const estimatedValue = extractContactValue(text);
    const notes = extractContactNotes(text, assetType);
    const result: ContactExtractionResult = {
      lineOfBusiness,
      businessName,
      name,
      email,
      phone,
      address,
      assetType,
      estimatedValue,
      notes,
      summary: "",
      confidence: 0,
      sources: [],
    };
    const count = contactExtractionFieldCount(result);
    if (count > 0) {
      result.summary = `Scanned "${input.fileName}" and extracted ${count} profile field${
        count === 1 ? "" : "s"
      }. Review before saving.`;
      result.confidence = clamp(0.42 + count * 0.07 + (email ? 0.08 : 0) + (address ? 0.08 : 0), 0, 0.92);
      result.sources = [
        `Document: ${input.fileName}`,
        "Full document text scan",
        ...(input.dataUrl ? ["Vision attachment available for server AI"] : []),
      ];
      return result;
    }
  }

  return {
    summary: input.dataUrl
      ? `Scanned "${input.fileName}", but no fields were confidently extracted. Review the file and fill only verified details.`
      : `No readable contact fields were found in "${input.fileName}". Review the file and enter verified details manually.`,
    confidence: 0.18,
    sources: [
      `Document: ${input.fileName}`,
      input.dataUrl ? "Vision attachment available for server AI" : "No readable text found",
      "No fabricated filename data",
    ],
  };
}

export async function aiEmailSubject(input: { body?: string; contactName?: string; context?: string }) {
  const system = domainSystem(
    "Act as an elite insurance email subject strategist. Derive the subject from the actual body, not from the contact name."
  );
  const user = `Contact: ${input.contactName ?? "unknown"}
Context: ${input.context ?? ""}
Message body:
"""${(input.body ?? "").slice(0, 8_000)}"""

Create the best possible subject line for a private-client insurance agency email.
Rules:
- Under 72 characters.
- Specific to the action in the body: renewal, e-signature, missing documents, quote options, claim, payment, underwriting, or scheduling.
- Do not use the recipient's name unless the body explicitly requires it.
- Do not add unsupported facts, urgency, approvals, savings, binding, or coverage promises.
- Avoid generic subjects like "Follow up", "Checking in", "Insurance update", or "A message from your agent".
- If the body has multiple topics, choose the topic requiring the recipient's next action.
Return JSON with the final subject and confidence.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "email_subject",
    schema: objectSchema({ subject: { type: "string" }, confidence: { type: "number" } }),
    quality: "advanced",
    maxOutputTokens: 300,
  });
  const record = isRecord(json) ? json : {};
  return { subject: asString(record.subject, "A message from your agent"), confidence: clamp(asNumber(record.confidence, 0.7), 0, 1) };
}

export async function aiEnhanceMessage(input: { body: string; channel: "email" | "sms"; contactName?: string }) {
  const system = domainSystem(
    "Rewrite insurance agency messages into polished, accurate, human communication while preserving meaning."
  );
  const user = `Channel: ${input.channel}
Contact name: ${input.contactName ?? "unknown"}
Draft:
"""${input.body.slice(0, 8_000)}"""

Return a polished version ready to send.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "enhanced_message",
    schema: objectSchema({
      body: { type: "string" },
      changedMeaning: { type: "boolean" },
      safetyNotes: STRING_ARRAY_SCHEMA,
    }),
    quality: "advanced",
    maxOutputTokens: input.channel === "sms" ? 500 : 1_200,
  });
  const record = isRecord(json) ? json : {};
  return {
    body: asString(record.body, input.body),
    changedMeaning: Boolean(record.changedMeaning),
    safetyNotes: asStringArray(record.safetyNotes),
  };
}

export async function aiExtractContactFromFile(input: {
  fileName: string;
  fileType?: string;
  text?: string;
  dataUrl?: string;
}) {
  const local = localContactExtraction(input);
  const system = domainSystem(
    "Extract contact and insurance-interest details from uploaded intake material for staff review. Read every visible field in the provided text, PDF, or screenshot. Never invent missing data; return blank strings when unsure."
  );
  const user = `File name: ${input.fileName}
File type: ${input.fileType ?? "unknown"}
OCR/Text:
"""${(input.text ?? "").slice(0, 12_000)}"""

Extract the contact, business/client line, mailing/risk address, asset interest, estimated values, and notes. If information is absent, use empty strings and lower confidence.`;
  let json: unknown = {};
  try {
    json = await provider.completeJson({
      system,
      user,
      attachments: input.dataUrl
        ? [{ fileName: input.fileName, mimeType: input.fileType, dataUrl: input.dataUrl }]
        : undefined,
      schemaName: "contact_extraction",
      schema: objectSchema({
        lineOfBusiness: { type: "string", enum: ["personal", "commercial", ""] },
        businessName: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        assetType: { type: "string", enum: [...ASSET_TYPES, ""] },
        estimatedValue: { type: "number" },
        notes: { type: "string" },
        summary: { type: "string" },
        confidence: { type: "number" },
        sources: STRING_ARRAY_SCHEMA,
      }),
      quality: "advanced",
      maxOutputTokens: 1_200,
    });
  } catch {
    json = {};
  }
  const record = isRecord(json) ? json : {};
  const rawLine = asString(record.lineOfBusiness);
  const lineOfBusiness = rawLine === "personal" || rawLine === "commercial" ? rawLine : undefined;
  const rawAssetType = asString(record.assetType);
  const assetType = ASSET_TYPES.includes(rawAssetType as AssetType) ? (rawAssetType as AssetType) : undefined;
  const model: Partial<ContactExtractionResult> = {
    lineOfBusiness,
    businessName: asString(record.businessName) || undefined,
    name: asString(record.name) || undefined,
    email: asString(record.email) || undefined,
    phone: asString(record.phone) || undefined,
    address: asString(record.address) || undefined,
    assetType,
    estimatedValue: Math.max(0, Math.round(asNumber(record.estimatedValue, 0))) || undefined,
    notes: asString(record.notes) || undefined,
  };
  const modelCount = contactExtractionFieldCount(model);
  const merged: ContactExtractionResult = {
    lineOfBusiness: model.lineOfBusiness ?? local.lineOfBusiness,
    businessName: model.businessName || local.businessName,
    name: model.name || local.name,
    email: model.email || local.email,
    phone: model.phone || local.phone,
    address: model.address || local.address,
    assetType: model.assetType || local.assetType,
    estimatedValue: model.estimatedValue || local.estimatedValue,
    notes: model.notes || local.notes,
    summary: modelCount > 0 ? asString(record.summary, local.summary) : local.summary,
    confidence:
      modelCount > 0
        ? clamp(asNumber(record.confidence, local.confidence), 0, 0.98)
        : local.confidence,
    sources: Array.from(
      new Set([
        ...local.sources,
        ...asStringArray(record.sources),
        ...(modelCount > 0 ? ["Server AI extraction"] : []),
      ])
    ),
  };
  return merged;
}

export async function aiExtractPolicyFromFile(input: {
  fileName: string;
  fileType?: string;
  text?: string;
  carrierNames?: string[];
}) {
  const system = domainSystem(
    "Extract policy fields from insurance declarations pages or carrier PDFs for staff review."
  );
  const user = `File name: ${input.fileName}
File type: ${input.fileType ?? "unknown"}
Known carriers: ${(input.carrierNames ?? []).join(", ") || "none"}
OCR/Text:
"""${(input.text ?? "").slice(0, 14_000)}"""

Extract policy number, carrier, premiums, effective date, renewal date, and asset hint.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "policy_extraction",
    schema: objectSchema({
      policyNumber: { type: "string" },
      carrierName: { type: "string" },
      premiumEstimate: { type: "number" },
      finalPremium: { type: "number" },
      effectiveDate: { type: "string" },
      renewalDate: { type: "string" },
      assetHint: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "number" },
      sources: STRING_ARRAY_SCHEMA,
    }),
    quality: "advanced",
    maxOutputTokens: 1_100,
  });
  const record = isRecord(json) ? json : {};
  return {
    policyNumber: asString(record.policyNumber),
    carrierName: asString(record.carrierName) || undefined,
    premiumEstimate: Math.max(0, Math.round(asNumber(record.premiumEstimate, 0))) || undefined,
    finalPremium: Math.max(0, Math.round(asNumber(record.finalPremium, 0))) || undefined,
    effectiveDate: asString(record.effectiveDate) || undefined,
    renewalDate: asString(record.renewalDate) || undefined,
    assetHint: asString(record.assetHint) || undefined,
    summary: asString(record.summary, `Extracted from "${input.fileName}". Confirm before saving.`),
    confidence: clamp(asNumber(record.confidence, 0.55), 0, 0.98),
    sources: asStringArray(record.sources).length ? asStringArray(record.sources) : [`Document: ${input.fileName}`],
  };
}

export async function aiParseCarrierAppetite(input: { fileName?: string; text?: string; carrierName?: string }) {
  const system = domainSystem(
    "Parse carrier appetite guides into a precise underwriting profile for quoting automation."
  );
  const user = `Carrier: ${input.carrierName ?? "unknown"}
File: ${input.fileName ?? "pasted text"}
Guide:
"""${(input.text ?? "").slice(0, 18_000)}"""

Return appetite rows for personal/commercial lines, allowed states, exclusions, underwriting rules, contacts, and missing fields.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "carrier_appetite",
    schema: objectSchema({
      preferredAssetTypes: STRING_ARRAY_SCHEMA,
      states: STRING_ARRAY_SCHEMA,
      appetites: {
        type: "array",
        items: objectSchema({
          line: { type: "string", enum: ["personal", "commercial"] },
          assetType: { type: "string" },
          minValue: { type: "number" },
          maxValue: { type: "number" },
          riskLevels: STRING_ARRAY_SCHEMA,
          pricingTendency: { type: "number" },
        }),
      },
      restrictedRisks: STRING_ARRAY_SCHEMA,
      appetiteNotes: { type: "string" },
      tendencyNotes: { type: "string" },
      underwritingRules: { type: "string" },
      contactEmails: STRING_ARRAY_SCHEMA,
      missingFields: STRING_ARRAY_SCHEMA,
      confidence: { type: "number" },
    }),
    quality: "maximum",
    maxOutputTokens: 2_800,
  });
  const record = isRecord(json) ? json : {};
  return {
    preferredAssetTypes: asStringArray(record.preferredAssetTypes).map(asAssetType),
    states: asStringArray(record.states),
    appetites: asObjectArray(record.appetites).map((row) => ({
      line: row.line === "commercial" ? "commercial" : "personal",
      assetType: asAssetType(row.assetType),
      minValue: Math.max(0, Math.round(asNumber(row.minValue, 0))) || undefined,
      maxValue: Math.max(0, Math.round(asNumber(row.maxValue, 0))) || undefined,
      riskLevels: asStringArray(row.riskLevels),
      pricingTendency: clamp(asNumber(row.pricingTendency, 1), 0.5, 1.8),
    })),
    restrictedRisks: asStringArray(record.restrictedRisks),
    appetiteNotes: asString(record.appetiteNotes),
    tendencyNotes: asString(record.tendencyNotes),
    underwritingRules: asString(record.underwritingRules),
    contactEmails: asStringArray(record.contactEmails),
    missingFields: asStringArray(record.missingFields),
    confidence: clamp(asNumber(record.confidence, 0.55), 0, 0.98),
  };
}

type AcordMapSourceKind =
  | "agent_seed"
  | "client_intake"
  | "validated_address"
  | "public_geocoder"
  | "public_web"
  | "government_api"
  | "commercial_provider"
  | "carrier_api";

interface AcordMapField {
  id?: string;
  label: string;
  acordFieldLabels?: string[];
  acordFieldKey?: string;
  required?: boolean;
  kind?: string;
  page?: number;
}

interface AcordMapping {
  targetId?: string;
  targetField: string;
  value: string;
  sourceLabel: string;
  sourceKind: AcordMapSourceKind;
  confidence: number;
  verified: boolean;
  rationale: string;
}

const ACORD_MAP_SOURCE_KINDS: AcordMapSourceKind[] = [
  "agent_seed",
  "client_intake",
  "validated_address",
  "public_geocoder",
  "public_web",
  "government_api",
  "commercial_provider",
  "carrier_api",
];

function asAcordMapSourceKind(value: unknown): AcordMapSourceKind {
  return ACORD_MAP_SOURCE_KINDS.includes(value as AcordMapSourceKind)
    ? (value as AcordMapSourceKind)
    : "client_intake";
}

function isUnsafeAcordAiTarget(label: string): boolean {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (normalized.length > 180) return true;
  if (normalized.includes("?")) return true;
  if (/\b(any|does|do|is|are|has|have)\b.+\b(if so|identify|explain|describe|details?)\b/.test(normalized)) {
    return true;
  }
  if (/\bexplain all\b|\byes responses?\b|\bremarks?\b|\bdetails?\b/.test(normalized)) return true;
  if (/\bfax\b|\bsecondary\b|\balternate\b/.test(normalized)) return true;
  if (/\bssn\b|\bsocial security\b/.test(normalized)) return true;
  return false;
}

function isSafeQuestionnairePrefillTarget(label: string): boolean {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized || isUnsafeAcordAiTarget(normalized)) return false;
  if (/\b(loss|claim|incident|conviction|violation|mvr|bankruptcy|cancel|nonrenew|audit|payroll|revenue|sales|fein|tax id|ssn)\b/.test(normalized)) {
    return false;
  }
  return /\b(legal business name|business name|named insured|name of insured|applicant name|dba|doing business as|mailing address|property address|risk address|location address|premises address|city|state|zip|postal|phone|email|website|business description|operations|entity type|year started|years in business|naics|sic)\b/.test(normalized);
}

function cleanAcordAiValue(value: unknown): string {
  return asString(value)
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 240);
}

function parseAcordMappings(record: Record<string, unknown>): {
  mappings: AcordMapping[];
  missingFields: string[];
  webSources: { title: string; url: string; field: string }[];
  summary: string;
  confidence: number;
} {
  const mappings = asObjectArray(record.mappings)
    .map((row): AcordMapping | null => {
      const targetField = asString(row.targetField);
      const value = cleanAcordAiValue(row.value);
      const confidence = clamp(asNumber(row.confidence, 0), 0, 1);
      const verified = row.verified === true;
      if (!targetField || !value || !verified || confidence < 0.84) return null;
      if (isUnsafeAcordAiTarget(targetField)) return null;
      return {
        targetId: asString(row.targetId) || undefined,
        targetField,
        value,
        sourceLabel: asString(row.sourceLabel, "Verified Quotex AI mapping"),
        sourceKind: asAcordMapSourceKind(row.sourceKind),
        confidence,
        verified,
        rationale: asString(row.rationale),
      };
    })
    .filter((item): item is AcordMapping => item !== null);
  return {
    mappings,
    missingFields: asStringArray(record.missingFields).filter((field) => !isUnsafeAcordAiTarget(field)),
    webSources: asObjectArray(record.webSources)
      .map((row) => ({
        title: asString(row.title),
        url: asString(row.url),
        field: asString(row.field),
      }))
      .filter((row) => row.title || row.url || row.field)
      .slice(0, 12),
    summary: asString(record.summary, `Mapped ${mappings.length} verified ACORD field${mappings.length === 1 ? "" : "s"}.`),
    confidence: clamp(asNumber(record.confidence, mappings.length > 0 ? 0.84 : 0.4), 0, 1),
  };
}

export async function aiMapAcordFields(input: {
  template?: { documentName?: string; fileName?: string; formNumber?: string };
  fields: AcordMapField[];
  dossier: Record<string, unknown>;
  intent?: "document_autofill" | "questionnaire_prefill";
}) {
  const intent = input.intent ?? "document_autofill";
  const safeFields = input.fields
    .filter((field) => asString(field.label) && !isUnsafeAcordAiTarget(field.label))
    .slice(0, 260)
    .map((field) => ({
      id: asString(field.id),
      label: asString(field.label),
      acordFieldKey: asString(field.acordFieldKey) || undefined,
      acordFieldLabels: asStringArray(field.acordFieldLabels)
        .filter((label) => !isUnsafeAcordAiTarget(label))
        .slice(0, 12),
      required: field.required === true,
      kind: asString(field.kind, "text"),
      page: Math.max(0, Math.round(asNumber(field.page, 0))),
    }));
  if (safeFields.length === 0) {
    return { mappings: [], missingFields: [], webSources: [], summary: "No safe ACORD fields were available to map.", confidence: 0 };
  }
  const templateLabel = [
    input.template?.formNumber,
    input.template?.documentName,
    input.template?.fileName,
  ].filter(Boolean).join(" - ") || "selected ACORD document";
  const system = [
    domainSystem("Map verified client/agency/public data into exact ACORD PDF field labels."),
    "You are an ACORD document mapping specialist for insurance agencies.",
    intent === "questionnaire_prefill"
      ? "You are filling an editable commercial questionnaire before final document review. Use web search to find source-backed public facts such as business identity, public contact details, address normalization, public operations description, entity type, NAICS/SIC, or years in business."
      : "You may use web search only to verify public facts such as business registration, property address normalization, or public building/location facts.",
    intent === "questionnaire_prefill"
      ? "Do not guess private underwriting facts. If a public source supports a safe identity/contact/address/operations answer but is not official enough for final document writing, return it with verified=false, sourceKind=public_web, and confidence between 0.60 and 0.83 so the UI can prefill it for review only."
      : "Never guess. If a fact is not explicitly supplied or publicly verified, omit the mapping and list the field as missing.",
    "Map only into the exact targetField labels supplied by the application.",
    "If a target has acordFieldLabels, use the most specific atomic label from that list as targetField and keep the parent id as targetId.",
    "When a supplied target field includes an id, return that exact id as targetId. Do not invent targetId values.",
    "Do not fill yes/no prompts, explanation boxes, remarks boxes, fax fields, secondary email/phone fields, SSN fields, or any field that asks a conditional question unless the dossier contains a direct explicit answer.",
    intent === "questionnaire_prefill"
      ? "Never fill claims/losses, violations, MVR, revenue, payroll, FEIN/tax ID, or prior coverage answers from general web research."
      : "Every returned mapping must cite a sourceLabel and use a sourceKind from the allowed enum.",
  ].join(" ");
  const user = [
    `Template: ${templateLabel}`,
    `Allowed target fields:\n${JSON.stringify(safeFields).slice(0, 18_000)}`,
    `Quotex dossier:\n${JSON.stringify(input.dossier).slice(0, 45_000)}`,
    "Return only verified field mappings. Leave doubtful fields blank.",
  ].join("\n\n");
  const schema = objectSchema({
    summary: { type: "string" },
    confidence: { type: "number" },
    mappings: {
      type: "array",
      items: objectSchema({
        targetId: { type: "string" },
        targetField: { type: "string" },
        value: { type: "string" },
        sourceLabel: { type: "string" },
        sourceKind: { type: "string", enum: ACORD_MAP_SOURCE_KINDS },
        confidence: { type: "number" },
        verified: { type: "boolean" },
        rationale: { type: "string" },
      }),
    },
    missingFields: STRING_ARRAY_SCHEMA,
    webSources: {
      type: "array",
      items: objectSchema({
        title: { type: "string" },
        url: { type: "string" },
        field: { type: "string" },
      }),
    },
  });
  const complete = async (withWebSearch: boolean) =>
    provider.completeJson({
      system,
      user,
      schemaName: "acord_field_mapping",
      schema,
      quality: "maximum",
      reasoningEffort: "high",
      maxOutputTokens: 4_000,
      tools: withWebSearch ? [{ type: "web_search" }] : undefined,
      toolChoice: withWebSearch ? "required" : undefined,
    });
  let raw: unknown;
  try {
    raw = await complete(true);
  } catch (error) {
    if (intent === "questionnaire_prefill") {
      return {
        mappings: [],
        missingFields: safeFields.map((field) => field.label),
        webSources: [],
        summary:
          error instanceof Error
            ? `OpenAI web search could not complete questionnaire prefill: ${error.message}`
            : "OpenAI web search could not complete questionnaire prefill.",
        confidence: 0,
      };
    }
    raw = await complete(false);
  }
  const record = isRecord(raw) ? raw : {};
  if (intent !== "questionnaire_prefill") return parseAcordMappings(record);
  const relaxedMappings = asObjectArray(record.mappings)
    .map((row): AcordMapping | null => {
      const targetField = asString(row.targetField);
      const value = cleanAcordAiValue(row.value);
      const confidence = clamp(asNumber(row.confidence, 0), 0, 1);
      const sourceKind = asAcordMapSourceKind(row.sourceKind);
      const verified = row.verified === true;
      const documentReady = verified && confidence >= 0.84 && sourceKind !== "public_web";
      const reviewReady =
        confidence >= 0.6 &&
        (sourceKind === "public_web"
          ? isSafeQuestionnairePrefillTarget(targetField)
          : verified);
      if (!targetField || !value || isUnsafeAcordAiTarget(targetField)) return null;
      if (!documentReady && !reviewReady) return null;
      if (!documentReady && !isSafeQuestionnairePrefillTarget(targetField)) return null;
      return {
        targetId: asString(row.targetId) || undefined,
        targetField,
        value,
        sourceLabel: asString(row.sourceLabel, "Source-backed Quotex AI questionnaire prefill"),
        sourceKind,
        confidence,
        verified,
        rationale: asString(row.rationale),
      };
    })
    .filter((item): item is AcordMapping => item !== null);
  return {
    mappings: relaxedMappings,
    missingFields: asStringArray(record.missingFields).filter((field) => !isUnsafeAcordAiTarget(field)),
    webSources: asObjectArray(record.webSources)
      .map((row) => ({
        title: asString(row.title),
        url: asString(row.url),
        field: asString(row.field),
      }))
      .filter((row) => row.title || row.url || row.field)
      .slice(0, 12),
    summary: asString(
      record.summary,
      `Mapped ${relaxedMappings.length} source-backed questionnaire field${
        relaxedMappings.length === 1 ? "" : "s"
      }.`
    ),
    confidence: clamp(asNumber(record.confidence, relaxedMappings.length > 0 ? 0.72 : 0.4), 0, 1),
  };
}

type PublicDataFieldSourceKind =
  | "agent_seed"
  | "client_intake"
  | "validated_address"
  | "public_geocoder"
  | "government_api"
  | "commercial_provider"
  | "carrier_api"
  | "model_estimate"
  | "unknown";

interface PublicDataFieldEvidence {
  fieldKey: string;
  sourceKind: PublicDataFieldSourceKind;
  sourceLabel: string;
  confidence: number;
  verified: boolean;
  allowDocumentAutofill: boolean;
  collectedAt: string;
  notes?: string;
}

type PublicDataEvidenceMap = Record<string, PublicDataFieldEvidence>;

interface AiAssetEnrichment {
  fields: Record<string, unknown>;
  evidence?: PublicDataEvidenceMap;
  sources: string[];
  confidence: number;
  unavailableFields?: string[];
  notes?: string;
}

interface ServerGeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  provider: "google" | "census";
}

function evidence(
  fieldKey: string,
  sourceKind: PublicDataFieldSourceKind,
  sourceLabel: string,
  input: { confidence: number; verified: boolean; allowDocumentAutofill: boolean; notes?: string }
): PublicDataFieldEvidence {
  return {
    fieldKey,
    sourceKind,
    sourceLabel,
    confidence: clamp(input.confidence, 0, 1),
    verified: input.verified,
    allowDocumentAutofill: input.allowDocumentAutofill,
    collectedAt: new Date().toISOString(),
    notes: input.notes,
  };
}

function markEvidence(
  map: PublicDataEvidenceMap,
  fieldKey: string,
  sourceKind: PublicDataFieldSourceKind,
  sourceLabel: string,
  input: { confidence: number; verified: boolean; allowDocumentAutofill: boolean; notes?: string }
) {
  map[fieldKey] = evidence(fieldKey, sourceKind, sourceLabel, input);
}

function fieldText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function googleGeocodeKey(): string {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.GOOGLE_PLACES_API_KEY ??
    process.env.VITE_GOOGLE_MAPS_API_KEY ??
    process.env.VITE_GOOGLE_PLACES_API_KEY ??
    ""
  );
}

async function geocodeViaGoogleServer(address: string): Promise<ServerGeocodeResult | null> {
  const key = googleGeocodeKey();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat?: number; lng?: number } }; formatted_address?: string }[];
    };
    const first = data.status === "OK" ? data.results?.[0] : undefined;
    const lat = first?.geometry?.location?.lat;
    const lon = first?.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    return { lat, lon, displayName: first?.formatted_address ?? address, provider: "google" };
  } catch {
    return null;
  }
}

async function geocodeViaCensusServer(address: string): Promise<ServerGeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { addressMatches?: { matchedAddress?: string; coordinates?: { x?: number; y?: number } }[] };
    };
    const match = data.result?.addressMatches?.[0];
    const x = match?.coordinates?.x;
    const y = match?.coordinates?.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    return { lat: y, lon: x, displayName: match?.matchedAddress ?? address, provider: "census" };
  } catch {
    return null;
  }
}

async function geocodeAddressServer(address: string): Promise<ServerGeocodeResult | null> {
  return (await geocodeViaGoogleServer(address)) ?? (await geocodeViaCensusServer(address));
}

async function fetchFemaFloodZoneServer(lat: number, lon: number): Promise<{ zone: string; subtype?: string } | null> {
  const url = new URL("https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query");
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: { attributes?: { FLD_ZONE?: string; ZONE_SUBTY?: string } }[];
    };
    const attr = data.features?.[0]?.attributes;
    return attr?.FLD_ZONE ? { zone: attr.FLD_ZONE, subtype: attr.ZONE_SUBTY } : null;
  } catch {
    return null;
  }
}

async function decodeVinViaNhtsaServer(vin: string): Promise<Record<string, string> | null> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { Results?: { Variable?: string; Value?: string | null }[] };
    const get = (variable: string) => fieldText(data.Results?.find((row) => row.Variable === variable)?.Value);
    return {
      year: get("Model Year"),
      make: get("Make"),
      model: get("Model"),
      bodyClass: get("Body Class"),
      errorCode: get("Error Code"),
    };
  } catch {
    return null;
  }
}

async function aiEstimateAssetSignals(assetType: AssetType, seed: Record<string, unknown>) {
  const json = await provider.completeJson({
    system: domainSystem(
      "Review sparse insurance asset intake and return estimate-only public-data signals. Never claim a field is verified unless the supplied facts prove it."
    ),
    user: `Asset type: ${assetType}
Seed:
${JSON.stringify(seed).slice(0, 8_000)}

Return only useful underwriting signals that can help preliminary quote ranking. These are not verified public records and must not be used to fill ACORD document fields unless another verified source confirms them.`,
    schemaName: "asset_signal_estimates",
    schema: objectSchema({
      fieldEntries: {
        type: "array",
        items: objectSchema({
          key: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number" },
          notes: { type: "string" },
        }),
      },
      unavailableFields: STRING_ARRAY_SCHEMA,
      notes: { type: "string" },
    }),
    quality: "maximum",
    maxOutputTokens: 1_400,
  });
  const record = isRecord(json) ? json : {};
  return {
    entries: asObjectArray(record.fieldEntries).map((entry) => ({
      key: asString(entry.key),
      value: asString(entry.value),
      confidence: clamp(asNumber(entry.confidence, 0.4), 0, 0.7),
      notes: asString(entry.notes),
    })),
    unavailableFields: asStringArray(record.unavailableFields),
    notes: asString(record.notes),
  };
}

async function enrichCoastalHomeServer(seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  const address = fieldText(seed.address ?? seed.propertyAddress ?? seed.riskAddress);
  if (!address) {
    return { fields: {}, sources: [], confidence: 0, notes: "Property address is required for public lookup." };
  }

  const fields: Record<string, unknown> = {};
  const sourceEvidence: PublicDataEvidenceMap = {};
  const sources: string[] = [];
  const unavailableFields = new Set<string>(["windMitigation"]);
  const geo = await geocodeAddressServer(address);

  if (geo) {
    const geocoderLabel = geo.provider === "google" ? "Google Geocoding API" : "US Census Geocoder";
    fields.address = geo.displayName;
    sources.push(geocoderLabel);
    markEvidence(
      sourceEvidence,
      "address",
      geo.provider === "census" ? "government_api" : "public_geocoder",
      geocoderLabel,
      {
        confidence: geo.provider === "census" ? 0.9 : 0.86,
        verified: true,
        allowDocumentAutofill: true,
        notes: "Normalized property address from geocoding response.",
      }
    );

    const flood = await fetchFemaFloodZoneServer(geo.lat, geo.lon);
    if (flood) {
      fields.floodZone = flood.zone;
      sources.push("FEMA National Flood Hazard Layer (NFHL)");
      markEvidence(sourceEvidence, "floodZone", "government_api", "FEMA National Flood Hazard Layer (NFHL)", {
        confidence: 0.96,
        verified: true,
        allowDocumentAutofill: true,
        notes: flood.subtype ? `Zone subtype: ${flood.subtype}` : undefined,
      });
    } else {
      unavailableFields.add("floodZone");
    }
  } else {
    sources.push("Geocoder (no match)");
    unavailableFields.add("address");
    unavailableFields.add("floodZone");
  }

  const aiSignals = await aiEstimateAssetSignals("coastal_home", { ...seed, normalizedAddress: fields.address });
  for (const entry of aiSignals.entries) {
    if (!entry.key || !entry.value || fields[entry.key] != null) continue;
    fields[entry.key] = entry.value;
    markEvidence(sourceEvidence, entry.key, "model_estimate", "AI public-data sweep estimate", {
      confidence: entry.confidence,
      verified: false,
      allowDocumentAutofill: false,
      notes: entry.notes || "Estimate-only signal for preliminary quote ranking.",
    });
  }
  aiSignals.unavailableFields.forEach((field) => unavailableFields.add(field));

  return {
    fields,
    evidence: sourceEvidence,
    sources,
    confidence: geo ? 0.78 : 0.25,
    unavailableFields: Array.from(unavailableFields),
    notes:
      aiSignals.notes ||
      "Verified fields came from geocoding and FEMA. Estimate-only fields are held out of ACORD autofill until verified by a public-record provider or client response.",
  };
}

async function enrichLuxuryVehicleServer(seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  const vin = normalizeVin(seed.vin);
  const fields: Record<string, unknown> = {};
  const sourceEvidence: PublicDataEvidenceMap = {};
  const unavailableFields = new Set<string>(["estimatedValue"]);
  const vinIssue = vinValidationIssue(vin);
  if (vinIssue) {
    return {
      fields,
      evidence: sourceEvidence,
      sources: [],
      confidence: 0,
      unavailableFields: ["vin", "year", "make", "model", "estimatedValue"],
      notes: vinIssue,
    };
  }

  const decoded = await decodeVinViaNhtsaServer(vin);
  if (!decoded) {
    return {
      fields,
      evidence: sourceEvidence,
      sources: ["NHTSA VIN decoder (request failed)"],
      confidence: 0,
      unavailableFields: ["year", "make", "model", "estimatedValue"],
      notes: "NHTSA VIN decoder was unavailable.",
    };
  }

  const clean = decoded.errorCode === "0" || decoded.errorCode === "";
  (["year", "make", "model", "bodyClass"] as const).forEach((key) => {
    const value = decoded[key];
    if (!value) {
      unavailableFields.add(key);
      return;
    }
    fields[key] = key === "year" ? Number(value) || value : value;
    markEvidence(sourceEvidence, key, "government_api", "NHTSA VIN decoder (vpic.nhtsa.dot.gov)", {
      confidence: clean ? 0.95 : 0.6,
      verified: clean,
      allowDocumentAutofill: clean,
      notes: clean ? `Decoded from VIN ${vin}.` : `Partial NHTSA decode; error code ${decoded.errorCode || "unknown"}.`,
    });
  });
  markEvidence(sourceEvidence, "vin", "client_intake", "Client-entered VIN", {
    confidence: 0.9,
    verified: clean,
    allowDocumentAutofill: clean,
    notes: clean ? "VIN accepted by NHTSA decoder." : "VIN should be reviewed before binding.",
  });

  return {
    fields,
    evidence: sourceEvidence,
    sources: ["NHTSA VIN decoder (vpic.nhtsa.dot.gov)"],
    confidence: clean ? 0.95 : 0.6,
    unavailableFields: Array.from(unavailableFields),
    notes: clean
      ? "VIN decoded from the federal NHTSA database. Market valuation still requires a vehicle valuation provider."
      : "NHTSA returned partial VIN results; review before document autofill.",
  };
}

function normalizeVin(value: unknown): string {
  return fieldText(value).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function vinValidationIssue(vin: string): string | null {
  if (!vin) return "A VIN is required for federal vehicle lookup.";
  if (/[IOQ]/.test(vin)) return "VIN contains I, O, or Q, which are not valid in standard VINs.";
  if (vin.length !== 17) return "A standard 17-character VIN is required before Quotex decodes vehicle records.";
  return null;
}

async function enrichEstimateOnlyAssetServer(assetType: AssetType, seed: Record<string, unknown>): Promise<AiAssetEnrichment> {
  const aiSignals = await aiEstimateAssetSignals(assetType, seed);
  const fields: Record<string, unknown> = {};
  const sourceEvidence: PublicDataEvidenceMap = {};
  for (const entry of aiSignals.entries) {
    if (!entry.key || !entry.value) continue;
    fields[entry.key] = entry.value;
    markEvidence(sourceEvidence, entry.key, "model_estimate", "AI public-data sweep estimate", {
      confidence: entry.confidence,
      verified: false,
      allowDocumentAutofill: false,
      notes: entry.notes || "Estimate-only signal for preliminary quote ranking.",
    });
  }
  return {
    fields,
    evidence: sourceEvidence,
    sources: fields && Object.keys(fields).length > 0 ? ["AI public-data sweep estimate"] : [],
    confidence: fields && Object.keys(fields).length > 0 ? 0.45 : 0,
    unavailableFields: aiSignals.unavailableFields,
    notes:
      aiSignals.notes ||
      "This asset type has no configured authoritative public source yet, so returned AI signals are estimate-only and blocked from ACORD autofill.",
  };
}

export async function aiEnrichAsset(input: { assetType: string; seed: Record<string, unknown> }): Promise<AiAssetEnrichment> {
  const assetType = asAssetType(input.assetType);
  const seed = isRecord(input.seed) ? input.seed : {};
  if (assetType === "coastal_home") return enrichCoastalHomeServer(seed);
  if (assetType === "luxury_vehicle") return enrichLuxuryVehicleServer(seed);
  return enrichEstimateOnlyAssetServer(assetType, seed);
}

export async function aiDraftCampaign(input: {
  prompt: string;
  agencyName?: string;
  senderName?: string;
  signOff?: string;
  fallback?: unknown;
}) {
  const system = domainSystem(
    "Act as a world-class high-ticket private-client insurance marketing strategist, conversion copywriter, and compliance reviewer. Turn a manager brief into an executable campaign."
  );
  const user = `Manager brief:
"""${input.prompt.slice(0, 8_000)}"""

Agency: ${input.agencyName ?? "the agency"}
Sender: ${input.senderName ?? "the agency team"}
Sign-off: ${input.signOff ?? "Warm regards,"}
Fallback shape:
${JSON.stringify(input.fallback ?? {}).slice(0, 4_000)}

Build a campaign that fully executes the intent of the brief, not a generic insurance note.
Requirements:
- First infer the true campaign job: quote completion, storm prep, renewal, auto schedule cleanup, valuables/appraisal, excess liability, billing, onboarding, or annual portfolio review.
- Subject must be specific, emotionally intelligent, and under 90 characters.
- Body must feel human, useful, and premium; include {first_name} when writing email.
- The body must contain one strong insight, 3 concrete items the agency will check, and one unmistakable next step.
- Choose valid channels only: email, sms.
- Choose valid audience keys only: all_clients, all_prospects, auto_clients, coastal_home_clients, high_value_clients, renewal_clients.
- SMS copy must be under 320 characters and include STOP opt-out.
- Email copy must include a soft opt-out sentence and the supplied sign-off.
- Never promise discounts, coverage, approvals, savings, claim outcomes, or binding.
- Do not say "we value your business" or "reach out with questions" as the main substance.
- Summary must explain what strategy the AI chose and why.
- Pamphlet description must describe the digital pamphlet strategy, not the email.
- Image prompt must describe the exact editorial photograph that should appear on the pamphlet. It must visually match the manager's prompt. Do not default to generic insurance paperwork, office handshakes, clip art, logos, text, or carrier forms.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "campaign_draft",
    schema: objectSchema({
      name: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      channels: STRING_ARRAY_SCHEMA,
      audience: STRING_ARRAY_SCHEMA,
      recurrence: { type: "string" },
      summary: { type: "string" },
      pamphletDescription: { type: "string" },
      imagePrompt: { type: "string" },
    }),
    quality: "maximum",
    maxOutputTokens: 3_200,
  });
  return isRecord(json) ? json : {};
}

export async function aiMarketingCreative(input: {
  prompt: string;
  agencyName?: string;
  senderName?: string;
  signOff?: string;
}) {
  const system = [
    domainSystem(
      "Operate as an elite ChatGPT-class marketing strategist for high-end private-client and commercial insurance agencies."
    ),
    "You are not a template engine. You are a strategic creative director, campaign planner, copy chief, and image director.",
    "The manager gives one rough prompt. You infer the real business objective and produce one complete executable campaign plus one digital pamphlet concept.",
    "You may only discuss insurance-agency marketing. If the prompt is unrelated, convert it into the closest legitimate insurance marketing campaign or state the compliant marketing angle.",
    "Use only safe insurance language. Never promise coverage, savings, discounts, claims outcomes, approval, binding, or legal advice.",
    "Return JSON only.",
  ].join(" ");
  const user = `Manager prompt:
"""${input.prompt.slice(0, 10_000)}"""

Agency: ${input.agencyName ?? "the agency"}
Sender: ${input.senderName ?? "the agency team"}
Sign-off: ${input.signOff ?? "Warm regards,"}

Create the campaign as if the manager were talking to the best possible ChatGPT marketing partner.

Required behavior:
- Deeply interpret the prompt, including niche commercial or private-client risks.
- If the manager asks for a digital pamphlet, the pamphlet must be the creative center of the output, not an afterthought.
- The email body must be polished, specific, and useful. It must include {first_name}, one insight, what the agency will review, and a clear next step.
- The SMS body must be a separate concise companion message under 320 characters with STOP opt-out.
- Pick only valid channels: email, sms.
- Pick only valid audience keys: all_clients, all_prospects, auto_clients, coastal_home_clients, high_value_clients, renewal_clients.
- Pick only valid recurrence: none, daily, weekly, monthly.
- The pamphlet must read like a premium digital pamphlet, not an email summary.
- The image prompt must describe a real editorial photograph matching the exact subject of the manager prompt. Do not use generic paperwork, handshakes, forms, logos, text, or clip art.

Return exactly:
{
  "campaignName": "string",
  "strategy": "string",
  "channels": ["email" | "sms"],
  "audience": ["all_clients" | "all_prospects" | "auto_clients" | "coastal_home_clients" | "high_value_clients" | "renewal_clients"],
  "recurrence": "none" | "daily" | "weekly" | "monthly",
  "emailSubject": "string under 90 characters",
  "emailBody": "string",
  "smsBody": "string under 320 characters",
  "pamphlet": {
    "eyebrow": "string, 2-5 words",
    "headline": "string, strong pamphlet headline",
    "subheadline": "string",
    "intro": "string, 50-100 words",
    "highlightsTitle": "string",
    "highlights": ["3-5 benefit-focused strings"],
    "ctaTitle": "string",
    "ctaButton": "string, 2-5 words",
    "imagePrompt": "string, exact editorial photograph direction"
  }
}`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "marketing_creative_studio",
    schema: objectSchema({
      campaignName: { type: "string" },
      strategy: { type: "string" },
      channels: STRING_ARRAY_SCHEMA,
      audience: STRING_ARRAY_SCHEMA,
      recurrence: { type: "string" },
      emailSubject: { type: "string" },
      emailBody: { type: "string" },
      smsBody: { type: "string" },
      pamphlet: objectSchema({
        eyebrow: { type: "string" },
        headline: { type: "string" },
        subheadline: { type: "string" },
        intro: { type: "string" },
        highlightsTitle: { type: "string" },
        highlights: STRING_ARRAY_SCHEMA,
        ctaTitle: { type: "string" },
        ctaButton: { type: "string" },
        imagePrompt: { type: "string" },
      }),
    }),
    quality: "maximum",
    maxOutputTokens: 4_500,
  });
  return isRecord(json) ? json : {};
}

export async function aiDraftPamphlet(input: {
  prompt: string;
  agencyName?: string;
  campaignDescription?: string;
  heroImagePrompt?: string;
  accent?: string;
  tone?: string;
}) {
  const system = domainSystem(
    "Act as a luxury private-client insurance creative director, pamphlet strategist, copywriter, and image director."
  );
  const user = `Campaign brief: ${input.prompt.slice(0, 8_000)}
Agency name: ${input.agencyName ?? "Your Agency"}
Campaign strategy: ${input.campaignDescription ?? "Infer the strongest strategy from the brief."}
Preferred image direction: ${input.heroImagePrompt ?? "Infer a precise editorial photograph from the brief."}
Accent/theme: ${input.accent ?? "generic"}
Tone: ${input.tone ?? "refined"}

Create hero, four highlights, CTA, and an editorial image prompt that matches the subject.
Rules:
- Treat the manager brief like a high-context ChatGPT prompt. Understand intent even if the wording is rough.
- The pamphlet copy must feel like a top-tier marketing strategist wrote it for private-client insurance.
- The imagePrompt must depict the exact subject of the brief and campaign strategy, not generic insurance paperwork.
- Never invent carrier approvals, binding status, pricing, savings, legal advice, or claim outcomes.
- Use concise, premium, action-oriented language.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "pamphlet_copy",
    schema: objectSchema({
      hero: objectSchema({
        eyebrow: { type: "string" },
        headline: { type: "string" },
        subheadline: { type: "string" },
        intro: { type: "string" },
      }),
      highlights: objectSchema({
        title: { type: "string" },
        items: {
          type: "array",
          items: objectSchema({ icon: { type: "string" }, label: { type: "string" } }),
        },
      }),
      cta: objectSchema({
        title: { type: "string" },
        highlight: { type: "string" },
        button: { type: "string" },
      }),
      imagePrompt: { type: "string" },
    }),
    quality: "maximum",
    maxOutputTokens: 3_000,
  });
  return isRecord(json) ? json : {};
}

export async function aiPortalAssistant(input: {
  question: string;
  role?: string;
  history?: unknown[];
  localAnswer: string;
  knowledge: string;
}) {
  const system = domainSystem(
    "Answer as a senior Quotex portal support specialist for a private-client insurance SaaS."
  );
  const user = `User role: ${input.role ?? "staff"}
User question:
"""${input.question.slice(0, 3_000)}"""

Recent conversation:
${JSON.stringify(input.history ?? []).slice(0, 4_000)}

Local grounded answer:
"""${input.localAnswer.slice(0, 6_000)}"""

Portal knowledge:
"""${input.knowledge.slice(0, 12_000)}"""

Rewrite or synthesize the best answer for an agent or manager who is using the live portal.
Rules:
- Be direct, calm, and step-by-step when the user asks how to do something.
- Prefer exact screens, button names, and workflow names from the supplied knowledge.
- If the question spans multiple areas, organize the answer by workflow in the order the user should try it.
- Ground every statement in the supplied portal knowledge or local answer.
- If the local answer contains live data, preserve the numbers exactly.
- Do not invent UI controls, automations, integrations, permissions, or live data not present in the supplied knowledge.
- If the supplied knowledge is not enough, say what is not confirmed and where the user should check inside Quotex.`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "portal_assistant_answer",
    schema: objectSchema({
      text: { type: "string" },
      related: STRING_ARRAY_SCHEMA,
    }),
    quality: "maximum",
    maxOutputTokens: 2_400,
  });
  const record = isRecord(json) ? json : {};
  return {
    text: asString(record.text, input.localAnswer),
    related: asStringArray(record.related),
  };
}

export async function aiSortIntent(input: { query: string; context?: string }) {
  const query = input.query.trim().slice(0, 500);
  const system = domainSystem(
    "Normalize a natural-language Quotex list filter into concise deterministic filter terms."
  );
  const user = `The Quotex UI already has deterministic filter logic. Convert the user's wording into a short filter phrase using only terms the deterministic matcher understands.

Supported ideas include: active, inactive, assigned, unassigned, bound, renewals, open claims, closed claims, no policies, missing info, missing email, missing account, email opt in, sms opt in, opted out, needs follow up, needs review, new, contacted, quote, abandoned, nurturing, converted, lost, paused, pending, due soon, past due, direct bill, agency bill, premium finance, carrier autopay, mortgagee escrow, unreconciled, waiting, submitted, approved, declined, personal, commercial, mortgagee, lienholder, certificate holder, additional insured, named insured, beneficiary, high value, and money filters like "over 1m".

Rules:
- Preserve proper names, carrier names, asset names, and numbers.
- Do not invent a filter condition the user did not ask for.
- If the original query is already clear, return it cleaned up.
- Return a short phrase, not an explanation.

Context: ${input.context ?? "general Quotex list"}
User filter: "${query}"`;
  const json = await provider.completeJson({
    system,
    user,
    schemaName: "sort_intent",
    schema: objectSchema({
      normalizedQuery: { type: "string" },
      confidence: { type: "number" },
    }),
    quality: "fast",
    maxOutputTokens: 400,
  });
  const record = isRecord(json) ? json : {};
  const normalized = asString(record.normalizedQuery, query)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return {
    normalizedQuery: normalized || query,
    confidence: clamp(asNumber(record.confidence, normalized ? 0.75 : 0.4), 0, 0.99),
  };
}

function fallbackCarrier(
  assetType: string,
  carriers: { id: string; name: string; preferredAssetTypes: string[]; appetiteNotes?: string }[]
) {
  const normalized = asAssetType(assetType);
  return (
    carriers.find((c) => c.preferredAssetTypes.includes(normalized)) ??
    carriers[0]
  );
}

function enforceOptOut(body: string, channel: "email" | "sms"): string {
  if (channel === "sms") {
    return /\bstop\b/i.test(body) ? body : `${body}\n\nReply STOP to opt out.`;
  }
  return /(unsubscribe|prefer not to receive|opt out)/i.test(body)
    ? body
    : `${body}\n\nIf you would prefer not to receive follow-ups, reply and I will update your preferences.`;
}
