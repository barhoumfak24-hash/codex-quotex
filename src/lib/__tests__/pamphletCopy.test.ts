// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { aiDraftPamphlet, type HeroSection, type HighlightsSection, type CtaSection } from "../ai";
import { mergeLLMCopy, parseLLMResponse, type LLMPamphletCopy } from "../pamphletCopy";

// =====================================================================
// LLM pamphlet-copy merging — pure, deterministic, no network. We
// verify that valid LLM output is honored, missing fields fall back
// to the keyword bank, malformed icons are rejected, and the CTA
// highlight is only kept when it actually appears in the title.
// =====================================================================

function freshBase() {
  return aiDraftPamphlet({
    prompt: "Reminder for clients whose vehicles are stored for the winter.",
    agencyName: "Hartland",
  });
}

function hero(p: ReturnType<typeof aiDraftPamphlet>) {
  return p.sections.find((s) => s.kind === "hero") as HeroSection;
}
function highlights(p: ReturnType<typeof aiDraftPamphlet>) {
  return p.sections.find((s) => s.kind === "highlights") as HighlightsSection;
}
function cta(p: ReturnType<typeof aiDraftPamphlet>) {
  return p.sections.find((s) => s.kind === "cta") as CtaSection;
}

describe("mergeLLMCopy", () => {
  it("honors an LLM hero block end-to-end", () => {
    const base = freshBase();
    const copy: LLMPamphletCopy = {
      hero: {
        eyebrow: "A note for you",
        headline: "Spring Is Here?",
        subheadline: "Reactivate your driving coverage today.",
        intro: "Hartland is ready to walk you through the reinstatement step by step.",
      },
    };
    const merged = mergeLLMCopy(base, copy);
    expect(hero(merged).headline).toBe("Spring Is Here?");
    expect(hero(merged).subheadline).toBe("Reactivate your driving coverage today.");
    expect(hero(merged).intro).toMatch(/Hartland/);
  });

  it("falls back to the base section when an LLM field is missing", () => {
    const base = freshBase();
    const baseHeadline = hero(base).headline;
    const copy: LLMPamphletCopy = { hero: { subheadline: "Only this one was set." } };
    const merged = mergeLLMCopy(base, copy);
    expect(hero(merged).headline).toBe(baseHeadline);
    expect(hero(merged).subheadline).toBe("Only this one was set.");
  });

  it("merges highlights, validating icons and capping at 4 items", () => {
    const base = freshBase();
    const copy: LLMPamphletCopy = {
      highlights: {
        title: "Why reactivate now?",
        items: [
          { icon: "shield-check", label: "Restore your full driving protection" },
          { icon: "not-a-real-icon", label: "Avoid a coverage gap before your first drive" },
          { icon: "calendar", label: "Confirm coverage is active before you drive" },
          { icon: "wheel", label: "Get road ready for spring" },
          // Extra fifth item — should be dropped.
          { icon: "flame", label: "Should not appear" },
        ],
      },
    };
    const merged = mergeLLMCopy(base, copy);
    const h = highlights(merged);
    expect(h.title).toBe("Why reactivate now?");
    expect(h.items).toHaveLength(4);
    expect(h.items[0].label).toBe("Restore your full driving protection");
    // Invalid icon falls back to the base icon at that position.
    expect(h.items[1].icon).toBe(highlights(base).items[1].icon);
    expect(h.items[3].label).toBe("Get road ready for spring");
  });

  it("keeps the LLM CTA highlight only when it appears in the title", () => {
    const base = freshBase();
    const goodCopy: LLMPamphletCopy = {
      cta: {
        title: "Before you drive again, reactivate your stored vehicle coverage with Hartland.",
        highlight: "reactivate your stored vehicle coverage",
        button: "Reactivate my coverage",
      },
    };
    const goodMerged = mergeLLMCopy(base, goodCopy);
    expect(cta(goodMerged).title).toMatch(/reactivate/);
    expect(cta(goodMerged).highlight).toBe("reactivate your stored vehicle coverage");

    const baseHighlight = cta(base).highlight;
    const mismatched: LLMPamphletCopy = {
      cta: {
        title: "Schedule your coverage review with Hartland.",
        highlight: "this phrase is not in the title",
        button: "Schedule my review",
      },
    };
    const mergedMismatch = mergeLLMCopy(base, mismatched);
    expect(cta(mergedMismatch).highlight).toBe(baseHighlight);
  });

  it("returns the base unchanged when the LLM copy is empty", () => {
    const base = freshBase();
    const merged = mergeLLMCopy(base, {});
    expect(merged).toEqual(base);
  });

  it("writes the LLM-authored imagePrompt onto the pamphlet so it stays in sync with the copy", () => {
    const base = freshBase();
    const copy: LLMPamphletCopy = {
      imagePrompt:
        "A vintage Porsche 911 covered with a soft fabric car cover inside a heated home garage at dawn, snow falling outside the open garage door.",
    };
    const merged = mergeLLMCopy(base, copy);
    expect(merged.heroImagePrompt).toMatch(/Porsche 911/);
    expect(merged.heroImagePrompt).toMatch(/snow falling outside/);
  });

  it("keeps the base heroImagePrompt when the LLM does not supply one", () => {
    const base = { ...freshBase(), heroImagePrompt: "existing scene description" };
    const merged = mergeLLMCopy(base, { hero: { headline: "New Headline" } });
    expect(merged.heroImagePrompt).toBe("existing scene description");
  });
});

describe("parseLLMResponse", () => {
  it("parses a plain JSON response", () => {
    const out = parseLLMResponse('{"hero":{"headline":"X"}}');
    expect(out.hero?.headline).toBe("X");
  });

  it("strips markdown code fences", () => {
    const out = parseLLMResponse('```json\n{"hero":{"headline":"X"}}\n```');
    expect(out.hero?.headline).toBe("X");
  });

  it("extracts the first JSON object from surrounding prose", () => {
    const out = parseLLMResponse(
      "Sure, here is your pamphlet copy:\n{\"hero\":{\"headline\":\"X\"}}\nHope this helps."
    );
    expect(out.hero?.headline).toBe("X");
  });

  it("throws on completely unparseable input", () => {
    expect(() => parseLLMResponse("not even close to JSON")).toThrow();
  });
});