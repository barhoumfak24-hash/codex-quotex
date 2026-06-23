import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyOpenAiRoutingDefaults,
  getOpenAiEmbeddingModel,
  getOpenAiImageModel,
  profileForSchema,
  resolveOpenAiModelRoute,
} from "../services/ai/modelRouter.js";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("AI model router", () => {
  it("routes upload and document extraction work to the document model profile", () => {
    vi.stubEnv("AI_DOCUMENT_MODEL", "doc-model");

    const route = resolveOpenAiModelRoute({ schemaName: "contact_extraction" });

    expect(route.profile).toBe("document_extraction");
    expect(route.primaryModel).toBe("doc-model");
    expect(route.reasoningEffort).toBe("high");
  });

  it("routes ACORD and fillable document work to the conservative autofill profile", () => {
    vi.stubEnv("AI_AUTOFILL_MODEL", "autofill-model");

    const route = resolveOpenAiModelRoute({ schemaName: "acord_field_mapping" });

    expect(route.profile).toBe("document_autofill");
    expect(route.primaryModel).toBe("autofill-model");
  });

  it("routes preliminary pricing and carrier ranking to the pricing model profile", () => {
    vi.stubEnv("AI_PRICING_MODEL", "pricing-model");

    const route = resolveOpenAiModelRoute({ schemaName: "carrier_match" });

    expect(route.profile).toBe("pricing_reasoning");
    expect(route.primaryModel).toBe("pricing-model");
    expect(route.reasoningEffort).toBe("high");
  });

  it("routes assistant, sorting, and quick text work to lower-cost profiles", () => {
    vi.stubEnv("AI_FAST_MODEL", "fast-model");
    vi.stubEnv("AI_PORTAL_ASSISTANT_MODEL", "assistant-model");
    vi.stubEnv("AI_SORT_MODEL", "sort-model");

    expect(resolveOpenAiModelRoute({ schemaName: "portal_assistant_answer" })).toMatchObject({
      profile: "portal_assistant",
      primaryModel: "assistant-model",
      reasoningEffort: "medium",
    });
    expect(resolveOpenAiModelRoute({ schemaName: "sort_intent" })).toMatchObject({
      profile: "sort_intent",
      primaryModel: "sort-model",
      reasoningEffort: "low",
    });
    expect(resolveOpenAiModelRoute({ schemaName: "email_subject" })).toMatchObject({
      profile: "fast_text",
      primaryModel: "fast-model",
      reasoningEffort: "low",
    });
  });

  it("keeps explicit caller models while still applying routed reasoning defaults", () => {
    const routed = applyOpenAiRoutingDefaults({
      schemaName: "policy_extraction",
      model: "caller-model",
    });

    expect(routed.model).toBe("caller-model");
    expect(routed.reasoningEffort).toBe("high");
  });

  it("keeps image and embedding model settings isolated from JSON model routing", () => {
    vi.stubEnv("OPENAI_IMAGE_MODEL", "image-model");
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "embedding-model");

    expect(profileForSchema("image_generation")).toBe("image_generation");
    expect(getOpenAiImageModel()).toBe("image-model");
    expect(getOpenAiEmbeddingModel()).toBe("embedding-model");
  });
});
