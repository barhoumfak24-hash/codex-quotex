import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Role, User } from "@/types";
import { apiBaseUrl, cloudStateSyncEnabled } from "./apiBase";
import { db } from "./db";
import { isStaffRole, type StaffRole } from "./roles";
import {
  currentServerSessionToken,
  forgetServerSessionToken,
  rememberServerSessionToken,
  serverSessionHeaders,
} from "./serverSession";

export type AuthFailReason =
  | "invalid_credentials"
  | "account_not_found"
  | "account_disabled"
  | "agency_inactive"
  | "password_not_set"
  | "rate_limited"
  | "server_unreachable"
  | "wrong_portal"
  | "no_session";

export type AuthResult = { ok: true; user: User } | { ok: false; reason: AuthFailReason };

type RegisterCustomerInput = {
  tenantId: string;
  branchId?: string;
  name: string;
  email: string;
  phone?: string;
  password: string;
};

type RegisterStaffInput = {
  agencyCode: string;
  branchId?: string;
  role: StaffRole;
  firstName: string;
  lastName: string;
  phone: string;
  businessEmail: string;
  password: string;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signInCustomer(email: string, password: string, tenantId?: string | null): Promise<AuthResult>;
  signInStaff(identifier: string, password: string): Promise<AuthResult>;
  signInMaster(email: string, password: string): Promise<AuthResult>;
  registerCustomer(input: RegisterCustomerInput): Promise<AuthResult>;
  registerStaff(input: RegisterStaffInput): Promise<
    | { ok: true; user: User; agencyId: string }
    | { ok: false; reason: string }
  >;
  createMasterAccount(input: { name: string; email: string; password: string }): Promise<
    | { ok: true; user: User }
    | {
        ok: false;
        reason:
          | "exists"
          | "invalid_email"
          | "weak_password"
          | "missing_name"
          | "server_unavailable";
      }
  >;
  requestPasswordReset(scope: "customer" | "staff" | "master", email: string, tenantId?: string | null): Promise<{ ok: true } | { ok: false; reason: AuthFailReason }>;
  resetCustomerPassword(email: string, tenantId?: string | null): Promise<{ ok: true } | { ok: false; reason: AuthFailReason }>;
  changeMyPassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  signOut(): void;
  refreshUser(): User | null;
  hasRole(...roles: Role[]): boolean;
};

type ServerAgency = {
  id: string;
  name: string;
  contactEmail?: string;
  active?: boolean;
};

type ServerSessionUser = {
  id: string;
  tenantId: string | null;
  branchId?: string | null;
  role: string;
  email: string;
  name: string;
  agency?: ServerAgency;
};

type AuthResponse = {
  ok?: boolean;
  token?: string;
  user?: ServerSessionUser;
  reason?: unknown;
  error?: unknown;
};

type AuthRequestResult =
  | { ok: true; json: AuthResponse }
  | { ok: false; reason: AuthFailReason; errorCode?: string; status?: number };

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_CHANGED_KEY = "quotex.auth.sessionChanged.v2";
const LEGACY_AUTH_KEYS = [
  "quotex.jwt",
  "quotex.auth.serverUser.v1",
  "quotex.auth.userId.v1",
];
const AUTH_TIMEOUT_MS = 20_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<User | null>(null);

  const publishUser = useCallback((next: User | null) => {
    userRef.current = next;
    setUser(next);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SESSION_CHANGED_KEY, String(Date.now()));
      } catch {
        // Cross-tab notification is best effort; auth remains server-backed.
      }
    }
  }, []);

  const clearSession = useCallback(() => {
    forgetServerSessionToken();
    publishUser(null);
  }, [publishUser]);

  const acceptSession = useCallback(
    async (json: AuthResponse): Promise<AuthResult> => {
      if (!json.token || !json.user) {
        clearSession();
        return { ok: false, reason: "no_session" };
      }
      const serverUser = validatedServerUser(json.user);
      if (!serverUser) {
        clearSession();
        return { ok: false, reason: "wrong_portal" };
      }
      rememberServerSessionToken(json.token);
      await hydrateAuthenticatedWorkspace();
      scrubLegacyPasswords();
      const next = mergeServerIdentityWithLocalProfile(serverUser);
      mirrorAuthenticatedUser(next);
      publishUser(next);
      return { ok: true, user: next };
    },
    [clearSession, publishUser]
  );

  const restoreSession = useCallback(async () => {
    if (!currentServerSessionToken()) {
      publishUser(null);
      return;
    }
    const response = await authRequest("session", { method: "GET" }, true);
    if (!response.ok) {
      if (response.reason !== "server_unreachable" && response.reason !== "rate_limited") {
        forgetServerSessionToken();
      }
      publishUser(null);
      return;
    }
    await acceptSession(response.json);
  }, [acceptSession, publishUser]);

  useEffect(() => {
    removeLegacyAuthStorage();
    scrubLegacyPasswords();
    let cancelled = false;
    restoreSession()
      .catch(() => {
        if (!cancelled) publishUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publishUser, restoreSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "quotex.authToken" && event.key !== SESSION_CHANGED_KEY) return;
      if (event.key === "quotex.authToken") {
        if (event.newValue) rememberServerSessionToken(event.newValue);
        else forgetServerSessionToken();
      }
      void restoreSession();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [restoreSession]);

  const signIn = useCallback(
    async (scope: "customer" | "staff" | "master", identifier: string, password: string, tenantId?: string | null): Promise<AuthResult> => {
      forgetServerSessionToken();
      publishUser(null);
      const response = await authRequest("login", {
        method: "POST",
        body: JSON.stringify({
          scope,
          identifier: identifier.trim().toLowerCase(),
          password,
          ...(tenantId ? { tenantId } : {}),
        }),
      });
      if (!response.ok) return { ok: false, reason: response.reason };
      const accepted = await acceptSession(response.json);
      if (accepted.ok && !roleMatchesPortal(accepted.user.role, scope)) {
        clearSession();
        return { ok: false, reason: "wrong_portal" };
      }
      return accepted;
    },
    [acceptSession, clearSession, publishUser]
  );

  const signInCustomer = useCallback(
    (email: string, password: string, tenantId?: string | null) => signIn("customer", email, password, tenantId),
    [signIn]
  );
  const signInStaff = useCallback((identifier: string, password: string) => signIn("staff", identifier, password), [signIn]);
  const signInMaster = useCallback((email: string, password: string) => signIn("master", email, password), [signIn]);

  const registerCustomer = useCallback(
    async (input: RegisterCustomerInput): Promise<AuthResult> => {
      const response = await authRequest("register", {
        method: "POST",
        body: JSON.stringify({
          scope: "customer",
          ...input,
          email: input.email.trim().toLowerCase(),
        }),
      });
      if (!response.ok) return { ok: false, reason: response.reason };
      return acceptSession(response.json);
    },
    [acceptSession]
  );

  const registerStaff = useCallback(
    async (input: RegisterStaffInput) => {
      const response = await authRequest("register", {
        method: "POST",
        body: JSON.stringify({
          scope: "staff",
          ...input,
          agencyCode: input.agencyCode.trim().toUpperCase(),
          businessEmail: input.businessEmail.trim().toLowerCase(),
        }),
      });
      if (!response.ok) return { ok: false as const, reason: response.errorCode ?? response.reason };
      const accepted = await acceptSession(response.json);
      if (!accepted.ok || !isStaffRole(accepted.user.role)) {
        clearSession();
        return { ok: false as const, reason: accepted.ok ? "wrong_portal" : accepted.reason };
      }
      return {
        ok: true as const,
        user: accepted.user,
        agencyId: accepted.user.tenantId ?? "",
      };
    },
    [acceptSession, clearSession]
  );

  const createMasterAccount = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      if (!name) return { ok: false as const, reason: "missing_name" as const };
      if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false as const, reason: "invalid_email" as const };
      if (input.password.length < 12) return { ok: false as const, reason: "weak_password" as const };
      const response = await authRequest("master/create", {
        method: "POST",
        body: JSON.stringify({ name, email, password: input.password }),
      });
      if (!response.ok) {
        return {
          ok: false as const,
          reason: response.status === 409 ? "exists" as const : "server_unavailable" as const,
        };
      }
      const accepted = await acceptSession(response.json);
      if (!accepted.ok || accepted.user.role !== "master_admin") {
        return { ok: false as const, reason: "server_unavailable" as const };
      }
      return { ok: true as const, user: accepted.user };
    },
    [acceptSession]
  );

  const requestPasswordReset = useCallback(
    async (scope: "customer" | "staff" | "master", email: string, tenantId?: string | null) => {
      const response = await authRequest("password/reset-request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), scope, tenantId }),
      });
      return response.ok
        ? { ok: true as const }
        : { ok: false as const, reason: response.reason };
    },
    []
  );
  const resetCustomerPassword = useCallback(
    (email: string, tenantId?: string | null) => requestPasswordReset("customer", email, tenantId),
    [requestPasswordReset]
  );

  const changeMyPassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!userRef.current) return { ok: false as const, reason: "Not signed in." };
      if (newPassword.length < 8) return { ok: false as const, reason: "New password must be at least 8 characters." };
      const response = await authRequest("password/change", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }, true);
      if (!response.ok) return { ok: false as const, reason: authFailureMessage(response.reason) };
      const accepted = await acceptSession(response.json);
      return accepted.ok
        ? { ok: true as const }
        : { ok: false as const, reason: authFailureMessage(accepted.reason) };
    },
    [acceptSession]
  );

  const signOut = useCallback(() => {
    void authRequest("logout", { method: "POST" }, true);
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(() => {
    const current = userRef.current;
    if (!current) return null;
    const next = mergeServerIdentityWithLocalProfile(current);
    userRef.current = next;
    setUser(next);
    return next;
  }, []);

  const hasRole = useCallback((...roles: Role[]) => Boolean(userRef.current && roles.includes(userRef.current.role)), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signInCustomer,
    signInStaff,
    signInMaster,
    registerCustomer,
    registerStaff,
    createMasterAccount,
    requestPasswordReset,
    resetCustomerPassword,
    changeMyPassword,
    signOut,
    refreshUser,
    hasRole,
  }), [
    user,
    loading,
    signInCustomer,
    signInStaff,
    signInMaster,
    registerCustomer,
    registerStaff,
    createMasterAccount,
    requestPasswordReset,
    resetCustomerPassword,
    changeMyPassword,
    signOut,
    refreshUser,
    hasRole,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function authRequest(path: string, init: RequestInit, authenticated = false): Promise<AuthRequestResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiBaseUrl()}/auth/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(authenticated ? serverSessionHeaders() : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const json = await safeJson(response);
    if (!response.ok || json.ok === false) {
      const raw = typeof json.reason === "string" ? json.reason : typeof json.error === "string" ? json.error : undefined;
      return {
        ok: false,
        reason: normalizeAuthFailReason(raw, response.status),
        errorCode: raw,
        status: response.status,
      };
    }
    return { ok: true, json };
  } catch {
    return { ok: false, reason: "server_unreachable" };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function safeJson(response: Response): Promise<AuthResponse> {
  try {
    return await response.json() as AuthResponse;
  } catch {
    return {};
  }
}

function validatedServerUser(value: ServerSessionUser): ServerSessionUser | null {
  const normalizedRole = value.role === "agency_owner" || value.role === "agency_admin" ? "manager" : value.role;
  if (!value.id?.trim() || !value.email?.trim() || !value.name?.trim() || !isRole(normalizedRole)) return null;
  if (normalizedRole !== "master_admin" && !value.tenantId) return null;
  return {
    ...value,
    role: normalizedRole,
    email: value.email.trim().toLowerCase(),
    tenantId: normalizedRole === "master_admin" ? null : value.tenantId,
  };
}

function mergeServerIdentityWithLocalProfile(server: ServerSessionUser | User): User {
  const local = db.list("users").find((candidate) => candidate.id === server.id);
  const role = server.role as Role;
  return {
    ...(local ?? {}),
    id: server.id,
    tenantId: role === "master_admin" ? null : server.tenantId,
    branchId: server.branchId ?? local?.branchId,
    role,
    email: server.email.trim().toLowerCase(),
    businessEmail: local?.businessEmail ?? server.email.trim().toLowerCase(),
    name: server.name,
    generatedPassword: undefined,
    staffAccessStatus: "active",
    profileCompleted: local?.profileCompleted ?? true,
    active: true,
    createdAt: local?.createdAt ?? new Date().toISOString(),
  };
}

function mirrorAuthenticatedUser(user: User): void {
  const existing = db.list("users").find((candidate) => candidate.id === user.id);
  if (existing) db.update("users", existing.id, user);
  else db.insert("users", user);
}

function scrubLegacyPasswords(): void {
  for (const candidate of db.list("users")) {
    if (candidate.generatedPassword) db.update("users", candidate.id, { generatedPassword: undefined });
  }
}

function removeLegacyAuthStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_AUTH_KEYS) {
    try { window.localStorage.removeItem(key); } catch { /* no-op */ }
    try { window.sessionStorage.removeItem(key); } catch { /* no-op */ }
  }
  try { window.sessionStorage.removeItem("quotex.authToken"); } catch { /* no-op */ }
}

async function hydrateAuthenticatedWorkspace(): Promise<void> {
  if (!cloudStateSyncEnabled()) return;
  await db.hydrateNow().catch(() => false);
}

function roleMatchesPortal(role: Role, scope: "customer" | "staff" | "master"): boolean {
  if (scope === "customer") return role === "customer";
  if (scope === "master") return role === "master_admin";
  return isStaffRole(role);
}

function isRole(value: string): value is Role {
  return ["customer", "agent", "manager", "csr", "master_admin"].includes(value);
}

function normalizeAuthFailReason(reason: unknown, status?: number): AuthFailReason {
  if (
    reason === "invalid_credentials" ||
    reason === "account_not_found" ||
    reason === "account_disabled" ||
    reason === "agency_inactive" ||
    reason === "password_not_set" ||
    reason === "rate_limited" ||
    reason === "server_unreachable" ||
    reason === "wrong_portal" ||
    reason === "no_session"
  ) return reason;
  if (status === 404) return "account_not_found";
  if (status === 403) return "account_disabled";
  if (status === 409) return "password_not_set";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "server_unreachable";
  return "invalid_credentials";
}

export function authFailureMessage(reason: AuthFailReason, portal?: "customer" | "staff" | "master"): string {
  if (reason === "account_not_found") return "Email or password is incorrect.";
  if (reason === "account_disabled") return "This account has been disabled. Contact your administrator.";
  if (reason === "agency_inactive") return "Your agency's subscription is inactive.";
  if (reason === "password_not_set") return "Your account doesn't have a password yet \u2014 use 'Forgot password' to set one.";
  if (reason === "rate_limited") return "Too many attempts. Try again in a minute.";
  if (reason === "server_unreachable") return "Can't reach the sign-in server. Check your connection and try again.";
  if (reason === "no_session") return "Your session has ended. Sign in again.";
  if (reason === "wrong_portal") {
    if (portal === "staff") return "This login belongs to a different portal \u2014 use the Customer or Master sign-in.";
    if (portal === "customer") return "This login belongs to a different portal \u2014 use the Employee or Master sign-in.";
    return "This login belongs to a different portal \u2014 use the Employee or Customer sign-in.";
  }
  return "Email or password is incorrect.";
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: AuthFailReason }> {
  const response = await authRequest("password/reset", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
  return response.ok ? { ok: true } : { ok: false, reason: response.reason };
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
