import { getQuotexAiAgent } from "./agents.js";

type Base44Field = {
  id: string;
  label: string;
  acordFieldKey?: string;
  acordFieldLabels?: string[];
  required?: boolean;
  kind?: string;
  page?: number;
};

const BASE44_MAX_MESSAGE_CHARS = 7_850;
const DEFAULT_TIMEOUT_MS = 50_000;

const REDACTED = "[redacted]";

export function base44Configured(): boolean {
  return Boolean(base44BaseUrl() && base44ApiKey());
}

export function base44PublicSweepMode(): "primary" | "fallback" | "off" {
  const mode = env("BASE44_PUBLIC_SWEEP_MODE")?.toLowerCase();
  if (mode === "fallback" || mode === "off") return mode;
  return "primary";
}

export async function base44AcordQuestionnairePrefill(input: {
  templateLabel: string;
  fields: Base44Field[];
  dossier: Record<string, unknown>;
}): Promise<unknown> {
  if (!base44Configured()) {
    throw new Error("Base44 public-data sweep is not configured.");
  }

  const message = buildAcordQuestionnairePrompt(input);
  const conversation = await createConversation();
  const response = await sendMessage(conversation.id, message);
  return normalizeBase44QuestionnaireRecord(parseJsonFromText(response), input.fields);
}

function buildAcordQuestionnairePrompt(input: {
  templateLabel: string;
  fields: Base44Field[];
  dossier: Record<string, unknown>;
}): string {
  const fields = input.fields.slice(0, 120).map((field) => ({
    targetId: field.id,
    label: field.label,
    required: field.required === true,
    kind: field.kind || "text",
    acordFieldLabels: field.acordFieldLabels?.slice(0, 6) ?? [],
  }));
  const dossier = compactForPrompt(input.dossier);
  const agent = getQuotexAiAgent("questionnaire_public_sweep");

  const prompt = [
    "Return JSON only. Do not use markdown.",
    `Dedicated agent: ${agent.label} (${agent.id}).`,
    `Agent purpose: ${agent.purpose}`,
    ...agent.instructions.map((item) => `Agent rule: ${item}`),
    "Use live public internet research when needed. Use the supplied dossier first, then search by exact property address, VIN, hull ID, asset id, business name, or applicant/address combination.",
    "Answer the complete questionnaire as one batch, like these questions were pasted into ChatGPT with a request to research the public web.",
    "Do not fabricate private underwriting facts. Never infer loss history, claims, moving violations, MVR, FEIN/tax ID, policy number, carrier login status, revenue, payroll, SSN, or prior coverage unless it is explicitly supplied.",
    "If a private answer is not public, return a useful editable answer such as \"Not public; applicant attestation needed\", \"Not found in public records; verify\", or \"Requires CLUE/loss runs\".",
    "Property address fields must contain addresses, never applicant names. Year fields must be plausible years. Square-footage fields must contain area values or public-record ranges.",
    "Use sourceKind only from: agent_seed, client_intake, validated_address, public_geocoder, public_web, government_api, commercial_provider, carrier_api, model_estimate, unknown.",
    "For public_web, government_api, or commercial_provider mappings, include sourceUrl when a URL is available.",
    "",
    `Template: ${input.templateLabel}`,
    `Questionnaire fields:\n${JSON.stringify(fields)}`,
    `Quotex dossier:\n${JSON.stringify(dossier)}`,
    "",
    "Return exactly this JSON shape:",
    JSON.stringify({
      summary: "string",
      confidence: 0.8,
      mappings: [
        {
          targetId: "exact supplied targetId",
          targetField: "exact supplied label",
          value: "answer",
          sourceLabel: "source name",
          sourceUrl: "https://source.example/page-or-empty-string",
          sourceKind: "public_web",
          confidence: 0.8,
          verified: false,
          rationale: "why this answer fits this exact field",
        },
      ],
      missingFields: ["field labels that still need agent/client review"],
      webSources: [{ title: "source title", url: "https://source.example", field: "field label" }],
    }),
  ].join("\n");

  if (prompt.length <= BASE44_MAX_MESSAGE_CHARS) return prompt;
  const allowedDossierChars = Math.max(1_000, BASE44_MAX_MESSAGE_CHARS - (prompt.length - JSON.stringify(dossier).length) - 200);
  const smallerDossier = clipString(JSON.stringify(dossier), allowedDossierChars);
  return [
    "Return JSON only. Do not use markdown.",
    `Dedicated agent: ${agent.label} (${agent.id}). Research the supplied questions from public sources and return conservative, source-backed editable questionnaire answers.`,
    "Never fabricate private facts. If something is not public, return a not-public verification note.",
    `Template: ${input.templateLabel}`,
    `Questionnaire fields:\n${JSON.stringify(fields)}`,
    `Quotex dossier:\n${smallerDossier}`,
    "Return JSON with keys summary, confidence, mappings, missingFields, webSources. Each mapping must include targetId, targetField, value, sourceLabel, sourceUrl, sourceKind, confidence, verified, rationale.",
  ].join("\n").slice(0, BASE44_MAX_MESSAGE_CHARS);
}

async function createConversation(): Promise<{ id: string }> {
  const data = await fetchBase44Json("/conversations", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const id = extractId(data);
  if (!id) throw new Error("Base44 did not return a conversation id.");
  return { id };
}

async function sendMessage(conversationId: string, content: string): Promise<string> {
  const data = await fetchBase44Json(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: "user",
      content: content.slice(0, BASE44_MAX_MESSAGE_CHARS),
      file_urls: [],
      additional_message_params: {},
    }),
  });
  const text = latestAssistantText(data);
  if (!text) throw new Error("Base44 response did not include an assistant message.");
  return text;
}

async function fetchBase44Json(path: string, init: RequestInit): Promise<unknown> {
  const baseUrl = base44BaseUrl();
  const apiKey = base44ApiKey();
  if (!baseUrl || !apiKey) throw new Error("Base44 public-data sweep is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), base44TimeoutMs());
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        api_key: apiKey,
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Base44 returned HTTP ${response.status}: ${redact(text.slice(0, 500))}`);
    }
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof Error) throw new Error(redact(error.message));
    throw new Error("Base44 request failed.");
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(unfenced.slice(first, last + 1));
    }
    throw new Error("Base44 response did not contain valid JSON.");
  }
}

function normalizeBase44QuestionnaireRecord(raw: unknown, fields: Base44Field[]): unknown {
  if (!isRecord(raw)) return raw;
  const record = { ...raw };
  const existingMappings = Array.isArray(record.mappings) ? record.mappings : [];
  const objectMappings = isRecord(record.mappings) ? normalizeMappingObject(record.mappings, fields) : [];
  record.mappings = [...existingMappings, ...objectMappings].map(normalizeMappingRow).filter(isRecord);
  if (!Array.isArray(record.missingFields)) record.missingFields = [];
  if (!Array.isArray(record.webSources)) record.webSources = [];
  return record;
}

function normalizeMappingObject(mappingObject: Record<string, unknown>, fields: Base44Field[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const [key, value] of Object.entries(mappingObject)) {
    const field = findFieldForBase44Key(key, fields);
    if (!field) continue;
    const valueRecord = isRecord(value) ? value : {};
    const answer = extractAnswerValue(value);
    if (!answer) continue;
    const sources = extractSourceLabels(valueRecord.sources);
    const unavailable = /\b(not public|not available|not explicitly|no public|requires|verify|unknown|not found)\b/i.test(answer);
    rows.push({
      targetId: field.id,
      targetField: field.label,
      value: answer,
      sourceLabel: sources[0] || "Base44 public data sweep",
      sourceUrl: firstUrl(valueRecord),
      sourceKind: unavailable ? "model_estimate" : sources.length > 0 ? "public_web" : "model_estimate",
      confidence: confidenceToNumber(valueRecord.confidence),
      verified: false,
      rationale:
        typeof valueRecord.rationale === "string"
          ? valueRecord.rationale
          : `Base44 public sweep returned ${key} for ${field.label}.`,
    });
  }
  return rows;
}

function normalizeMappingRow(row: unknown): unknown {
  if (!isRecord(row)) return row;
  return {
    ...row,
    value: stringifyAnswer(row.value),
    sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : "",
    confidence: confidenceToNumber(row.confidence),
  };
}

function findFieldForBase44Key(key: string, fields: Base44Field[]): Base44Field | undefined {
  const normalizedKey = normalizeMatchText(key);
  const exact = fields.find((field) => {
    const candidates = [field.id, field.label, field.acordFieldKey, ...(field.acordFieldLabels ?? [])].filter(Boolean);
    return candidates.some((candidate) => normalizeMatchText(candidate ?? "") === normalizedKey);
  });
  if (exact) return exact;
  return fields.find((field) => base44KeyLooksLikeField(normalizedKey, normalizeMatchText(field.label)));
}

function base44KeyLooksLikeField(key: string, fieldLabel: string): boolean {
  if (key.includes("yearbuilt")) return fieldLabel.includes("yearbuilt");
  if (key.includes("squarefoot") || key.includes("livingarea")) {
    return fieldLabel.includes("squarefoot") || fieldLabel.includes("livingarea");
  }
  if (key.includes("roofmaterial")) return fieldLabel.includes("roofmaterial");
  if (key.includes("roofage") || key.includes("roofyear")) return fieldLabel.includes("roofage") || fieldLabel.includes("roofyear");
  if (key.includes("floodzone")) return fieldLabel.includes("floodzone");
  if (key.includes("constructions")) return fieldLabel.includes("construction");
  if (key.includes("constructiontype")) return fieldLabel.includes("construction");
  if (key.includes("lotsize")) return fieldLabel.includes("lotsize");
  if (key.includes("coast")) return fieldLabel.includes("coast");
  if (key.includes("loss") || key.includes("claim")) {
    return fieldLabel.includes("loss") || fieldLabel.includes("claim") || fieldLabel.includes("incident");
  }
  if (key.includes("address")) return fieldLabel.includes("address");
  return false;
}

function extractAnswerValue(value: unknown): string {
  if (isRecord(value)) {
    return stringifyAnswer(value.recommended ?? value.value ?? value.answer ?? value.result ?? value.note ?? value.summary);
  }
  return stringifyAnswer(value);
}

function stringifyAnswer(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function extractSourceLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : isRecord(item) && typeof item.title === "string" ? item.title.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
}

function firstUrl(value: Record<string, unknown>): string {
  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl : "";
  if (sourceUrl) return sourceUrl;
  const urls = Array.isArray(value.urls) ? value.urls : [];
  const first = urls.find((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item));
  return first ?? "";
}

function confidenceToNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  if (typeof value !== "string") return 0.72;
  const normalized = value.toLowerCase();
  if (normalized.includes("high")) return 0.86;
  if (normalized.includes("medium")) return 0.72;
  if (normalized.includes("low")) return 0.55;
  const numeric = Number(normalized.replace(/[^\d.]/g, ""));
  if (Number.isFinite(numeric)) return numeric > 1 ? Math.min(1, numeric / 100) : Math.max(0, Math.min(1, numeric));
  return 0.72;
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function latestAssistantText(data: unknown): string {
  if (!isRecord(data)) return "";
  if (typeof data.content === "string") return data.content.trim();
  const messages = Array.isArray(data.messages) ? data.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (!isRecord(row)) continue;
    if (row.role !== "assistant") continue;
    if (typeof row.content === "string" && row.content.trim()) return row.content.trim();
  }
  return "";
}

function extractId(data: unknown): string {
  if (!isRecord(data)) return "";
  if (typeof data.id === "string") return data.id;
  if (typeof data.conversation_id === "string") return data.conversation_id;
  return "";
}

function compactForPrompt(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clipString(value, 700);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (depth >= 5) return "[nested object omitted]";
  if (Array.isArray(value)) {
    return value.slice(0, 14).map((item) => compactForPrompt(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 60)) {
    if (looksSecretLike(key)) continue;
    const compacted = compactForPrompt(raw, depth + 1, seen);
    if (compacted !== undefined && compacted !== "") out[key] = compacted;
  }
  return out;
}

function looksSecretLike(key: string): boolean {
  return /password|secret|token|api.?key|credential|authorization|cookie|session/i.test(key);
}

function clipString(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function base44BaseUrl(): string {
  const value = env("BASE44_AGENT_BASE_URL");
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function base44ApiKey(): string {
  return env("BASE44_API_KEY") ?? "";
}

function base44TimeoutMs(): number {
  const parsed = Number(env("BASE44_TIMEOUT_MS"));
  if (Number.isFinite(parsed) && parsed >= 5_000) return Math.min(parsed, 120_000);
  return DEFAULT_TIMEOUT_MS;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function redact(value: string): string {
  const key = base44ApiKey();
  let output = value;
  if (key) output = output.replaceAll(key, REDACTED);
  return output.replace(/[a-f0-9]{32}/gi, REDACTED);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
