// Pluggable AI provider. Returns a single object with completeJson({system,user}).
// Picks implementation from AI_PROVIDER env var.

type CompleteArgs = { system: string; user: string };

interface AiProvider {
  completeJson<T = any>(args: CompleteArgs): Promise<T>;
}

const stubProvider: AiProvider = {
  async completeJson<T = any>(_args: CompleteArgs): Promise<T> {
    // Stub so the server runs without keys. Replace with real calls below.
    return {
      note: "AI provider is not configured. Set AI_PROVIDER and the matching API key in server/.env",
    } as unknown as T;
  },
};

async function anthropicProvider(): Promise<AiProvider> {
  // Real impl:
  // import Anthropic from '@anthropic-ai/sdk';
  // const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // call client.messages.create with system + user, ask for JSON, parse.
  return stubProvider;
}

async function geminiProvider(): Promise<AiProvider> {
  // Real impl using @google/generative-ai.
  return stubProvider;
}

async function openaiProvider(): Promise<AiProvider> {
  // Real impl using openai SDK with response_format json.
  return stubProvider;
}

let cached: AiProvider | null = null;
async function pick(): Promise<AiProvider> {
  if (cached) return cached;
  const p = (process.env.AI_PROVIDER ?? "stub").toLowerCase();
  if (p === "anthropic") cached = await anthropicProvider();
  else if (p === "gemini") cached = await geminiProvider();
  else if (p === "openai") cached = await openaiProvider();
  else cached = stubProvider;
  return cached;
}

export const provider: AiProvider = {
  async completeJson(args) {
    const impl = await pick();
    return impl.completeJson(args);
  },
};