import { aiFeatureForPath, runGovernedAiJob } from "./aiResourceGovernor";
import { apiBaseUrl, envValue } from "./apiBase";

type AiPath =
  | "/ai/parse-intake"
  | "/ai/premium-estimate"
  | "/ai/carrier-match"
  | "/ai/marketing-message"
  | "/ai/email-subject"
  | "/ai/enhance-message"
  | "/ai/extract-contact"
  | "/ai/extract-policy"
  | "/ai/enrich-asset"
  | "/ai/parse-carrier-appetite"
  | "/ai/draft-campaign"
  | "/ai/marketing-creative"
  | "/ai/draft-pamphlet"
  | "/ai/portal-assistant"
  | "/ai/sort-intent";

export function serverAiEnabled(): boolean {
  return envValue("VITE_AI_MODE") === "server";
}

export function aiApiBaseUrl(): string {
  return apiBaseUrl();
}

export function aiImageUrl(path: "/ai/pamphlet-image", params: Record<string, string | number>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `${aiApiBaseUrl()}${path}?${query.toString()}`;
}

export async function postServerAi<T>(
  path: AiPath,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number } = {}
): Promise<T | null> {
  if (!serverAiEnabled()) return null;
  try {
    return await runGovernedAiJob<T | null>(
      {
        feature: aiFeatureForPath(path),
        operation: path,
        payload,
      },
      async () => {
        const controller = new AbortController();
        const setTimer = typeof window !== "undefined" ? window.setTimeout : setTimeout;
        const clearTimer = typeof window !== "undefined" ? window.clearTimeout : clearTimeout;
        const timer = setTimer(() => controller.abort(), opts.timeoutMs ?? 20_000);
        try {
          const res = await fetch(`${aiApiBaseUrl()}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!res.ok) return null;
          return (await res.json()) as T;
        } finally {
          clearTimer(timer);
        }
      }
    );
  } catch {
    return null;
  }
}
