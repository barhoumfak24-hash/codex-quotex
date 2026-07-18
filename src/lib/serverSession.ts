const AUTH_TOKEN_KEY = "quotex.authToken";

let inMemoryAuthToken: string | null = null;

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the token in memory for the current tab when storage is unavailable.
  }
}

function storageRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Signing out must not fail because browser storage is unavailable.
  }
}

export function currentServerSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return inMemoryAuthToken || storageGet(AUTH_TOKEN_KEY);
}

export function currentServerSessionRole(): string | null {
  return currentServerSessionClaims()?.role ?? null;
}

export type ServerSessionClaims = {
  userId: string;
  role: string;
  tenantId: string | null;
  branchId: string | null;
};

export function currentServerSessionClaims(): ServerSessionClaims | null {
  const token = currentServerSessionToken();
  if (!token || typeof window === "undefined") return null;
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(padded)) as Record<string, unknown>;
    const userId = typeof payload.userId === "string" ? payload.userId : typeof payload.sub === "string" ? payload.sub : "";
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!userId || !role) return null;
    return {
      userId,
      role,
      tenantId: typeof payload.tenantId === "string" ? payload.tenantId : null,
      branchId: typeof payload.branchId === "string" ? payload.branchId : null,
    };
  } catch {
    return null;
  }
}

export function rememberServerSessionToken(token: string): void {
  const next = token.trim();
  inMemoryAuthToken = next || null;
  if (next) storageSet(AUTH_TOKEN_KEY, next);
  else storageRemove(AUTH_TOKEN_KEY);
}

export function forgetServerSessionToken(): void {
  inMemoryAuthToken = null;
  storageRemove(AUTH_TOKEN_KEY);
}

export function serverSessionHeaders(): Record<string, string> {
  const token = currentServerSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
