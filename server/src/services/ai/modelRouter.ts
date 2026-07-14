export type AiModelProfile =
  | "document_extraction"
  | "document_autofill"
  | "portal_runner"
  | "pricing_reasoning"
  | "fast_text"
  | "sort_intent"
  | "marketing_creative"
  | "portal_assistant"
  | "image_generation"
  | "general_reasoning";

export type AiReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface AiModelRoutingInput {
  schemaName?: string;
  model?: string;
  reasoningEffort?: AiReasoningEffort;
  quality?: "fast" | "standard" | "advanced" | "maximum";
}

export interface AiModelRoute {
  profile: AiModelProfile;
  primaryModel: string;
  fallbackModels: string[];
  models: string[];
  reasoningEffort: AiReasoningEffort;
}

const DEFAULT_REASONING_MODEL = "gpt-5";
const DEFAULT_FAST_MODEL = "gpt-4o-mini";
const DEFAULT_FALLBACK_MODELS = ["gpt-4o", "gpt-4o-mini"];
const DEFAULT_IMAGE_MODEL = "dall-e-3";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large";

export function resolveOpenAiModelRoute(input: AiModelRoutingInput): AiModelRoute {
  const profile = profileForSchema(input.schemaName);
  const primaryModel = input.model || configuredModel(profile, input.quality);
  const fallbackModels = configuredFallbackModels(profile).filter((model) => model !== primaryModel);
  return {
    profile,
    primaryModel,
    fallbackModels,
    models: Array.from(new Set([primaryModel, ...fallbackModels])),
    reasoningEffort: input.reasoningEffort ?? configuredReasoningEffort(profile, input.quality),
  };
}

export function applyOpenAiRoutingDefaults<T extends AiModelRoutingInput>(input: T): T {
  const route = resolveOpenAiModelRoute(input);
  return {
    ...input,
    model: input.model || route.primaryModel,
    reasoningEffort: input.reasoningEffort ?? route.reasoningEffort,
  };
}

export function getOpenAiImageModel(): string {
  return env("OPENAI_IMAGE_MODEL") || DEFAULT_IMAGE_MODEL;
}

export function getOpenAiEmbeddingModel(): string {
  return env("OPENAI_EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL;
}

export function profileForSchema(schemaName: string | undefined): AiModelProfile {
  const schema = (schemaName ?? "").toLowerCase();
  if (/image_generation/.test(schema)) return "image_generation";
  if (/portal_assistant/.test(schema)) return "portal_assistant";
  if (/campaign|marketing|pamphlet/.test(schema)) return "marketing_creative";
  if (/email_subject|enhanced_message|marketing_message/.test(schema)) return "fast_text";
  if (/sort|filter/.test(schema)) return "sort_intent";
  if (/premium|carrier_match|quote_rank|quote_recommendation/.test(schema)) return "pricing_reasoning";
  if (/portal_runner|carrier_runner|runner/.test(schema)) return "portal_runner";
  if (/acord|pdf|document_autofill|field_mapping|fillable/.test(schema)) return "document_autofill";
  if (/intake|contact_extraction|policy_extraction|carrier_appetite|asset_signal|extract|parse/.test(schema)) {
    return "document_extraction";
  }
  return "general_reasoning";
}

function configuredModel(profile: AiModelProfile, quality: AiModelRoutingInput["quality"]): string {
  if (quality === "maximum") {
    return env("OPENAI_MAX_REASONING_MODEL") || env("AI_REASONING_MODEL") || DEFAULT_REASONING_MODEL;
  }
  switch (profile) {
    case "document_extraction":
      return env("AI_DOCUMENT_MODEL") || env("AI_REASONING_MODEL") || env("OPENAI_MODEL") || DEFAULT_REASONING_MODEL;
    case "document_autofill":
      return env("AI_AUTOFILL_MODEL") || env("AI_DOCUMENT_MODEL") || env("AI_REASONING_MODEL") || env("OPENAI_MODEL") || DEFAULT_REASONING_MODEL;
    case "portal_runner":
      return env("AI_RUNNER_MODEL") || env("AI_REASONING_MODEL") || env("OPENAI_MODEL") || DEFAULT_REASONING_MODEL;
    case "pricing_reasoning":
      return env("AI_PRICING_MODEL") || env("AI_REASONING_MODEL") || env("OPENAI_MODEL") || DEFAULT_REASONING_MODEL;
    case "portal_assistant":
      return env("AI_PORTAL_ASSISTANT_MODEL") || env("AI_FAST_MODEL") || env("OPENAI_MODEL") || DEFAULT_FAST_MODEL;
    case "marketing_creative":
      return env("AI_MARKETING_MODEL") || env("AI_FAST_MODEL") || env("OPENAI_MODEL") || DEFAULT_FAST_MODEL;
    case "sort_intent":
      return env("AI_SORT_MODEL") || env("AI_FAST_MODEL") || env("OPENAI_MODEL") || DEFAULT_FAST_MODEL;
    case "fast_text":
      return env("AI_FAST_MODEL") || env("OPENAI_MODEL") || DEFAULT_FAST_MODEL;
    case "image_generation":
      return getOpenAiImageModel();
    case "general_reasoning":
    default:
      return env("AI_REASONING_MODEL") || env("OPENAI_MODEL") || DEFAULT_REASONING_MODEL;
  }
}

function configuredReasoningEffort(
  profile: AiModelProfile,
  quality: AiModelRoutingInput["quality"]
): AiReasoningEffort {
  const explicit = env("OPENAI_REASONING_EFFORT") as AiReasoningEffort | undefined;
  if (explicit) return explicit;
  if (quality === "maximum") return "xhigh";
  if (quality === "advanced") return profile === "fast_text" || profile === "sort_intent" ? "medium" : "high";
  switch (profile) {
    case "document_extraction":
    case "document_autofill":
    case "portal_runner":
    case "pricing_reasoning":
      return "high";
    case "portal_assistant":
    case "marketing_creative":
      return "medium";
    case "fast_text":
    case "sort_intent":
      return "low";
    case "image_generation":
      return "none";
    case "general_reasoning":
    default:
      return "medium";
  }
}

function configuredFallbackModels(profile: AiModelProfile): string[] {
  const specific = env(`${profileEnvPrefix(profile)}_FALLBACK_MODELS`);
  const generic = env("OPENAI_FALLBACK_MODELS");
  return splitModels(specific || generic).length > 0 ? splitModels(specific || generic) : DEFAULT_FALLBACK_MODELS;
}

function profileEnvPrefix(profile: AiModelProfile): string {
  switch (profile) {
    case "document_extraction":
      return "AI_DOCUMENT";
    case "document_autofill":
      return "AI_AUTOFILL";
    case "portal_runner":
      return "AI_RUNNER";
    case "pricing_reasoning":
      return "AI_PRICING";
    case "fast_text":
      return "AI_FAST";
    case "sort_intent":
      return "AI_SORT";
    case "marketing_creative":
      return "AI_MARKETING";
    case "portal_assistant":
      return "AI_PORTAL_ASSISTANT";
    case "image_generation":
      return "OPENAI_IMAGE";
    case "general_reasoning":
    default:
      return "AI_REASONING";
  }
}

function splitModels(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
