const AUTH_TOKEN_KEY = "quotex.authToken";
const LEGACY_AUTH_TOKEN_KEY = "quotex.jwt";
let inMemoryAuthToken: string | null = null;

function storageGet(storage: Storage | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function currentServerSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    inMemoryAuthToken ||
    storageGet(window.localStorage, AUTH_TOKEN_KEY) ||
    storageGet(window.sessionStorage, AUTH_TOKEN_KEY) ||
    storageGet(window.localStorage, LEGACY_AUTH_TOKEN_KEY) ||
    storageGet(window.sessionStorage, LEGACY_AUTH_TOKEN_KEY)
  );
}

export function currentServerSessionRole(): string | null {
  const token = currentServerSessionToken();
  if (!token) return null;
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(window.atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function rememberServerSessionToken(token: string): void {
  inMemoryAuthToken = token.trim() || null;
}

export function forgetServerSessionToken(): void {
  inMemoryAuthToken = null;
}

export function serverSessionHeaders(): Record<string, string> {
  const token = currentServerSessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
