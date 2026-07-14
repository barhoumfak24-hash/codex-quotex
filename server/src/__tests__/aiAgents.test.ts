import { describe, expect, it } from "vitest";
import { publicAiAgentManifest, QUOTEX_AI_AGENTS } from "../services/ai/agents.js";

const EXPECTED_TRIGGERS = [
  "/ai/parse-intake",
  "/ai/premium-estimate",
  "/ai/carrier-match",
  "/ai/marketing-message",
  "/ai/email-subject",
  "/ai/enhance-message",
  "/ai/extract-contact",
  "/ai/extract-policy",
  "/ai/enrich-asset",
  "/ai/parse-carrier-appetite",
  "/ai/acord-map document_autofill",
  "/ai/acord-map questionnaire_prefill",
  "/ai/draft-campaign",
  "/ai/marketing-creative",
  "/ai/draft-pamphlet",
  "/ai/portal-assistant",
  "/ai/sort-intent",
];

describe("Quotex AI agent registry", () => {
  it("has a dedicated agent for every live AI action", () => {
    const triggers = new Set(Object.values(QUOTEX_AI_AGENTS).map((agent) => agent.trigger));
    EXPECTED_TRIGGERS.forEach((trigger) => {
      expect(triggers.has(trigger), `missing agent for ${trigger}`).toBe(true);
    });
  });

  it("publishes safe non-secret agent metadata", () => {
    const manifest = publicAiAgentManifest();
    const ids = manifest.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    manifest.forEach((agent) => {
      expect(agent.label).toBeTruthy();
      expect(agent.purpose).toBeTruthy();
      expect(agent).not.toHaveProperty("instructions");
      expect(JSON.stringify(agent)).not.toMatch(/api[_-]?key|secret|token/i);
    });
  });
});
