import type { DraftCampaignAudience, DraftedCampaign } from "./ai";

type CampaignChannel = "email";

type CreativeIntent =
  | "storm"
  | "renewal"
  | "auto"
  | "valuables"
  | "liability"
  | "billing"
  | "quote_completion"
  | "commercial"
  | "annual_review"
  | "welcome"
  | "custom";

export interface CreativeBrief {
  rawPrompt: string;
  topic: string;
  title: string;
  intent: CreativeIntent;
  audience: DraftCampaignAudience[];
  channels: CampaignChannel[];
  recurrence: DraftedCampaign["recurrence"];
  whyNow: string;
  promise: string;
  checks: string[];
  nextStep: string;
  imageScene: string;
}

type BriefFrame = Pick<CreativeBrief, "whyNow" | "promise" | "checks" | "nextStep" | "imageScene">;

const STOP_WORDS = new Set([
  "make",
  "create",
  "draft",
  "write",
  "generate",
  "build",
  "campaign",
  "pamphlet",
  "flyer",
  "email",
  "about",
  "for",
  "to",
  "with",
  "the",
  "and",
  "that",
  "should",
  "client",
  "clients",
  "customer",
  "customers",
  "polished",
  "digital",
  "premium",
  "high",
  "caliber",
  "marketing",
  "master",
  "worthy",
  "description",
  "picture",
  "image",
  "photo",
  "based",
  "prompt",
  "exactly",
  "talking",
]);

export function createCampaignDraft(input: {
  prompt: string;
  agencyName?: string;
  senderName?: string;
  signOff?: string;
}): DraftedCampaign {
  const brief = interpretCreativeBrief(input.prompt);
  const agencyName = input.agencyName ?? "your agency";
  const senderName = input.senderName ?? "the team";
  const signOff = input.signOff ?? "Warm regards,";
  const subject = subjectForBrief(brief);
  const body = emailForBrief(brief, { agencyName, senderName, signOff });

  return {
    name: `${brief.title} Pamphlet`,
    subject,
    body,
    channels: brief.channels,
    audience: brief.audience,
    recurrence: brief.recurrence,
    summary: [
      `Strategy: interpreted the prompt as ${brief.intent.replace(/_/g, " ")} outreach.`,
      `The campaign frames ${brief.topic} around ${brief.whyNow.toLowerCase()}`,
      `It recommends ${brief.channels.map((c) => c.toUpperCase()).join(" + ")} for ${audienceLabel(
        brief.audience
      )}.`,
    ].join(" "),
    pamphletDescription: pamphletDescriptionForBrief(brief),
    imagePrompt: imagePromptForBrief(brief),
  };
}

export function interpretCreativeBrief(prompt: string): CreativeBrief {
  const rawPrompt = prompt.replace(/\s+/g, " ").trim() || "premium coverage review";
  const lower = rawPrompt.toLowerCase();
  const intent = inferIntent(lower);
  const topic = inferTopic(rawPrompt, intent);
  const title = titleCase(topic);
  return {
    rawPrompt,
    topic,
    title,
    intent,
    audience: inferAudience(lower),
    channels: inferChannels(lower),
    recurrence: inferRecurrence(lower),
    ...briefFrame(intent, topic, rawPrompt),
  };
}

function inferIntent(text: string): CreativeIntent {
  if (/\b(prospect|lead|abandoned quote|unfinished quote|finish.*quote|quote completion|reply yes)\b/.test(text)) {
    return "quote_completion";
  }
  if (/\b(hurricane|storm|wind|flood|roof|shutter|cat-?5|mitigation)\b/.test(text)) return "storm";
  if (/\b(renew|renewal|expires|expiration|term)\b/.test(text)) return "renewal";
  if (/\b(auto|vehicle|car|driver|garage|garaging|stored vehicle|porsche|ferrari)\b/.test(text)) return "auto";
  if (/\b(jewelry|watch|ring|appraisal|valuables|art|wine|collection)\b/.test(text)) return "valuables";
  if (/\b(umbrella|excess|liability|lawsuit|underlying limits)\b/.test(text)) return "liability";
  if (/\b(payment|bill|billing|invoice|autopay)\b/.test(text)) return "billing";
  if (/\b(business|commercial|workers comp|general liability|professional liability|bop|company|operations)\b/.test(text)) {
    return "commercial";
  }
  if (/\b(year end|year-end|annual review|portfolio review|coverage review)\b/.test(text)) return "annual_review";
  if (/\b(welcome|onboard|new client|portal access)\b/.test(text)) return "welcome";
  return "custom";
}

function inferTopic(prompt: string, intent: CreativeIntent): string {
  const lower = prompt.toLowerCase();
  const recognized = recognizedInsuranceTopic(lower, intent);
  if (recognized) return recognized;

  const explicit = prompt
    .split(/\s+/)
    .map((word) => word.replace(/[^\w-]/g, ""))
    .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 9)
    .join(" ");
  if (explicit) return explicit;
  const fallback: Record<CreativeIntent, string> = {
    storm: "coastal home storm readiness",
    renewal: "renewal readiness",
    auto: "auto coverage review",
    valuables: "scheduled valuables review",
    liability: "excess liability review",
    billing: "billing clarity",
    quote_completion: "quote completion",
    commercial: "commercial coverage review",
    annual_review: "annual portfolio review",
    welcome: "client welcome",
    custom: "premium coverage review",
  };
  return fallback[intent];
}

function recognizedInsuranceTopic(text: string, intent: CreativeIntent): string | undefined {
  if (/\b(commercial|business|company|operations?|locations?|fleet|vehicles?)\b/.test(text)) {
    if (/\b(umbrella|excess liability|liability umbrella)\b/.test(text)) return "commercial umbrella liability";
    if (/\b(general liability|gl)\b/.test(text)) return "commercial general liability";
    if (/\b(workers'? comp|workers compensation)\b/.test(text)) return "workers compensation review";
    if (/\b(cyber|data breach|ransomware)\b/.test(text)) return "commercial cyber liability";
    if (intent === "commercial") return "commercial coverage review";
  }
  if (/\b(stored vehicle|stored vehicles|vehicle storage|winter storage|garage kept)\b/.test(text)) {
    return "stored vehicle coverage";
  }
  if (/\b(hurricane|storm|wind mitigation|wind-mitigation|shutters?|flood|roof)\b/.test(text)) {
    return "coastal home storm readiness";
  }
  if (/\b(umbrella|excess liability|lawsuit|underlying limits)\b/.test(text)) return "excess liability review";
  if (/\b(jewelry|watch|ring|appraisal|valuables|fine art|wine collection)\b/.test(text)) {
    return "scheduled valuables review";
  }
  if (/\b(auto renewal|vehicle renewal|car renewal)\b/.test(text)) return "auto renewal review";
  if (/\b(renewal|renewals|expires|expiration)\b/.test(text)) return "renewal readiness";
  if (/\b(abandoned quote|unfinished quote|finish.*quote|quote completion|reply yes)\b/.test(text)) {
    return "quote completion";
  }
  return undefined;
}

function inferAudience(text: string): DraftCampaignAudience[] {
  const audience: DraftCampaignAudience[] = [];
  const add = (mode: DraftCampaignAudience) => {
    if (!audience.includes(mode)) audience.push(mode);
  };
  if (/\b(prospect|lead|quote start|abandoned quote|unfinished quote)\b/.test(text)) add("all_prospects");
  if (/\b(everyone|all clients|client book|whole book|entire book)\b/.test(text)) add("all_clients");
  if (/\b(coastal|home|house|dwelling|roof|hurricane|storm|flood|wind)\b/.test(text)) add("coastal_home_clients");
  if (/\b(auto|vehicle|car|driver|garage|garaging|stored vehicle|porsche|ferrari)\b/.test(text)) add("auto_clients");
  if (/\b(high value|high-value|hnw|private client|luxury|estate|million|valuable|collection)\b/.test(text)) {
    add("high_value_clients");
  }
  if (/\b(renew|renewal|expires|expiration|term)\b/.test(text)) add("renewal_clients");
  if (audience.length === 0) add("all_clients");
  return audience;
}

function inferChannels(_text: string): CampaignChannel[] {
  return ["email"];
}

function inferRecurrence(text: string): DraftedCampaign["recurrence"] {
  if (/\bdaily\b/.test(text)) return "daily";
  if (/\bweekly\b/.test(text)) return "weekly";
  if (/\bmonthly\b/.test(text)) return "monthly";
  return "none";
}

function briefFrame(
  intent: CreativeIntent,
  topic: string,
  prompt: string
): BriefFrame {
  const customWhy = `This is a good moment to make ${topic} clear before it becomes urgent.`;
  const customPromise = `We will turn ${topic} into a simple, advisor-led review instead of a vague insurance task.`;
  const customChecks = [
    "clarify what changed and why it matters now",
    "identify the policy, document, exposure, or decision point involved",
    "recommend the cleanest next step without overstating the outcome",
  ];
  const customNext = "Reply with the item you want reviewed and I will take the first pass.";
  const sceneFromPrompt = promptSpecificScene(topic, prompt);

  const frames: Record<CreativeIntent, BriefFrame> = {
    storm: {
      whyNow: "Storm readiness is easiest to handle before weather, carrier questions, or documentation gaps become urgent.",
      promise: "We will review the coastal-home file before the carrier has to ask.",
      checks: [
        "confirm wind-mitigation credits and roof details",
        "review flood information, shutters, opening protection, and secondary water resistance",
        "make sure photos, inspections, and carrier-requested documents are easy to find",
      ],
      nextStep: `Reply "prep review" and I will check what we already have on file before asking you for anything else.`,
      imageScene:
        "A refined coastal home shortly before storm season, clean shutters visible, palms bending slightly, dramatic elegant clouds over the water.",
    },
    renewal: {
      whyNow: "The renewal window is the cleanest time to catch changes before carrier terms are finalized.",
      promise: "We will make the renewal feel organized, not rushed.",
      checks: [
        "confirm what changed since the last term",
        "review documents carriers may request before firm terms",
        "decide whether the renewal should be shopped, cleaned up, or left alone",
      ],
      nextStep: `Reply "renewal review" and I will start with the information we already have on file.`,
      imageScene:
        "A neat executive desk with a leather portfolio, calendar, fountain pen, and softly lit policy folder beside a window.",
    },
    auto: {
      whyNow: "Auto schedules drift quickly as drivers, garaging, usage, lenders, and vehicle values change.",
      promise: "We will make the schedule match how the vehicles are actually used today.",
      checks: [
        "confirm listed drivers, garaging address, and usage",
        "review annual mileage, stored-vehicle periods, and lender details",
        "flag agreed value or liability limit questions before renewal or quoting",
      ],
      nextStep: `Reply "auto review" and I will compare the current schedule against what carriers usually need.`,
      imageScene:
        "A luxury vehicle in a pristine residential garage at golden hour, soft reflections on the paint, organized upscale setting.",
    },
    valuables: {
      whyNow: "Valuables are best protected when appraisals, storage, travel use, and newly acquired pieces stay current.",
      promise: "We will make the schedule feel protective rather than administrative.",
      checks: [
        "confirm appraisals are still current",
        "review where items are stored when not worn or displayed",
        "identify new acquisitions that may need to be scheduled",
      ],
      nextStep: `Reply "valuables review" and I will send the short schedule and appraisal check.`,
      imageScene:
        "Fine jewelry and a luxury watch arranged on soft neutral fabric beside a tasteful appraisal folder and warm window light.",
    },
    liability: {
      whyNow: "Liability protection depends on the entire lifestyle or business risk picture staying aligned.",
      promise: "We will turn a complex liability stack into a practical review.",
      checks: [
        "confirm underlying limits are still high enough",
        "review drivers, properties, vehicles, watercraft, staff, and business exposure",
        "flag board seats, rental exposure, public-profile risk, or contract requirements",
      ],
      nextStep: `Reply "liability review" and I will take a first pass at the coverage stack.`,
      imageScene:
        "A polished business owner reviewing operations from a modern office, with subtle location map shapes and company vehicles visible outside.",
    },
    billing: {
      whyNow: "Billing clarity is easiest to fix before invoices, due dates, or payment settings create coverage friction.",
      promise: "We will make the billing path simple and handled.",
      checks: [
        "confirm current invoice, due date, and payment method",
        "check whether autopay or mortgagee billing is set correctly",
        "separate billing questions from endorsement or coverage questions",
      ],
      nextStep: "Reply with the billing item you want checked and I will sort out the next step.",
      imageScene:
        "A calm premium office scene with a laptop, tasteful invoice folder, pen, and warm desk lamp, arranged with high-end minimal styling.",
    },
    quote_completion: {
      whyNow: "The prospect already started the quote, so the message should remove friction and make the next step obvious.",
      promise: "We will help finish the quote from where they left off.",
      checks: [
        "make the reply action simple",
        "set the expectation that a licensed advisor will review next steps",
        "avoid promises about pricing, eligibility, approval, or binding",
      ],
      nextStep: `Reply "YES" and I will have someone pick up the quote from where you left off.`,
      imageScene:
        "A premium laptop and phone on a clean desk with a half-completed digital form visible only as abstract shapes.",
    },
    commercial: {
      whyNow: "Commercial exposures change when operations, locations, contracts, vehicles, payroll, or revenue change.",
      promise: "We will translate the business risk into a clear coverage review.",
      checks: [
        "identify which operations, locations, revenue, payroll, and contracts drive the coverage question",
        "separate core coverage needs from optional endorsements or carrier supplementals",
        "confirm what information must be gathered before a market submission",
      ],
      nextStep: "Reply with the business details you want reviewed and I will take the first pass.",
      imageScene:
        "A polished business owner in a modern office reviewing a clean digital dashboard, with a fleet vehicle and storefront hinted in the background.",
    },
    annual_review: {
      whyNow: "Private-client portfolios change over a year, and review is best done before a carrier or claim forces the issue.",
      promise: "We will act as steward of the full coverage picture.",
      checks: [
        "confirm major asset, driver, location, and ownership changes",
        "review policies that may need updated values, documents, or limits",
        "identify any part of the portfolio that should be shopped or cleaned up",
      ],
      nextStep: `Reply "annual review" and I will prepare the first pass before we schedule anything.`,
      imageScene:
        "An elegant flat lay of a home key, car key, watch, travel passport, and leather portfolio arranged on a stone tabletop.",
    },
    welcome: {
      whyNow: "A strong welcome message reduces uncertainty and helps the client know what happens next.",
      promise: "We will make the portal and agency relationship feel clear from day one.",
      checks: [
        "explain what the client can expect next",
        "invite them to review documents, policies, and contact information",
        "make it easy to reply with corrections or questions",
      ],
      nextStep: "Reply with anything that looks off and I will make sure the right person reviews it.",
      imageScene:
        "A polished welcome scene with a tablet showing abstract portal shapes, a pen, and a small stack of clean documents on a warm modern desk.",
    },
    custom: {
      whyNow: customWhy,
      promise: customPromise,
      checks: customChecks,
      nextStep: customNext,
      imageScene: sceneFromPrompt,
    },
  };
  return frames[intent];
}

function emailForBrief(
  brief: CreativeBrief,
  input: { agencyName: string; senderName: string; signOff: string }
): string {
  const closing = cleanClosingBlock(input);
  return [
    "Hi {first_name},",
    "",
    `${brief.whyNow} ${brief.promise}`,
    "",
    "Here is what I would check first:",
    brief.checks.map((item) => `- ${item}`).join("\n"),
    "",
    brief.nextStep,
    "",
    "If you would rather not receive this type of note, reply and I will update your preferences.",
    "",
    closing,
  ].join("\n");
}

export function cleanClosingBlock(input: { agencyName: string; senderName: string; signOff: string }): string {
  const lines = input.signOff
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const uniqueLines = dedupeClosingLines(lines);
  if (uniqueLines.length > 1) return uniqueLines.join("\n");

  const base = uniqueLines[0] ?? "Warm regards,";
  const nameLine = input.senderName.trim() || input.agencyName.trim();
  if (!nameLine) return base;
  if (closingLineMatches(base, nameLine) || closingLineMatches(base, input.agencyName)) return base;
  return `${base}\n${nameLine}`;
}

function dedupeClosingLines(lines: string[]): string[] {
  const out: string[] = [];
  lines.forEach((line) => {
    const normalized = normalizeClosingLine(line);
    if (!normalized) return;
    if (out.some((existing) => normalizeClosingLine(existing) === normalized)) return;
    out.push(line);
  });
  return out;
}

function closingLineMatches(a: string, b: string): boolean {
  return normalizeClosingLine(a) === normalizeClosingLine(b);
}

function normalizeClosingLine(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function subjectForBrief(brief: CreativeBrief): string {
  const subjects: Record<CreativeIntent, string> = {
    storm: "A coastal-home check before storm season",
    renewal: "A cleaner renewal before terms are finalized",
    auto: "A quick auto coverage tune-up",
    valuables: "Time to refresh your scheduled valuables",
    liability: "A fresh look at your liability stack",
    billing: "A quick billing check before it becomes urgent",
    quote_completion: "Finish your private-client quote",
    commercial: `A practical look at ${brief.topic}`,
    annual_review: "Your annual coverage review",
    welcome: "Welcome to your agency portal",
    custom: `A focused note about ${brief.topic}`,
  };
  return clampSubject(subjects[brief.intent]);
}

function pamphletDescriptionForBrief(brief: CreativeBrief): string {
  return [
    `A marketing-master digital pamphlet about ${brief.topic}.`,
    `It frames the issue around ${brief.whyNow.toLowerCase()}`,
    `The tone is premium, specific, and advisor-led, with a clean call to action: ${brief.nextStep}`,
  ].join(" ");
}

function imagePromptForBrief(brief: CreativeBrief): string {
  return [
    brief.imageScene,
    `The image must visually express ${brief.topic} as a real-world scene with specific people, places, or assets from the brief.`,
    "Luxury editorial photography, realistic materials, refined natural lighting, one clear main subject, no readable text, no logos, no watermarks.",
  ].join(" ");
}

function promptSpecificScene(topic: string, prompt: string): string {
  return `A premium editorial photograph that depicts ${topic} exactly as implied by this manager brief: "${prompt.slice(
    0,
    220
  )}".`;
}

export function campaignPromptTopic(prompt: string): string {
  return inferTopic(prompt, inferIntent(prompt.toLowerCase()));
}

export function promptAwareCampaignImagePrompt(topic: string, prompt: string): string {
  return imagePromptForBrief({
    rawPrompt: prompt,
    topic,
    title: titleCase(topic),
    intent: "custom",
    audience: ["all_clients"],
    channels: ["email"],
    recurrence: "none",
    whyNow: `This is a good moment to make ${topic} clear before it becomes urgent.`,
    promise: `We will turn ${topic} into a simple, advisor-led review instead of a vague insurance task.`,
    checks: [],
    nextStep: "Reply with the item you want reviewed and I will take the first pass.",
    imageScene: promptSpecificScene(topic, prompt),
  });
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ")
    .slice(0, 80);
}

function clampSubject(subject: string): string {
  const cleaned = subject.replace(/\s+/g, " ").trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trim()}...` : cleaned;
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
