import {
  aiDraftCampaign,
  type DraftCampaignAudience,
  type DraftedCampaign,
} from "./ai";
import { postServerAi } from "./aiGateway";

// =====================================================================
// LLM-driven campaign drafting.
//
// The original campaign drafter is deterministic and fast, which makes
// it a good fallback. This layer asks the text model to interpret the
// manager's full brief, then validates the result against the exact
// fields the Draft Campaign UI can execute.
// =====================================================================

const VALID_AUDIENCES = new Set<DraftCampaignAudience>([
  "all_clients",
  "all_prospects",
  "auto_clients",
  "coastal_home_clients",
  "high_value_clients",
  "renewal_clients",
]);
type CampaignChannel = "email" | "sms";

const VALID_CHANNELS = new Set<CampaignChannel>(["email", "sms"]);
const VALID_RECURRENCES = new Set<DraftedCampaign["recurrence"]>([
  "none",
  "daily",
  "weekly",
  "monthly",
]);

interface LLMCampaignDraft {
  name?: string;
  subject?: string;
  body?: string;
  channels?: unknown[];
  audience?: unknown[];
  recurrence?: string;
  summary?: string;
  pamphletDescription?: string;
  imagePrompt?: string;
}

export async function aiDraftCampaignLLM(input: {
  prompt: string;
  agencyName?: string;
  agencyAddress?: string;
  senderName?: string;
  signOff?: string;
}): Promise<DraftedCampaign> {
  const base = aiDraftCampaign(input);
  try {
    const llm = await fetchCampaignDraftFromLLM(input, base);
    return mergeLLMCampaignDraft(base, llm, input);
  } catch {
    return base;
  }
}

export function mergeLLMCampaignDraft(
  base: DraftedCampaign,
  llm: LLMCampaignDraft,
  input: { agencyName?: string; senderName?: string; signOff?: string } = {}
): DraftedCampaign {
  const channels = sanitizeChannels(llm.channels) ?? base.channels;
  const audience = sanitizeAudience(llm.audience) ?? base.audience;
  const recurrence = sanitizeRecurrence(llm.recurrence) ?? base.recurrence;
  const subject = chooseCampaignSubject(llm.subject, base.subject);
  const name = cleanText(llm.name, { max: 80 }) ?? base.name;
  let body = usefulCampaignBody(llm.body) ?? base.body;
  const pamphletDescription =
    usefulPamphletDescription(llm.pamphletDescription) ?? base.pamphletDescription;
  const imagePrompt = usefulImagePrompt(llm.imagePrompt) ?? base.imagePrompt;

  body = channels.includes("email") ? ensureEmailShape(body, input) : ensureSmsShape(body);
  if (channels.includes("sms")) body = ensureSmsStop(body);

  const summary =
    cleanText(llm.summary, { max: 260 }) ??
    `AI drafted "${name}" for ${audienceLabel(audience)} via ${channels
      .map((c) => c.toUpperCase())
      .join(" + ")}${recurrence !== "none" ? `, recurring ${recurrence}` : ""}.`;

  return {
    name,
    subject,
    body,
    channels,
    audience,
    recurrence,
    summary,
    pamphletDescription,
    imagePrompt,
  };
}

async function fetchCampaignDraftFromLLM(
  input: {
    prompt: string;
    agencyName?: string;
    senderName?: string;
    signOff?: string;
  },
  base: DraftedCampaign
): Promise<LLMCampaignDraft> {
  const llm = await postServerAi<LLMCampaignDraft>("/ai/draft-campaign", {
    prompt: input.prompt,
    agencyName: input.agencyName,
    senderName: input.senderName,
    signOff: input.signOff,
    fallback: base,
  }, {
    timeoutMs: 45_000,
  });
  if (!llm) throw new Error("Campaign AI provider unavailable");
  return llm;
}

export function parseCampaignLLMResponse(raw: string): LLMCampaignDraft {
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
    throw new Error("Campaign LLM response was not valid JSON");
  }
}

function cleanText(value: unknown, opts: { max: number }): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (cleaned.length < 3) return undefined;
  return cleaned.slice(0, opts.max).trim();
}

function chooseCampaignSubject(value: unknown, fallback: string): string {
  const cleaned = cleanSubject(value);
  if (!cleaned) return fallback;
  const weak = /^(insurance update|quick note|checking in|follow[- ]?up|coverage update|important update)$/i;
  if (weak.test(cleaned)) return fallback;
  return cleaned;
}

function cleanSubject(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/^subject:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/g, "");
  if (cleaned.length < 8) return undefined;
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned;
}

function usefulCampaignBody(value: unknown): string | undefined {
  const cleaned = cleanText(value, { max: 3000 });
  if (!cleaned) return undefined;
  const tooThin = cleaned.split(/\s+/).length < 24;
  const generic =
    /we value your business|reach out with any questions|hope you are well/i.test(cleaned) &&
    !/\b(renewal|storm|wind|flood|auto|driver|valuation|appraisal|umbrella|liability|quote|billing|document)\b/i.test(
      cleaned
    );
  return tooThin || generic ? undefined : cleaned;
}

function usefulPamphletDescription(value: unknown): string | undefined {
  const cleaned = cleanText(value, { max: 420 });
  if (!cleaned) return undefined;
  if (cleaned.split(/\s+/).length < 8) return undefined;
  return cleaned;
}

function usefulImagePrompt(value: unknown): string | undefined {
  const cleaned = cleanText(value, { max: 900 });
  if (!cleaned) return undefined;
  const generic = /\b(insurance office|paperwork|documents|business people shaking hands|generic)\b/i.test(cleaned);
  const tooThin = cleaned.split(/\s+/).length < 16;
  return generic || tooThin ? undefined : cleaned;
}

function sanitizeChannels(value: unknown[] | undefined): CampaignChannel[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is CampaignChannel => {
    return typeof v === "string" && VALID_CHANNELS.has(v as CampaignChannel);
  });
  return out.length ? Array.from(new Set(out)) : undefined;
}

function sanitizeAudience(value: unknown[] | undefined): DraftCampaignAudience[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is DraftCampaignAudience => {
    return typeof v === "string" && VALID_AUDIENCES.has(v as DraftCampaignAudience);
  });
  return out.length ? Array.from(new Set(out)) : undefined;
}

function sanitizeRecurrence(value: unknown): DraftedCampaign["recurrence"] | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.toLowerCase().trim();
  return VALID_RECURRENCES.has(cleaned as DraftedCampaign["recurrence"])
    ? (cleaned as DraftedCampaign["recurrence"])
    : undefined;
}

function ensureEmailShape(
  body: string,
  input: { agencyName?: string; agencyAddress?: string; senderName?: string; signOff?: string }
): string {
  const hasPersonalization = /\{first_name\}/i.test(body);
  const hasSignOff = /warm regards|best,|sincerely|thank you|regards/i.test(body);
  const hasOptOut = /rather not receive|unsubscribe|opt out|update your preferences|stop receiving/i.test(body);
  const lines = body.trim();
  const signOff = input.signOff ?? "Warm regards,";
  const sender = input.senderName ?? "the team";
  const agency = input.agencyName ?? "your agency";
  const shaped = [
    hasPersonalization ? null : "Hi {first_name},",
    hasPersonalization ? null : "",
    lines,
    hasOptOut ? null : "",
    hasOptOut
      ? null
      : "If you would rather not receive this type of note, reply and I will update your preferences.",
    hasSignOff ? null : "",
    hasSignOff ? null : signOff,
    hasSignOff ? null : sender,
    hasSignOff ? null : agency,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .trim();
  return ensureMarketingEmailCompliance(shaped, input.agencyAddress);
}

function ensureMarketingEmailCompliance(body: string, agencyAddress?: string): string {
  const hasPhysicalAddress = hasConfiguredAddress(body, agencyAddress);
  if (hasPhysicalAddress) return body;
  const address = agencyAddress?.trim();
  const addressLine = address
    ? `Mailing address: ${address}`
    : "Mailing address: agency address must be configured before production send.";
  return `${body.trim()}\n\n${addressLine}`;
}

function hasConfiguredAddress(body: string, agencyAddress?: string): boolean {
  const normalizedBody = body.toLowerCase();
  if (/\bmailing address\b|\bphysical address\b/i.test(body)) return true;
  const normalizedAddress = agencyAddress?.toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(normalizedAddress && normalizedBody.includes(normalizedAddress));
}

function ensureSmsShape(body: string): string {
  const cleaned = body
    .replace(/^hi\s+\{first_name\},?\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return ensureSmsStop(cleaned);
}

function ensureSmsStop(body: string): string {
  return /reply\s+stop/i.test(body)
    ? body
    : `${body.trim()}\n\nReply STOP to opt out.`;
}

function audienceLabel(audience: DraftCampaignAudience[]): string {
  const labels: Record<DraftCampaignAudience, string> = {
    all_clients: "all clients",
    all_prospects: "all prospects",
    auto_clients: "auto-policy clients",
    coastal_home_clients: "coastal-home clients",
    high_value_clients: "high-value clients",
    renewal_clients: "renewal clients",
  };
  return audience.map((a) => labels[a]).join(" + ");
}
