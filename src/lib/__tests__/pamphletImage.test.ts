// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { aiDraftPamphlet } from "../ai";
import { buildHeroImagePrompt, heroImageUrl, nextHeroImageSeed } from "../pamphletImage";

// =====================================================================
// AI-generated pamphlet imagery through the server image gateway.
// Verify the prompt builder pulls in the accent-specific scene + the
// hero headline, the URL is deterministic per seed, and seed cycling
// produces different values so "Regenerate image" actually changes
// the picture.
// =====================================================================

describe("buildHeroImagePrompt", () => {
  it("includes the accent's canonical scene description", () => {
    const p = aiDraftPamphlet({
      prompt: "Reminder for clients whose vehicles are stored for the winter.",
      agencyName: "Hartland",
    });
    const prompt = buildHeroImagePrompt(p);
    expect(prompt).toMatch(/covered with a soft fabric car cover/);
    expect(prompt).toMatch(/photorealistic/);
    expect(prompt).toMatch(/no text/);
  });

  it("biases the prompt with the hero headline", () => {
    const p = aiDraftPamphlet({
      prompt: "Reminder for clients whose vehicles are stored for the winter.",
      agencyName: "Hartland",
    });
    const prompt = buildHeroImagePrompt(p);
    expect(prompt).toMatch(/Stored for the Winter/);
  });

  it("falls back to the generic scene for unknown accents", () => {
    const p = aiDraftPamphlet({
      prompt: "Year-end thank-you note for all clients.",
      agencyName: "Whitford",
    });
    const prompt = buildHeroImagePrompt(p);
    // Generic scene contains "insurance advisor's office" wording.
    expect(prompt.length).toBeGreaterThan(80);
  });

  it("prefers the LLM-authored heroImagePrompt over the accent default", () => {
    const base = aiDraftPamphlet({
      prompt: "Reminder for clients whose vehicles are stored for the winter.",
      agencyName: "Hartland",
    });
    const withLLM = {
      ...base,
      heroImagePrompt:
        "An elegant covered Porsche 911 inside a Hartland clients home garage at dawn",
    };
    const prompt = buildHeroImagePrompt(withLLM);
    expect(prompt).toMatch(/Porsche 911/);
    expect(prompt).toMatch(/Hartland clients home garage/);
    // Style suffix still applied.
    expect(prompt).toMatch(/photorealistic/);
  });
});

describe("heroImageUrl", () => {
  it("emits a deterministic local image URL in frontend-only demo mode", () => {
    const p = aiDraftPamphlet({
      prompt: "Storm season is here — review coastal coverage.",
      agencyName: "Palm Coast",
    });
    const url = heroImageUrl(p);
    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(url)).toContain("AI image pending");
  });

  it("is deterministic for the same pamphlet (same URL across calls)", () => {
    const p = aiDraftPamphlet({
      prompt: "Renewal nudge for auto policy clients.",
      agencyName: "Whitford",
    });
    expect(heroImageUrl(p)).toBe(heroImageUrl(p));
  });

  it("changes when the seed changes", () => {
    const p = aiDraftPamphlet({
      prompt: "Renewal nudge for auto policy clients.",
      agencyName: "Whitford",
    });
    const a = heroImageUrl(p);
    const b = heroImageUrl({ ...p, heroImageSeed: (p.heroImageSeed ?? 0) + 1 });
    expect(a).not.toBe(b);
  });
});

describe("nextHeroImageSeed", () => {
  it("produces a different seed than the input", () => {
    expect(nextHeroImageSeed(42)).not.toBe(42);
    expect(nextHeroImageSeed(0)).not.toBe(0);
  });

  it("returns a non-negative 31-bit integer", () => {
    const v = nextHeroImageSeed(123456);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(2 ** 31);
    expect(Number.isInteger(v)).toBe(true);
  });
});
