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
  | "/ai/acord-map"
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
  const base = apiBaseUrl();
  if (base === "/api/app/api") return "/api";
  if (base.endsWith("/api/app/api")) return base.slice(0, -"/app/api".length);
  return base;
}

export function aiImageUrl(path: "/ai/pamphlet-image", params: Record<string, string | number>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  return `${aiApiBaseUrl()}${path}?${query.toString()}`;
}

export type AiGatewayFailureDetail = {
  path: AiPath;
  status?: number;
  message: string;
  error?: string;
};

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
          const init: RequestInit = {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(payload),
          };
          if (fetchAcceptsAbortSignal(controller.signal)) init.signal = controller.signal;
          const url = `${aiApiBaseUrl()}${path}`;
          if (url.startsWith("/") && (typeof window === "undefined" || isTestRuntime()) && !fetchIsMocked()) {
            return null;
          }
          const res = await fetch(url, init);
          if (!res.ok) {
            const body = await parseErrorBody(res);
            reportAiGatewayFailure({
              path,
              status: res.status,
              message: body?.message || body?.error || `AI request failed with HTTP ${res.status}.`,
              error: body?.error,
            });
            return null;
          }
          return (await res.json()) as T;
        } finally {
          clearTimer(timer);
        }
      }
    );
  } catch (error) {
    reportAiGatewayFailure({
      path,
      message: error instanceof Error ? error.message : "AI request could not be completed.",
      error: error instanceof Error ? error.name : "ai_request_failed",
    });
    return null;
  }
}

function fetchAcceptsAbortSignal(signal: AbortSignal): boolean {
  if (typeof Request === "undefined") return true;
  try {
    new Request("http://quotex.local/abort-check", { signal });
    return true;
  } catch {
    return false;
  }
}

function isTestRuntime(): boolean {
  try {
    if ((import.meta as { env?: { MODE?: string } })?.env?.MODE === "test") return true;
  } catch {
    /* ignore */
  }
  try {
    const processLike = globalThis as { process?: { env?: Record<string, string | undefined> } };
    return processLike.process?.env?.VITEST === "true";
  } catch {
    return false;
  }
}

function fetchIsMocked(): boolean {
  try {
    const candidate = globalThis.fetch as unknown as { mock?: unknown; _isMockFunction?: unknown };
    return Boolean(candidate?.mock || candidate?._isMockFunction);
  } catch {
    return false;
  }
}

async function parseErrorBody(res: Response): Promise<{ message?: string; error?: string } | null> {
  try {
    const json = (await res.clone().json()) as { message?: unknown; error?: unknown };
    return {
      message: typeof json.message === "string" ? json.message : undefined,
      error: typeof json.error === "string" ? json.error : undefined,
    };
  } catch {
    try {
      const text = await res.clone().text();
      return text ? { message: text.slice(0, 300) } : null;
    } catch {
      return null;
    }
  }
}

function reportAiGatewayFailure(detail: AiGatewayFailureDetail): void {
  if (typeof console !== "undefined") {
    console.warn("[quotex:ai-gateway-failure]", detail);
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiGatewayFailureDetail>("quotex:ai-gateway-failure", { detail }));
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = authToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const user = currentBrowserUser();
  if (user) {
    headers["x-user-id"] = user.id;
    headers["x-user-role"] = user.role;
    if (user.tenantId) headers["x-tenant-id"] = user.tenantId;
    if (user.branchId) headers["x-branch-id"] = user.branchId;
  }
  return headers;
}

function authToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem("quotex.authToken") ||
    window.localStorage.getItem("quotex.jwt") ||
    null
  );
}

function currentBrowserUser():
  | { id: string; role: string; tenantId?: string | null; branchId?: string | null }
  | null {
  if (typeof window === "undefined") return null;
  const userId = window.localStorage.getItem("quotex.auth.userId.v1");
  if (!userId) return null;
  const raw = window.localStorage.getItem("quotex.db.v31");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { users?: unknown[] };
    const user = (parsed.users ?? []).find(
      (row): row is { id: string; role: string; tenantId?: string | null; branchId?: string | null } =>
        typeof row === "object" &&
        row !== null &&
        (row as { id?: unknown }).id === userId &&
        typeof (row as { role?: unknown }).role === "string"
    );
    return user ?? null;
  } catch {
    return null;
  }
}
