import type { Role, User } from "@/types";

const AUTH_TOKEN_KEY = "quotex.authToken";
const LEGACY_AUTH_TOKEN_KEY = "quotex.jwt";
const AUTH_USER_KEY = "quotex.auth.serverUser.v1";
let inMemoryAuthToken: string | null = null;

const SESSION_USER_ROLES = new Set<Role>(["customer", "agent", "manager", "csr", "master_admin"]);

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

export function currentServerSessionUser(): User | null {
  if (typeof window === "undefined" || !currentServerSessionToken()) return null;
  const raw =
    storageGet(window.localStorage, AUTH_USER_KEY) ||
    storageGet(window.sessionStorage, AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.name !== "string" ||
      !SESSION_USER_ROLES.has(parsed.role as Role)
    ) {
      return null;
    }
    return {
      ...parsed,
      id: parsed.id,
      tenantId:
        parsed.role === "master_admin"
          ? null
          : typeof parsed.tenantId === "string"
            ? parsed.tenantId
            : null,
      role: parsed.role as Role,
      email: parsed.email,
      businessEmail: parsed.businessEmail ?? parsed.email,
      name: parsed.name,
      active: parsed.active !== false,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
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
