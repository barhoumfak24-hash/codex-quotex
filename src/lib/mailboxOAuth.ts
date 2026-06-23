import { apiBaseUrl } from "@/lib/apiBase";
import type { User } from "@/types";

export type MailboxOAuthProvider = "google" | "microsoft";

export type MailboxOAuthStartResult =
  | {
      ok: true;
      authorizationUrl: string;
      expiresAt: string;
    }
  | {
      ok: false;
      error?: string;
      message?: string;
    };

export async function startMailboxOAuth(input: {
  provider: MailboxOAuthProvider;
  user: User;
  tenantId: string;
  redirectAfter?: string;
}): Promise<MailboxOAuthStartResult> {
  const res = await fetch(`${apiBaseUrl()}/mailboxes/oauth/${input.provider}/start`, {
    method: "POST",
    headers: authHeaders(input.user, input.tenantId),
    body: JSON.stringify({
      redirectAfter: input.redirectAfter ?? "/employee/account-settings",
    }),
  });
  const json = (await res.json().catch(() => null)) as MailboxOAuthStartResult | null;
  if (json) return json;
  return { ok: false, error: "mailbox_oauth_failed", message: `${res.status} ${res.statusText}` };
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
  return (
    window.localStorage.getItem("quotex.authToken") ||
    window.localStorage.getItem("quotex.jwt") ||
    null
  );
}
