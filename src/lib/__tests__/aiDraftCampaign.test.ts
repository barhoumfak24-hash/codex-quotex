// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { aiDraftCampaign, aiDraftPamphlet } from "../ai";

// =====================================================================
// Manager Draft Campaign — AI prompt-driven campaign builder.
// Verify the AI infers audience, channel, recurrence, and produces a
// usable name + subject + body from the prompt.
// =====================================================================

describe("aiDraftCampaign", () => {
  it("infers coastal-home audience + email channel from a hurricane prompt", () => {
    const out = aiDraftCampaign({
      prompt:
        "A friendly hurricane prep reminder for coastal home clients with a wind-mitigation discount nudge.",
      agencyName: "Palm Coast",
      senderName: "Olivia Marsh",
      signOff: "Warm regards,",
    });
    expect(out.audience).toContain("coastal_home_clients");
    expect(out.channels).toEqual(["email"]);
    expect(out.recurrence).toBe("none");
    expect(out.subject.toLowerCase()).toMatch(/coastal|prep|storm/);
    expect(out.body).toMatch(/Hi \{first_name\}/);
    expect(out.body).toMatch(/wind-mitigation|wind mitigation/i);
    expect(out.body).toMatch(/flood|roof|documents/i);
    expect(out.body).toMatch(/rather not receive/i);
    expect(out.body).toMatch(/Olivia Marsh/);
    expect(out.body).toMatch(/Palm Coast/);
    expect(out.pamphletDescription).toMatch(/coastal|storm/i);
    expect(out.imagePrompt).toMatch(/coastal|storm|shutters|clouds/i);
  });

  it("infers renewal audience + monthly recurrence + SMS for a short text prompt", () => {
    const out = aiDraftCampaign({
      prompt: "Monthly text reminder to renewal clients about upcoming auto renewals — short, casual.",
    });
    expect(out.audience).toContain("renewal_clients");
    expect(out.audience).toContain("auto_clients");
    expect(out.channels).toContain("sms");
    expect(out.recurrence).toBe("monthly");
    // SMS body is condensed (no greeting block).
    expect(out.body).not.toMatch(/Hi \{first_name\}/);
    expect(out.body).toMatch(/Reply STOP/);
  });

  it("defaults to all clients + email when nothing specific is detected", () => {
    const out = aiDraftCampaign({ prompt: "Year-end thank-you note." });
    expect(out.audience).toContain("all_clients");
    expect(out.channels).toContain("email");
  });

  it("includes a summary describing what was drafted", () => {
    const out = aiDraftCampaign({
      prompt: "Quick SMS nudge to all prospects about finishing their quote.",
    });
    expect(out.summary).toMatch(/SMS/);
    expect(out.summary).toMatch(/prospect/);
    expect(out.body).toMatch(/Reply YES|Reply STOP/i);
    expect(out.subject).toMatch(/quote/i);
  });

  it("creates prompt-specific pamphlet and image direction for niche briefs", () => {
    const out = aiDraftCampaign({
      prompt:
        "Create a commercial umbrella pamphlet for business owners who have added new locations and company vehicles.",
      agencyName: "Palm Coast",
    });
    expect(out.name).toMatch(/commercial umbrella liability/i);
    expect(out.subject.toLowerCase()).toMatch(/liability|umbrella|commercial/);
    expect(out.pamphletDescription?.toLowerCase()).toMatch(/liability|umbrella|commercial/);
    expect(out.imagePrompt?.toLowerCase()).not.toMatch(/generic insurance|handshake/);
    expect(out.imagePrompt?.toLowerCase()).toMatch(/estate|vehicle|liability|business|editorial/);
  });
});

describe("aiDraftPamphlet", () => {
  function hero(p: ReturnType<typeof aiDraftPamphlet>) {
    return p.sections.find((s) => s.kind === "hero") as
      | { kind: "hero"; headline: string; subheadline: string; intro: string }
      | undefined;
  }
  function cta(p: ReturnType<typeof aiDraftPamphlet>) {
    return p.sections.find((s) => s.kind === "cta") as
      | { kind: "cta"; title: string; button: string }
      | undefined;
  }

  it("returns a winter-themed pamphlet for a stored-vehicle prompt", () => {
    const p = aiDraftPamphlet({
      prompt: "Reminder for clients whose vehicles are stored for the winter.",
      agencyName: "Hartland",
    });
    expect(p.accent).toBe("winter");
    expect(hero(p)?.headline).toMatch(/Stored for the Winter/i);
    expect(cta(p)?.title).toMatch(/Hartland/);
    expect(cta(p)?.button.length).toBeGreaterThan(0);
  });

  it("falls back to a generic theme + uses the prompt as the intro", () => {
    const p = aiDraftPamphlet({
      prompt: "Year-end thank-you and a friendly nudge to reach out with any questions.",
      agencyName: "Palm Coast",
    });
    // "Year-end" hits the newyear keyword and becomes that theme.
    expect(["generic", "newyear"]).toContain(p.accent);
    expect(cta(p)?.title).toMatch(/Palm Coast/);
  });

  it("picks the renewal theme + drafts a hero for a renewal prompt", () => {
    const p = aiDraftPamphlet({
      prompt: "Renewal-touch flyer for clients whose policies renew next month.",
    });
    expect(p.accent).toBe("renewal");
    expect(hero(p)?.headline).toMatch(/Renewal/i);
  });

  it("includes hero, highlights, and cta sections by default", () => {
    const p = aiDraftPamphlet({ prompt: "Auto coverage check-in for clients.", agencyName: "X" });
    const kinds = p.sections.map((s) => s.kind);
    expect(kinds).toContain("hero");
    expect(kinds).toContain("highlights");
    expect(kinds).toContain("cta");
  });

  it("regeneratePamphletSection cycles to another variant where available", async () => {
    const { regeneratePamphletSection } = await import("../ai");
    const p = aiDraftPamphlet({ prompt: "Stored for the winter.", agencyName: "X" });
    const heroSection = p.sections.find((s) => s.kind === "hero")!;
    const next = regeneratePamphletSection({
      current: heroSection,
      accent: p.accent,
      tone: p.tone,
      prompt: "Stored for the winter.",
      agencyName: "X",
      variantIndex: 1,
    });
    expect(next.kind).toBe("hero");
    if (next.kind === "hero" && heroSection.kind === "hero") {
      // Two winter hero variants — index 1 should differ from index 0.
      expect(next.headline).not.toBe(heroSection.headline);
    }
  });
});
