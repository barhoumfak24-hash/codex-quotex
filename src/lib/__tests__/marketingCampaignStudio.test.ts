// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  draftMarketingStudioCampaign,
  MARKETING_STUDIO_CTA_BUTTON,
  marketingStudioImageUrl,
  normalizeStudioDraft,
} from "../marketingCampaignStudio";

const rawDraft = {
  campaignName: "Commercial Umbrella Expansion Review",
  strategy:
    "Position the campaign around a business owner whose footprint has outgrown the old liability stack.",
  channels: ["email", "fax"],
  audience: ["all_clients", "not_real"],
  recurrence: "weekly",
  emailSubject: "Your business may have outgrown its umbrella limit",
  emailBody:
    "Hi {first_name},\n\nWhen a business adds locations, vehicles, contracts, or higher revenue, the old umbrella structure can stop matching the real exposure. We will review the current underlying limits, any new operating locations, company vehicles, contract requirements, and the limit stack before renewal decisions get rushed.\n\nReply with any recent business changes and I will take the first pass.\n\nWarm regards,\nThe agency team",
  pamphlet: {
    eyebrow: "Commercial Protection",
    headline: "Has Your Business Outgrown Its Umbrella?",
    subheadline: "Review the liability stack before growth creates gaps.",
    intro:
      "A growing business can change its liability profile faster than the policy file changes. New locations, vehicles, contracts, and revenue can all affect how much excess protection is appropriate. This review helps the agency identify what changed, what carriers may ask for, and what should be cleaned up before renewal pressure begins.",
    highlightsTitle: "What the review clarifies",
    highlights: [
      "Confirm underlying liability limits",
      "Review new locations and vehicles",
      "Identify contract-driven requirements",
      "Prepare cleaner carrier submissions",
      "Remove rushed renewal pressure",
      "Extra item should be trimmed",
    ],
    ctaTitle: "Review your commercial umbrella structure with the agency.",
    ctaButton: "Schedule a review",
    imagePrompt:
      "A polished business owner stands inside a modern operations office overlooking a small fleet vehicle and storefront. Editorial lighting, premium realistic photography, no text, no logos, no paperwork.",
  },
};

beforeEach(() => {
  vi.stubEnv("VITE_ALLOW_BROWSER_AI_FALLBACKS", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marketingCampaignStudio", () => {
  it("generates a complete campaign without requiring a connected server AI provider", async () => {
    const draft = await draftMarketingStudioCampaign({
      prompt:
        "Create a premium digital pamphlet for commercial umbrella clients who added locations and company vehicles.",
      agencyName: "Palm Coast Private Client",
      senderName: "Olivia Marsh",
      signOff: "Warm regards,",
    });

    expect(draft.campaignName).toMatch(/commercial|umbrella|liability/i);
    expect(draft.emailSubject).toMatch(/commercial|liability|umbrella|business/i);
    expect(draft.emailBody.split(/\s+/).length).toBeGreaterThan(45);
    expect(draft.pamphlet.headline).toMatch(/business|growth|liability|umbrella/i);
    expect(draft.pamphlet.highlights.length).toBeGreaterThanOrEqual(3);
    expect(draft.pamphlet.imagePrompt).toMatch(/business|commercial|vehicle|office/i);
    expect(draft.pamphlet.ctaButton).toBe(MARKETING_STUDIO_CTA_BUTTON);
  });

  it("returns a complete campaign when the production AI provider is unavailable", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_ALLOW_BROWSER_AI_FALLBACKS", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const draft = await draftMarketingStudioCampaign({
      prompt: "Create a storm readiness campaign for coastal home clients.",
      agencyName: "Palm Coast Private Client",
    });

    expect(draft.emailSubject).toMatch(/storm|home|coastal/i);
    expect(draft.emailBody.split(/\s+/).length).toBeGreaterThan(45);
    expect(draft.pamphlet.highlights.length).toBeGreaterThanOrEqual(3);
  });

  it("returns a complete campaign when the AI provider response is malformed", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_ALLOW_BROWSER_AI_FALLBACKS", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ campaignName: "Incomplete response" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const draft = await draftMarketingStudioCampaign({
      prompt: "Create a renewal review campaign for private clients.",
      agencyName: "Palm Coast Private Client",
    });

    expect(draft.campaignName).toMatch(/renewal/i);
    expect(draft.emailBody.split(/\s+/).length).toBeGreaterThan(45);
    expect(draft.pamphlet.imagePrompt.length).toBeGreaterThan(20);
  });

  it.each([
    "Prepare coastal homeowners for hurricane season.",
    "Remind auto clients to review stored vehicles.",
    "Ask private clients to update jewelry appraisals.",
    "Create a commercial cyber liability awareness campaign.",
    "Help prospects finish an incomplete quote.",
    "Explain upcoming renewal reviews.",
    "Welcome new clients to their agency portal.",
  ])("always produces an executable fallback for: %s", async (prompt) => {
    vi.stubEnv("VITE_AI_MODE", "server");
    vi.stubEnv("VITE_ALLOW_BROWSER_AI_FALLBACKS", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const draft = await draftMarketingStudioCampaign({ prompt, agencyName: "Palm Coast Private Client" });

    expect(draft.campaignName.length).toBeGreaterThan(3);
    expect(draft.emailSubject.length).toBeGreaterThan(7);
    expect(draft.emailBody).toContain("{first_name}");
    expect(draft.pamphlet.highlights.length).toBeGreaterThanOrEqual(3);
    expect(draft.pamphlet.ctaButton).toBe(MARKETING_STUDIO_CTA_BUTTON);
  });

  it("normalizes a complete AI campaign without using legacy campaign fallback fields", () => {
    const draft = normalizeStudioDraft(rawDraft);
    expect(draft.campaignName).toBe("Commercial Umbrella Expansion Review");
    expect(draft.channels).toEqual(["email"]);
    expect(draft.audience).toEqual(["all_clients"]);
    expect(draft.recurrence).toBe("weekly");
    expect(draft.emailBody).toContain("{first_name}");
    expect(draft.pamphlet.highlights).toHaveLength(5);
    expect(draft.pamphlet.imagePrompt).toMatch(/business owner/i);
    expect(draft.pamphlet.ctaButton).toBe("Get in touch");
  });

  it("does not repeat the agency name in the generated email closing", async () => {
    const draft = await draftMarketingStudioCampaign({
      prompt: "Reminder to take cars out of storage and review auto coverage.",
      agencyName: "Palm Coast Private Client",
      senderName: "Palm Coast Private Client Concierge Team",
      signOff: "Best,\nPalm Coast Private Client",
    });
    const closing = draft.emailBody.split("If you would rather not receive this type of note")[1] ?? "";
    expect(closing.match(/Palm Coast Private Client/g)?.length).toBe(1);
    expect(closing).not.toContain("Palm Coast Private Client Concierge Team");
  });

  it("rejects incomplete AI output instead of silently creating a weak campaign", () => {
    expect(() => normalizeStudioDraft({ ...rawDraft, emailBody: "Reach out with questions." })).toThrow(
      /too thin/i
    );
    expect(() => normalizeStudioDraft({ ...rawDraft, pamphlet: { ...rawDraft.pamphlet, imagePrompt: "" } })).toThrow(
      /imagePrompt/i
    );
  });

  it("builds a high-resolution curated image URL without requiring the backend image route", () => {
    const draft = normalizeStudioDraft(rawDraft);
    const url = marketingStudioImageUrl(draft, 123);
    expect(url).toContain("images.unsplash.com");
    expect(url).toContain("w=1800");
    expect(url).toContain("h=1200");
    expect(url).toContain("q=92");
  });
});
