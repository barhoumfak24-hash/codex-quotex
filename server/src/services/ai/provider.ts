// Pluggable AI provider. All model keys stay server-side.
//
// Providers return parsed JSON, never raw prose. Callers still validate
// shape because model output is advisory and must never be trusted as a
// final insurance decision.

import { runServerAiJob } from "./governor.js";
import {
  applyOpenAiRoutingDefaults,
  getOpenAiImageModel,
  resolveOpenAiModelRoute,
} from "./modelRouter.js";

export type CompleteArgs = {
  system: string;
  user: string;
  attachments?: Array<{
    fileName?: string;
    mimeType?: string;
    dataUrl: string;
  }>;
  schemaName?: string;
  schema?: Record<string, unknown>;
  model?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  quality?: "fast" | "standard" | "advanced" | "maximum";
  maxOutputTokens?: number;
};

export interface AiProvider {
  completeJson<T = unknown>(args: CompleteArgs): Promise<T>;
}

class AiProviderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AiProviderHttpError";
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

const stubProvider: AiProvider = {
  async completeJson<T = unknown>(): Promise<T> {
    return {} as T;
  },
};

function configuredTimeoutMs(): number {
  const n = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1_000 ? n : DEFAULT_TIMEOUT_MS;
}

function retryDelay(attempt: number): number {
  return 250 * 2 ** attempt;
}

function jsonRepairSystem(schemaName?: string): string {
  return [
    "You repair model output into valid JSON only.",
    "Do not add commentary, markdown, or extra text.",
    schemaName ? `The JSON must satisfy the ${schemaName} response shape.` : "Preserve the intended fields.",
  ].join(" ");
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configuredTimeoutMs());
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new AiProviderHttpError(
          res.status,
          text.slice(0, 500) || `AI provider returned HTTP ${res.status}`
        );
      }
      return text ? JSON.parse(text) : {};
    } catch (err) {
      lastError = err;
      const status = err instanceof AiProviderHttpError ? err.status : 0;
      const shouldRetry =
        attempt < attempts - 1 &&
        (status === 0 || isRetryableStatus(status));
      if (!shouldRetry) break;
      await sleep(retryDelay(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI provider request failed");
}

function parseJsonFromText<T>(raw: string): T {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(unfenced.slice(first, last + 1)) as T;
    }
    throw new Error("AI provider response did not contain JSON");
  }
}

function extractOpenAiText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const chunks: string[] = [];
  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") chunks.push(p.text);
      if (typeof p.refusal === "string") throw new Error(`AI provider refused: ${p.refusal}`);
    }
  }
  return chunks.join("\n").trim();
}

function qualityReasoningEffort(
  quality: CompleteArgs["quality"] | undefined,
  explicit: CompleteArgs["reasoningEffort"] | undefined,
  routed: CompleteArgs["reasoningEffort"] | undefined
): NonNullable<CompleteArgs["reasoningEffort"]> {
  if (explicit) return explicit;
  if (process.env.OPENAI_REASONING_EFFORT) {
    return process.env.OPENAI_REASONING_EFFORT as NonNullable<CompleteArgs["reasoningEffort"]>;
  }
  if (routed) return routed;
  switch (quality) {
    case "fast":
      return "low";
    case "maximum":
      return "xhigh";
    case "advanced":
      return "high";
    case "standard":
    default:
      return "medium";
  }
}

function candidateModels(args: CompleteArgs): string[] {
  return resolveOpenAiModelRoute(args).models;
}

function openAiUserContent(args: CompleteArgs): unknown {
  const attachments = args.attachments?.filter((item) => item.dataUrl) ?? [];
  if (attachments.length === 0) return args.user;
  const content: Record<string, unknown>[] = [{ type: "input_text", text: args.user }];
  attachments.forEach((attachment) => {
    const mimeType = attachment.mimeType ?? "";
    if (mimeType.startsWith("image/")) {
      content.push({ type: "input_image", image_url: attachment.dataUrl });
      return;
    }
    content.push({
      type: "input_file",
      filename: attachment.fileName ?? "uploaded-document",
      file_data: attachment.dataUrl,
    });
  });
  return content;
}

function shouldFallbackModel(err: unknown): boolean {
  if (!(err instanceof AiProviderHttpError)) return false;
  return err.status === 400 || err.status === 404 || err.status === 422;
}

async function repairJsonWithOpenAi<T>(
  url: string,
  apiKey: string,
  model: string,
  args: CompleteArgs,
  raw: string
): Promise<T> {
  const data = await fetchJsonWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: jsonRepairSystem(args.schemaName) },
          {
            role: "user",
            content: [
              "Repair this response into valid JSON only.",
              args.schema ? `JSON schema:\n${JSON.stringify(args.schema).slice(0, 12_000)}` : "",
              `Original response:\n${raw.slice(0, 12_000)}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        text: args.schema
          ? {
              format: {
                type: "json_schema",
                name: args.schemaName ?? "ai_response",
                schema: args.schema,
                strict: true,
              },
            }
          : { format: { type: "json_object" } },
        max_output_tokens: args.maxOutputTokens ?? 1_200,
        store: false,
      }),
    },
    1
  );
  const fixed = extractOpenAiText(data);
  if (!fixed) throw new Error("OpenAI JSON repair did not include output text");
  return parseJsonFromText<T>(fixed);
}

async function openaiProvider(): Promise<AiProvider> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return stubProvider;
  const url = process.env.OPENAI_RESPONSES_URL ?? "https://api.openai.com/v1/responses";
  return {
    async completeJson<T = unknown>(args: CompleteArgs): Promise<T> {
      const route = resolveOpenAiModelRoute(args);
      const format = args.schema
        ? {
            type: "json_schema",
            name: args.schemaName ?? "ai_response",
            schema: args.schema,
            strict: true,
          }
        : { type: "json_object" };
      let lastError: unknown;
      for (const model of candidateModels(args)) {
        try {
          const data = await fetchJsonWithRetry(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: [
                { role: "system", content: args.system },
                { role: "user", content: openAiUserContent(args) },
              ],
              text: { format },
              ...(model.startsWith("gpt-5")
                ? { reasoning: { effort: qualityReasoningEffort(args.quality, args.reasoningEffort, route.reasoningEffort) } }
                : {}),
              max_output_tokens: args.maxOutputTokens ?? 1_200,
              store: false,
            }),
          });
          const text = extractOpenAiText(data);
          if (!text) throw new Error("OpenAI response did not include output text");
          try {
            return parseJsonFromText<T>(text);
          } catch (err) {
            if (!args.schema) throw err;
            return await repairJsonWithOpenAi<T>(url, apiKey, model, args, text);
          }
        } catch (err) {
          lastError = err;
          if (!shouldFallbackModel(err)) break;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("OpenAI provider failed");
    },
  };
}

async function anthropicProvider(): Promise<AiProvider> {
  // Placeholder until @anthropic-ai/sdk or REST support is added.
  // Keep returning the validated fallback path instead of pretending
  // an unconfigured provider is live.
  return stubProvider;
}

async function geminiProvider(): Promise<AiProvider> {
  // Placeholder until @google/generative-ai or REST support is added.
  return stubProvider;
}

let cachedKey = "";
let cached: AiProvider | null = null;
async function pick(): Promise<AiProvider> {
  const p = (process.env.AI_PROVIDER ?? "stub").toLowerCase();
  const key = `${p}:${process.env.OPENAI_MODEL ?? ""}:${process.env.OPENAI_REASONING_EFFORT ?? ""}`;
  if (cached && cachedKey === key) return cached;
  cachedKey = key;
  if (p === "openai") cached = await openaiProvider();
  else if (p === "anthropic") cached = await anthropicProvider();
  else if (p === "gemini") cached = await geminiProvider();
  else cached = stubProvider;
  return cached;
}

export const provider: AiProvider = {
  async completeJson(args) {
    const routedArgs = applyOpenAiRoutingDefaults(args);
    return runServerAiJob(routedArgs, async () => {
      const impl = await pick();
      return impl.completeJson(routedArgs);
    });
  },
};

export async function generateOpenAiImage(input: {
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
}): Promise<{ mimeType: string; bytes: Buffer } | null> {
  return runServerAiJob(
    {
      system: "Generate one campaign image for Quotex marketing material.",
      user: input.prompt.slice(0, 4_000),
      schemaName: "image_generation",
      quality: "standard",
      model: getOpenAiImageModel(),
    },
    async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      const data = await fetchJsonWithRetry(
        process.env.OPENAI_IMAGES_URL ?? "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: getOpenAiImageModel(),
            prompt: input.prompt.slice(0, 4_000),
            size: input.size ?? "1024x1536",
            n: 1,
          }),
        },
        2
      );
      if (typeof data !== "object" || data === null) return null;
      const first = Array.isArray((data as Record<string, unknown>).data)
        ? ((data as Record<string, unknown>).data as unknown[])[0]
        : null;
      if (typeof first !== "object" || first === null) return null;
      const row = first as Record<string, unknown>;
      if (typeof row.b64_json === "string") {
        return { mimeType: "image/png", bytes: Buffer.from(row.b64_json, "base64") };
      }
      return null;
    }
  );
}
