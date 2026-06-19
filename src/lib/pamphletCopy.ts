import {
  aiDraftPamphlet,
  type CtaSection,
  type DraftedPamphlet,
  type DraftPamphletInput,
  type HeroSection,
  type HighlightsSection,
  type PamphletIconKey,
} from "./ai";
import { postServerAi } from "./aiGateway";

// =====================================================================
// LLM-driven pamphlet copy.
//
// Same provider family as the image generator — no agency-managed API
// key is exposed in the browser. The server gateway runs the model and returns
// validated JSON output matching our
// pamphlet schema, then merges the authored hero / highlights / CTA
// onto a base pamphlet built from the existing keyword variant bank.
//
// If the network call fails, the JSON doesn't parse, or any field is
// missing, the base pamphlet is returned unchanged so the manager
// always sees a usable draft. This keeps the system online even when
// the model endpoint is rate-limited or down.
// =====================================================================

// Valid icon keys for highlight items — must match PamphletIconKey
// exactly. We validate every icon the LLM emits against this set and
// fall back to "shield-check" if the LLM hallucinates something else.
const VALID_ICONS: ReadonlySet<PamphletIconKey> = new Set<PamphletIconKey>([
  "snowflake",
  "lock",
  "flame",
  "cloud-rain",
  "wheel",
  "home",
  "car",
  "gem",
  "umbrella",
  "shield-check",
  "calendar",
  "refresh",
  "sparkles",
  "sun",
  "droplets",
  "bolt",
  "compass",
  "scale",
  "phone",
  "mail",
  "map-pin",
  "globe",
  "clock",
  "heart",
  "trending-up",
  "check",
  "x",
  "star",
  "users",
  "wallet",
  "key",
  "warehouse",
  "wave",
  "anchor",
]);

const SYSTEM_PROMPT = `You are a senior marketing copywriter for a high-end private-client insurance agency. You write SHORT, advisory, professional pamphlet copy. Your tone is refined and consultative — never salesy, never casual, never breezy. You write the way Brunello Cucinelli or Cartier write to their clientele.

Interpretation rules:
- The manager may type anything: a rough thought, a half sentence, a niche commercial risk, a seasonal idea, or a fully formed brief.
- Do not merely repeat the prompt. Extract the audience, the risk, the emotional angle, the immediate reason this matters, and the clean next step.
- If the prompt is vague, make the strongest reasonable private-client insurance interpretation and keep it editable.
- The copy and image prompt must be about the same subject. A commercial umbrella prompt must look and read like commercial umbrella liability, not generic insurance paperwork.
- Never invent carrier approvals, binding status, pricing, savings, legal advice, claim outcomes, or guaranteed coverage.

Style rules (every output MUST follow):
- Use "Thank you" instead of "Thanks".
- Never use exclamation marks.
- Avoid casual contractions: write "you will" instead of "you'll", "we will" instead of "we'll", "do not" instead of "don't", "it is" instead of "it's".
- Never use emoji.
- Avoid AI-flavored filler like "Let's dive in", "Imagine this", "In today's fast-paced world".
- Headlines are short, often question form ("Stored for the Winter?"). 3 to 7 words.
- Subheadlines are action-oriented sentences ("Now it is time to reinstate your driving coverage."). 7 to 12 words.
- Hero body is 3 to 4 sentences (50-90 words) that explain WHY this matters NOW and what the agency will do. Refer to the agency by name where natural.
- Highlight items are BENEFITS the client gets (not features the agency offers). 4 to 8 words each. Start each with a verb where natural ("Restore full driving protection", "Avoid a coverage gap before your first drive").
- The CTA title is a single action sentence ending with "with {agencyName}." and naturally contains the button verb. 12 to 20 words.
- The CTA highlight is a substring of the CTA title (copy it exactly, character for character) that names the key action phrase — what gets painted in the accent color on the pamphlet.
- The CTA button is an action verb + noun phrase, 3 to 5 words ("Reinstate my coverage", "Re-shop my renewal").

You produce ONLY JSON matching the schema. No prose around it. No markdown fences. No commentary.

Schema:
{
  "hero": {
    "eyebrow": "string (2-4 words, title case, e.g. 'A note for you')",
    "headline": "string (3-7 words, question form preferred)",
    "subheadline": "string (action-oriented, 7-12 words)",
    "intro": "string (3-4 sentences, 50-90 words, names the agency at least once)"
  },
  "highlights": {
    "title": "string (question form, e.g. 'Why reinstate your coverage now?')",
    "items": [
      { "icon": "one of: shield-check, lock, flame, cloud-rain, wheel, home, car, gem, umbrella, calendar, refresh, sparkles, sun, droplets, bolt, compass, scale, phone, mail, map-pin, globe, clock, heart, trending-up, check, users, wallet, key, warehouse, wave, anchor", "label": "string (4-8 words, benefit-focused)" }
    ]
  },
  "cta": {
    "title": "string (12-20 words, ends with 'with {agencyName}.')",
    "highlight": "string (exact substring of title — the key action phrase)",
    "button": "string (3-5 words, action verb + noun)"
  },
  "imagePrompt": "string (2-3 sentences describing the PERFECT editorial photograph for this exact pamphlet — must depict the campaign's specific subject from the brief, not a generic stock scene. Be concrete about the main subject, the setting, the time of day, the lighting, and the mood. Stay in the luxury magazine aesthetic. Do NOT mention text, logos, watermarks, or insurance documents. Example for a winter-stored vehicle pamphlet: 'A luxury vintage sports car covered with a soft beige fabric car cover, parked inside a pristine heated home garage. Snow is falling gently outside the open garage door, snowy pine trees visible in the background. Warm overhead pendant lighting, polished concrete floor, soft golden hour light spilling in from outside.'"
}

The "highlights.items" array MUST contain exactly 4 items.
The "imagePrompt" MUST match the subject of the pamphlet copy — if the hero is about a stored vehicle, the picture should depict that vehicle in storage, not a generic insurance office.`;

interface LLMHero {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  intro?: string;
}
interface LLMHighlightItem {
  icon?: string;
  label?: string;
}
interface LLMHighlights {
  title?: string;
  items?: LLMHighlightItem[];
}
interface LLMCta {
  title?: string;
  highlight?: string;
  button?: string;
}
export interface LLMPamphletCopy {
  hero?: LLMHero;
  highlights?: LLMHighlights;
  cta?: LLMCta;
  imagePrompt?: string;
}

// Public entry point. Builds the base pamphlet from the keyword bank
// (instant, always works), then upgrades the hero / highlights / CTA
// copy with an LLM-authored version. Returns the base unchanged if
// the LLM call fails for any reason.
export async function aiDraftPamphletLLM(
  input: DraftPamphletInput
): Promise<DraftedPamphlet> {
  const base = aiDraftPamphlet(input);
  try {
    const copy = await fetchPamphletCopyFromLLM(input);
    return mergeLLMCopy(base, copy);
  } catch {
    return base;
  }
}

// Exposed for tests + the per-section regenerator. Pure merge —
// no network, no side effects. Validates every field the LLM
// returned and falls back to the base content for anything missing
// or malformed.
export function mergeLLMCopy(
  base: DraftedPamphlet,
  copy: LLMPamphletCopy
): DraftedPamphlet {
  const sections = base.sections.map((s) => {
    if (s.kind === "hero" && copy.hero) {
      const merged: HeroSection = {
        ...s,
        eyebrow: cleanField(copy.hero.eyebrow) ?? s.eyebrow,
        headline: cleanField(copy.hero.headline) ?? s.headline,
        subheadline: cleanField(copy.hero.subheadline) ?? s.subheadline,
        intro: cleanField(copy.hero.intro) ?? s.intro,
      };
      return merged;
    }
    if (s.kind === "highlights" && copy.highlights) {
      const items = Array.isArray(copy.highlights.items)
        ? copy.highlights.items.slice(0, 4)
        : [];
      const merged: HighlightsSection = {
        ...s,
        title: cleanField(copy.highlights.title) ?? s.title,
        items: s.items.map((existing, i) => {
          const llm = items[i];
          if (!llm) return existing;
          const icon = isValidIcon(llm.icon) ? (llm.icon as PamphletIconKey) : existing.icon;
          const label = cleanField(llm.label) ?? existing.label;
          return { ...existing, icon, label };
        }),
      };
      return merged;
    }
    if (s.kind === "cta" && copy.cta) {
      const title = cleanField(copy.cta.title) ?? s.title;
      // Only carry the LLM's highlight forward if it's actually
      // present in the title — otherwise the renderer's substring
      // match would silently drop it. Fall back to the base highlight
      // when the LLM's choice doesn't match.
      const llmHighlight = cleanField(copy.cta.highlight);
      const highlight =
        llmHighlight && title.includes(llmHighlight) ? llmHighlight : s.highlight;
      const merged: CtaSection = {
        ...s,
        title,
        highlight,
        button: cleanField(copy.cta.button) ?? s.button,
      };
      return merged;
    }
    return s;
  });
  const heroImagePrompt = cleanField(copy.imagePrompt) ?? base.heroImagePrompt;
  return { ...base, sections, heroImagePrompt };
}

function cleanField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Models occasionally wrap strings in extra quotes or escape
  // backslashes — strip the obvious ones rather than rendering them
  // verbatim in the pamphlet.
  return trimmed
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function isValidIcon(value: unknown): boolean {
  return typeof value === "string" && VALID_ICONS.has(value as PamphletIconKey);
}

async function fetchPamphletCopyFromLLM(
  input: DraftPamphletInput
): Promise<LLMPamphletCopy> {
  const copy = await postServerAi<LLMPamphletCopy>(
    "/ai/draft-pamphlet",
    {
      prompt: input.prompt,
      agencyName: input.agencyName,
      campaignDescription: input.campaignDescription,
      heroImagePrompt: input.heroImagePrompt,
      accent: input.accent,
      tone: input.tone,
      systemHint: SYSTEM_PROMPT,
    },
    { timeoutMs: 24_000 }
  );
  if (!copy) throw new Error("Pamphlet AI provider unavailable");
  return copy;
}

export function parseLLMResponse(raw: string): LLMPamphletCopy {
  const trimmed = raw.trim();
  // Strip markdown code fences if present.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Find the first balanced JSON object in the response.
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(unfenced.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error("LLM response was not valid JSON");
  }
}
