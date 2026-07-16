import { postServerAi, serverAiEnabled } from "./aiGateway";
import { cleanClosingBlock, createCampaignDraft, interpretCreativeBrief } from "./campaignCreative";

export type MarketingStudioChannel = "email";

export type MarketingStudioAudience =
  | "all_clients"
  | "all_prospects"
  | "auto_clients"
  | "coastal_home_clients"
  | "high_value_clients"
  | "renewal_clients";

export type MarketingStudioRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface MarketingStudioPamphlet {
  eyebrow: string;
  headline: string;
  subheadline: string;
  intro: string;
  highlightsTitle: string;
  highlights: string[];
  ctaTitle: string;
  ctaButton: string;
  imagePrompt: string;
}

export interface MarketingStudioDraft {
  campaignName: string;
  strategy: string;
  channels: MarketingStudioChannel[];
  audience: MarketingStudioAudience[];
  recurrence: MarketingStudioRecurrence;
  emailSubject: string;
  emailBody: string;
  pamphlet: MarketingStudioPamphlet;
}

export const MARKETING_STUDIO_CTA_BUTTON = "Get in touch";

const VALID_CHANNELS = new Set<MarketingStudioChannel>(["email"]);
const VALID_AUDIENCE = new Set<MarketingStudioAudience>([
  "all_clients",
  "all_prospects",
  "auto_clients",
  "coastal_home_clients",
  "high_value_clients",
  "renewal_clients",
]);
const VALID_RECURRENCES = new Set<MarketingStudioRecurrence>([
  "none",
  "daily",
  "weekly",
  "monthly",
]);

const CURATED_IMAGES: Record<string, string[]> = {
  coastal_home: [
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
    "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d",
    "https://images.unsplash.com/photo-1512917774080-9991f1c4c750",
    "https://images.unsplash.com/photo-1494526585095-c41746248156",
  ],
  high_value_home: [
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3",
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c",
    "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0",
    "https://images.unsplash.com/photo-1600607687644-aac4c3eac7f4",
    "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea",
  ],
  commercial: [
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab",
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2",
    "https://images.unsplash.com/photo-1556761175-b413da4baf72",
    "https://images.unsplash.com/photo-1551434678-e076c223a692",
    "https://images.unsplash.com/photo-1521737604893-d14cc237f11d",
    "https://images.unsplash.com/photo-1556761175-4b46a572b786",
  ],
  storm: [
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
    "https://images.unsplash.com/photo-1512917774080-9991f1c4c750",
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c",
    "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
    "https://images.unsplash.com/photo-1520454974749-611b7248ffdb",
  ],
  auto: [
    "https://images.unsplash.com/photo-1502877338535-766e1452684a",
    "https://images.unsplash.com/photo-1542362567-b07e54358753",
    "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7",
    "https://images.unsplash.com/photo-1549924231-f129b911e442",
    "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf",
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70",
  ],
  yacht: [
    "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e",
    "https://images.unsplash.com/photo-1517639493569-5666a7b2f494",
    "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13",
  ],
  valuables: [
    "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338",
    "https://images.unsplash.com/photo-1523170335258-f5ed11844a49",
    "https://images.unsplash.com/photo-1605100804763-247f67b3557e",
    "https://images.unsplash.com/photo-1506630448388-4e683c67ddb0",
    "https://images.unsplash.com/photo-1543294001-f7cd5d7fb516",
    "https://images.unsplash.com/photo-1512163143273-bde0e3cc7407",
  ],
  liability: [
    "https://images.unsplash.com/photo-1450101499163-c8848c66ca85",
    "https://images.unsplash.com/photo-1521791136064-7986c2920216",
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f",
    "https://images.unsplash.com/photo-1554224154-26032ffc0d07",
    "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40",
    "https://images.unsplash.com/photo-1507679799987-c73779587ccf",
  ],
  cyber: [
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3",
    "https://images.unsplash.com/photo-1558494949-ef010cbdcc31",
    "https://images.unsplash.com/photo-1518770660439-4636190af475",
    "https://images.unsplash.com/photo-1550751827-4bd374c3f58b",
    "https://images.unsplash.com/photo-1504384308090-c894fdcc538d",
  ],
  renewal: [
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3",
    "https://images.unsplash.com/photo-1483058712412-4245e9b90334",
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72",
    "https://images.unsplash.com/photo-1450101499163-c8848c66ca85",
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f",
  ],
  welcome: [
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36",
    "https://images.unsplash.com/photo-1521737604893-d14cc237f11d",
    "https://images.unsplash.com/photo-1556761175-b413da4baf72",
  ],
  generic: [
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72",
    "https://images.unsplash.com/photo-1483058712412-4245e9b90334",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36",
    "https://images.unsplash.com/photo-1450101499163-c8848c66ca85",
    "https://images.unsplash.com/photo-1521791136064-7986c2920216",
  ],
};

export async function draftMarketingStudioCampaign(input: {
  prompt: string;
  agencyName?: string;
  agencyAddress?: string;
  senderName?: string;
  signOff?: string;
}): Promise<MarketingStudioDraft> {
  const localDraft = createLocalStudioDraft(input);
  if (!serverAiEnabled()) {
    return localDraft;
  }
  try {
    const raw = await postServerAi<unknown>(
      "/ai/marketing-creative",
      {
        prompt: input.prompt,
        agencyName: input.agencyName,
        agencyAddress: input.agencyAddress,
        senderName: input.senderName,
        signOff: input.signOff,
      },
      { timeoutMs: 60_000 }
    );
    if (raw) return ensureStudioDraftCompliance(normalizeStudioDraft(raw), input);
    return localDraft;
  } catch (error) {
    reportMarketingAiFallback(error);
    return localDraft;
  }
}

function reportMarketingAiFallback(error: unknown): void {
  if (typeof console === "undefined") return;
  console.warn("[quotex-marketing-ai-fallback]", {
    message: error instanceof Error ? error.message : "Marketing AI provider returned an unusable response.",
  });
}

export function normalizeStudioDraft(raw: unknown): MarketingStudioDraft {
  if (!isRecord(raw)) throw new Error("AI response was not a campaign object.");
  const channels = toStringArray(raw.channels).filter((c): c is MarketingStudioChannel =>
    VALID_CHANNELS.has(c as MarketingStudioChannel)
  );
  const audience = toStringArray(raw.audience).filter((a): a is MarketingStudioAudience =>
    VALID_AUDIENCE.has(a as MarketingStudioAudience)
  );
  const recurrence = stringValue(raw.recurrence);
  const pamphlet = isRecord(raw.pamphlet) ? raw.pamphlet : {};
  const highlights = toStringArray(pamphlet.highlights).map((item) => clean(item, 120)).filter(Boolean);
  const draft: MarketingStudioDraft = {
    campaignName: required(raw.campaignName, "campaignName", 90),
    strategy: required(raw.strategy, "strategy", 700),
    channels: channels.length ? Array.from(new Set(channels)) : ["email"],
    audience: audience.length ? Array.from(new Set(audience)) : ["all_clients"],
    recurrence: VALID_RECURRENCES.has(recurrence as MarketingStudioRecurrence)
      ? (recurrence as MarketingStudioRecurrence)
      : "none",
    emailSubject: required(raw.emailSubject, "emailSubject", 90),
    emailBody: required(raw.emailBody, "emailBody", 4_000),
    pamphlet: {
      eyebrow: required(pamphlet.eyebrow, "pamphlet.eyebrow", 42),
      headline: required(pamphlet.headline, "pamphlet.headline", 90),
      subheadline: required(pamphlet.subheadline, "pamphlet.subheadline", 140),
      intro: required(pamphlet.intro, "pamphlet.intro", 700),
      highlightsTitle: required(pamphlet.highlightsTitle, "pamphlet.highlightsTitle", 110),
      highlights: highlights.length >= 3 ? highlights.slice(0, 5) : fail("pamphlet.highlights"),
      ctaTitle: required(pamphlet.ctaTitle, "pamphlet.ctaTitle", 180),
      ctaButton: MARKETING_STUDIO_CTA_BUTTON,
      imagePrompt: required(pamphlet.imagePrompt, "pamphlet.imagePrompt", 1_000),
    },
  };
  if (draft.emailBody.split(/\s+/).length < 45) {
    throw new Error("The AI email draft was too thin. Regenerate with a more specific prompt.");
  }
  if (draft.pamphlet.intro.split(/\s+/).length < 35) {
    throw new Error("The AI pamphlet draft was too thin. Regenerate with a more specific prompt.");
  }
  return draft;
}

export function marketingStudioImageUrl(draft: MarketingStudioDraft, seed: number): string {
  const images = CURATED_IMAGES[imageCategory(draft)] ?? CURATED_IMAGES.generic;
  const base = images[Math.abs(seed) % images.length];
  return `${base}?${new URLSearchParams({
    auto: "format",
    fit: "crop",
    crop: "entropy",
    w: "1800",
    h: "1200",
    q: "92",
    ixlib: "rb-4.0.3",
  }).toString()}`;
}

export function createLocalStudioDraft(input: {
  prompt: string;
  agencyName?: string;
  agencyAddress?: string;
  senderName?: string;
  signOff?: string;
}): MarketingStudioDraft {
  const brief = interpretCreativeBrief(input.prompt);
  const campaign = createCampaignDraft(input);
  const emailCampaign = createCampaignDraft({
    ...input,
    prompt: `${input.prompt} email digital pamphlet detailed advisory message`,
  });
  const agencyName = input.agencyName ?? "your agency";
  const raw: MarketingStudioDraft = {
    campaignName: cleanCampaignName(campaign.name, brief.title),
    strategy: [
      campaign.summary,
      `Execution: turn "${brief.rawPrompt}" into advisor-led outreach about ${brief.topic}. The copy should make the risk feel concrete, explain why action now is sensible, and give the recipient one clean next step.`,
    ].join(" "),
    channels: ["email"],
    audience: campaign.audience,
    recurrence: campaign.recurrence,
    emailSubject: campaign.subject,
    emailBody: ensureMarketingEmailCompliance(ensureEmailMinimum(emailCampaign.body, input), input.agencyAddress),
    pamphlet: {
      eyebrow: eyebrowForBrief(brief),
      headline: headlineForBrief(brief),
      subheadline: subheadlineForBrief(brief),
      intro: introForBrief(brief),
      highlightsTitle: highlightsTitleForBrief(brief),
      highlights: highlightsForBrief(brief),
      ctaTitle: ctaTitleForBrief(brief),
      ctaButton: ctaButtonForBrief(),
      imagePrompt: campaign.imagePrompt ?? imagePromptForBrief(brief),
    },
  };
  return normalizeStudioDraft(raw);
}

type StudioBrief = ReturnType<typeof interpretCreativeBrief>;

function cleanCampaignName(name: string, fallbackTitle: string): string {
  const cleaned = name.replace(/\s+pamphlet$/i, "").trim();
  return cleaned || `${fallbackTitle} Campaign`;
}

function eyebrowForBrief(brief: StudioBrief): string {
  const labels: Record<string, string> = {
    storm: "Coastal Readiness",
    renewal: "Renewal Review",
    auto: "Auto Portfolio",
    valuables: "Valuables Review",
    liability: "Liability Strategy",
    billing: "Billing Clarity",
    quote_completion: "Quote Follow-Up",
    commercial: "Commercial Protection",
    annual_review: "Portfolio Review",
    welcome: "Client Welcome",
    custom: "Advisor Insight",
  };
  return labels[brief.intent] ?? "Advisor Insight";
}

function headlineForBrief(brief: StudioBrief): string {
  const topic = titleCase(brief.topic);
  const headlines: Record<string, string> = {
    storm: "Prepare the Home Before the Storm Decides the Timeline",
    renewal: "Make the Renewal Feel Handled Before Terms Are Finalized",
    auto: "Keep the Auto Schedule Matched to Real Life",
    valuables: "Protect the Pieces That Are Hardest to Replace",
    liability: "Bring the Liability Stack Back Into Alignment",
    billing: "Make the Billing Path Clear Before It Becomes Urgent",
    quote_completion: "Finish the Quote From Where You Left Off",
    commercial: "Protect the Growth Your Business Has Earned",
    annual_review: "A Cleaner View of the Full Coverage Portfolio",
    welcome: "Start With a Portal That Feels Handled",
    custom: `A Smarter Way to Review ${topic}`,
  };
  return headlines[brief.intent] ?? `A Smarter Way to Review ${topic}`;
}

function subheadlineForBrief(brief: StudioBrief): string {
  return trimSentence(brief.promise, 138);
}

function introForBrief(brief: StudioBrief): string {
  return [
    brief.whyNow,
    brief.promise,
    `This campaign turns ${brief.topic} into a focused review instead of another vague insurance reminder.`,
    "The goal is to help the recipient understand what changed, what should be checked first, and how the agency can move the file forward with less friction.",
  ].join(" ");
}

function highlightsTitleForBrief(brief: StudioBrief): string {
  if (brief.intent === "commercial") return "What the business review clarifies";
  if (brief.intent === "quote_completion") return "What happens next";
  return "What this review clarifies";
}

function highlightsForBrief(brief: StudioBrief): string[] {
  const base = brief.checks.map(sentenceCase);
  const extra = [
    `Identify the cleanest next step for ${brief.topic}`,
    "Keep the conversation specific, useful, and easy to act on",
  ];
  return [...base, ...extra].slice(0, 5);
}

function ctaTitleForBrief(brief: StudioBrief): string {
  return trimSentence(brief.nextStep, 170);
}

function ctaButtonForBrief(): string {
  return MARKETING_STUDIO_CTA_BUTTON;
}

function imagePromptForBrief(brief: StudioBrief): string {
  return [
    brief.imageScene,
    `The scene should visibly communicate ${brief.topic} for a private-client insurance audience.`,
    "Use real-world subject matter, premium editorial composition, warm realistic lighting, and no readable text.",
  ].join(" ");
}

function ensureEmailMinimum(
  body: string,
  input: { agencyName?: string; senderName?: string; signOff?: string }
): string {
  if (body.split(/\s+/).length >= 45) return body;
  const agencyName = input.agencyName ?? "your agency";
  const senderName = input.senderName ?? "the team";
  const signOff = input.signOff ?? "Warm regards,";
  const closing = cleanClosingBlock({ agencyName, senderName, signOff });
  return [
    "Hi {first_name},",
    "",
    body,
    "",
    "I will review what we already have on file first, then only ask for the specific information needed to move this forward cleanly.",
    "",
    "If you would rather not receive this type of note, reply and I will update your preferences.",
    "",
    closing,
  ].join("\n");
}

function ensureStudioDraftCompliance(
  draft: MarketingStudioDraft,
  input: { agencyAddress?: string }
): MarketingStudioDraft {
  return {
    ...draft,
    emailBody: ensureMarketingEmailCompliance(draft.emailBody, input.agencyAddress),
  };
}

function ensureMarketingEmailCompliance(body: string, agencyAddress?: string): string {
  const address = agencyAddress?.trim();
  if (hasMarketingAddress(body, address)) return body;
  const addressLine = address
    ? `Mailing address: ${address}`
    : "Mailing address: agency address must be configured before production send.";
  return `${body.trim()}\n\n${addressLine}`;
}

function hasMarketingAddress(body: string, agencyAddress?: string): boolean {
  if (/\bmailing address\b|\bphysical address\b/i.test(body)) return true;
  const normalizedAddress = agencyAddress?.toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(normalizedAddress && body.toLowerCase().includes(normalizedAddress));
}

function sentenceCase(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[.]+$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function trimSentence(value: string, max: number): string {
  const cleaned = sentenceCase(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trim()}...` : cleaned;
}

function imageCategory(draft: MarketingStudioDraft): string {
  const text = [
    draft.campaignName,
    draft.emailSubject,
    draft.pamphlet.eyebrow,
    draft.pamphlet.headline,
    draft.pamphlet.subheadline,
    draft.pamphlet.imagePrompt,
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(yacht|boat|marine|watercraft|captain|marina|vessel)\b/.test(text)) return "yacht";
  if (/\b(cyber|ransomware|privacy|data breach|network|technology|phishing)\b/.test(text)) return "cyber";
  if (/\b(high[-\s]?value|luxury home|estate|private client|concierge|portfolio)\b/.test(text)) return "high_value_home";
  if (/\b(hurricane|storm|wind|flood|roof|coastal|beach|waterfront|dwelling|shutter)\b/.test(text)) return "coastal_home";
  if (/\b(home|house|residence|property|dwelling)\b/.test(text)) return "coastal_home";
  if (/\b(auto|vehicle|car|driver|fleet|garage|porsche|ferrari|collector car|luxury auto)\b/.test(text)) return "auto";
  if (/\b(jewelry|watch|ring|appraisal|valuable|fine art|wine|collection)\b/.test(text)) return "valuables";
  if (/\b(business|commercial|company|operations|umbrella|general liability|workers comp|location|contract)\b/.test(text)) {
    return "commercial";
  }
  if (/\b(liability|lawsuit|excess|underlying limits)\b/.test(text)) return "liability";
  if (/\b(renewal|renew|expiration|term)\b/.test(text)) return "renewal";
  if (/\b(welcome|portal|onboard)\b/.test(text)) return "welcome";
  return "generic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, max).trim();
}

function required(value: unknown, field: string, max: number): string {
  const out = clean(value, max);
  if (out.length < 3) return fail(field);
  return out;
}

function fail(field: string): never {
  throw new Error(`The AI response was missing ${field}. Regenerate the campaign.`);
}
