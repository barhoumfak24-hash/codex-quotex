// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiDraftCampaign } from "../ai";
import {
  aiDraftCampaignLLM,
  mergeLLMCampaignDraft,
  parseCampaignLLMResponse,
} from "../campaignCopy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("campaignCopy LLM drafting", () => {
  it("parses fenced JSON responses", () => {
    const parsed = parseCampaignLLMResponse(
      '```json\n{"name":"Storm prep","channels":["email"],"audience":["coastal_home_clients"]}\n```'
    );
    expect(parsed.name).toBe("Storm prep");
    expect(parsed.channels).toEqual(["email"]);
  });

  it("validates and hardens the LLM draft before the UI executes it", () => {
    const base = aiDraftCampaign({
      prompt: "Weekly email and text to renewal clients about reviewing auto renewals.",
      agencyName: "Palm Coast",
      senderName: "Olivia Marsh",
    });
    const merged = mergeLLMCampaignDraft(
      base,
      {
        name: "Renewal Review Sprint",
        subject: "A clean renewal review before your next term",
        body: "We will review your renewal options and compare your current program before the deadline.",
        channels: ["email", "fax", "sms"],
        audience: ["renewal_clients", "not_real"],
        recurrence: "weekly",
        summary: "AI interpreted the brief as a weekly renewal review for auto clients.",
        pamphletDescription:
          "A premium renewal pamphlet that explains the client's next term review in plain language.",
        imagePrompt:
          "A luxury sedan in a clean residential driveway beside a leather portfolio and calendar, warm morning light, editorial photography, no text.",
      },
      {
        agencyName: "Palm Coast",
        senderName: "Olivia Marsh",
        signOff: "Warm regards,",
      }
    );

    expect(merged.name).toBe("Renewal Review Sprint");
    expect(merged.channels).toEqual(["email", "sms"]);
    expect(merged.audience).toEqual(["renewal_clients"]);
    expect(merged.recurrence).toBe("weekly");
    expect(merged.body).toContain("{first_name}");
    expect(merged.body).toContain("Reply STOP to opt out.");
    expect(merged.body).toContain("Olivia Marsh");
    expect(merged.pamphletDescription).toMatch(/renewal pamphlet/i);
    expect(merged.imagePrompt).toMatch(/luxury sedan/i);
  });

  it("rejects thin generic model copy and keeps the stronger local strategy", () => {
    const base = aiDraftCampaign({
      prompt: "Email coastal home clients about storm prep and wind mitigation documents.",
      agencyName: "Palm Coast",
      senderName: "Olivia Marsh",
    });
    const merged = mergeLLMCampaignDraft(
      base,
      {
        name: "Storm Note",
        subject: "Insurance update",
        body: "We value your business. Reach out with any questions.",
        channels: ["email"],
        audience: ["coastal_home_clients"],
        recurrence: "none",
      },
      {
        agencyName: "Palm Coast",
        senderName: "Olivia Marsh",
      }
    );

    expect(merged.subject).toBe(base.subject);
    expect(merged.body).toContain("wind");
    expect(merged.body).toContain("If you would rather not receive");
  });

  it("uses the text model response when available", async () => {
    vi.stubEnv("VITE_AI_MODE", "server");
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          name: "Quote Completion Push",
          subject: "Finish your private-client quote",
          body: "Palm Coast Concierge: We can finish your quote today with one quick reply. Reply YES for a call.",
          channels: ["sms"],
          audience: ["all_prospects"],
          recurrence: "none",
          summary: "AI read the brief as a concise prospect SMS completion nudge.",
          pamphletDescription:
            "A conversion pamphlet that removes friction from finishing a private-client quote.",
          imagePrompt:
            "A premium laptop and phone on a clean desk with a partially completed digital quote form shown abstractly, warm concierge office lighting.",
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await aiDraftCampaignLLM({
      prompt: "short SMS to all prospects who abandoned a quote, ask them to reply YES",
      agencyName: "Palm Coast",
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(out.name).toBe("Quote Completion Push");
    expect(out.channels).toEqual(["sms"]);
    expect(out.audience).toEqual(["all_prospects"]);
    expect(out.body).toContain("Reply STOP to opt out.");
    expect(out.pamphletDescription).toMatch(/conversion pamphlet/i);
    expect(out.imagePrompt).toMatch(/premium laptop/i);
  });

  it("falls back to the deterministic drafter if the model fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    const prompt = "Monthly text reminder to renewal clients about upcoming auto renewals.";
    const out = await aiDraftCampaignLLM({ prompt });
    const fallback = aiDraftCampaign({ prompt });

    expect(out).toEqual(fallback);
  });
});
