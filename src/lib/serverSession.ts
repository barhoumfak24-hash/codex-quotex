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
