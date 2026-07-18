import { apiBaseUrl } from "@/lib/apiBase";
import type { User } from "@/types";
import { currentServerSessionToken } from "@/lib/serverSession";

export type ManagerStepUpRequestResult =
  | { ok: true; challengeId: string; expiresAt: string; maskedEmail: string }
  | { ok: false; message: string; error?: string };

export type ManagerStepUpVerifyResult =
  | { ok: true; verified: true; verifiedAt: string }
  | { ok: false; message: string; error?: string };

export async function requestManagerStepUp(input: {
  user: User;
  tenantId: string;
  email: string;
  customerId: string;
}): Promise<ManagerStepUpRequestResult> {
  try {
    const response = await postManagerStepUp(
      "/auth/manager-2fa/request",
      {
        email: input.email,
        purpose: "client_encrypted_info",
        customerId: input.customerId,
      },
      input.user,
      input.tenantId
    );
    const json = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          challengeId?: string;
          expiresAt?: string;
          maskedEmail?: string;
          message?: string;
          error?: string;
        }
      | null;
    if (response.ok && json?.ok && json.challengeId && json.expiresAt && json.maskedEmail) {
      return {
        ok: true,
        challengeId: json.challengeId,
        expiresAt: json.expiresAt,
        maskedEmail: json.maskedEmail,
      };
    }
    return {
      ok: false,
      error: json?.error,
      message: json?.message ?? `Verification email could not be started (${response.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Verification email could not be started.",
    };
  }
}

export async function verifyManagerStepUp(input: {
  user: User;
  tenantId: string;
  challengeId: string;
  customerId: string;
  code: string;
}): Promise<ManagerStepUpVerifyResult> {
  try {
    const response = await postManagerStepUp(
      "/auth/manager-2fa/verify",
      {
        challengeId: input.challengeId,
        code: input.code,
        purpose: "client_encrypted_info",
        customerId: input.customerId,
      },
      input.user,
      input.tenantId
    );
    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; verified?: boolean; verifiedAt?: string; message?: string; error?: string }
      | null;
    if (response.ok && json?.ok && json.verified) {
      return { ok: true, verified: true, verifiedAt: json.verifiedAt ?? new Date().toISOString() };
    }
    return {
      ok: false,
      error: json?.error,
      message: managerStepUpErrorMessage(json?.error, json?.message),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Verification failed.",
    };
  }
}

async function postManagerStepUp(
  path: "/auth/manager-2fa/request" | "/auth/manager-2fa/verify",
  payload: Record<string, unknown>,
  user: User,
  tenantId: string
): Promise<Response> {
  const headers = authHeaders(user, tenantId);
  const body = JSON.stringify(payload);
  const candidates = uniqueUrls([
    `${apiBaseUrl()}${path}`,
    `/api${path}`,
    `/api/app/api${path}`,
  ]);
  let lastNetworkError: unknown;
  for (const url of candidates) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
      });
    } catch (error) {
      lastNetworkError = error;
      continue;
    }
    if (!routeLooksMissing(response)) return response;
  }
  if (lastNetworkError instanceof Error) throw lastNetworkError;
  return new Response(
    JSON.stringify({
      ok: false,
      error: "route_unavailable",
      message: "Verification endpoint could not be reached.",
    }),
    {
      status: 404,
      headers: { "content-type": "application/json" },
    }
  );
}

function uniqueUrls(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stripTrailingSlash(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeLooksMissing(response: Response): boolean {
  return response.status === 404 || response.status === 405;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function authHeaders(user: User, tenantId: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": user.id,
    "x-user-role": user.role,
    "x-tenant-id": tenantId,
  };
  if (user.branchId) headers["x-branch-id"] = user.branchId;
  const token = authToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function authToken(): string | null {
  if (typeof window === "undefined") return null;
  return currentServerSessionToken();
}

function managerStepUpErrorMessage(error?: string, fallback?: string): string {
  switch (error) {
    case "invalid_code":
      return "The verification code does not match.";
    case "challenge_expired":
      return "That verification code expired. Request a new code and try again.";
    case "too_many_attempts":
      return "Too many attempts. Request a new verification code.";
    case "email_unavailable":
      return fallback ?? "Verification email could not be delivered because email delivery is not configured.";
    case "unauthorized":
      return "Your session could not be verified. Sign in again before viewing protected information.";
    default:
      return fallback ?? "Verification failed.";
  }
}
