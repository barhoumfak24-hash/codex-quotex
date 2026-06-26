import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Agency, Branch, Role, User } from "@/types";
import { api } from "./api";
import { apiBaseUrl, envValue } from "./apiBase";
import { subscribeToDbChanges } from "./db";
import { isLockingMasterAccount } from "./masterAccount";
import { isStaffRole, type StaffRole } from "./roles";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // Backwards-compat alias for email-only sign in (customer flow).
  signInWithEmail: (email: string) => User | null;
  // Customer sign-in: email + password. Legacy seed accounts without
  // passwords are accepted only in local dev builds.
  signInCustomer: (
    email: string,
    password: string,
    tenantId?: string | null
  ) => User | null;
  // Trigger a customer password reset. Generates a temporary
  // password for the local browser store; production should replace
  // this with a server-issued one-time reset token and email.
  resetCustomerPassword: (
    email: string,
    tenantId?: string | null
  ) => { user: User; tempPassword: string } | null;
  // Update the signed-in customer's password (account settings UI).
  changeMyPassword: (
    currentPassword: string,
    newPassword: string
  ) => { ok: true } | { ok: false; reason: string };
  // Staff sign-in: business email/username + password. Tenant is derived from the staff user.
  signInStaff: (identifier: string, password: string) => Promise<User | null>;
  signInMaster: (email: string, password: string) => User | null;
  createMasterAccount: (input: {
    name: string;
    email: string;
    password: string;
  }) => { ok: true; user: User } | { ok: false; reason: "exists" | "invalid_email" | "weak_password" | "missing_name" };
  registerStaff: (input: {
    agencyCode: string;
    branchId?: string;
    role: StaffRole;
    firstName: string;
    lastName: string;
    phone: string;
    businessEmail: string;
    password: string;
  }) => Promise<
    | { ok: true; user: User; agencyId: string }
    | { ok: false; reason: ReturnType<typeof api.users.registerStaff> extends { ok: false; reason: infer R } ? R : string }
  >;
  signOut: () => void;
  // Re-fetch the current user from the data layer. Use after mutating the
  // signed-in user (e.g. completing first-login profile) so the in-memory
  // record + every RequireRole / RequireProfile gate see the update.
  refreshUser: () => User | null;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Single-key auth: only one logged-in user per browser/device at a time.
// This is the entire enforcement mechanism — every sign-in overwrites this
// key, and other tabs in the same browser pick up the change via the
// `storage` event.
const STORAGE_KEY = "quotex.auth.userId.v1";
const CLIENT_IP_KEY = "quotex.security.clientIp.v1";
const AUTH_TOKEN_KEY = "quotex.authToken";
const LEGACY_AUTH_TOKEN_KEY = "quotex.jwt";
const SERVER_AUTH_USER_KEY = "quotex.auth.serverUser.v1";

// Generates a 10-char alphanumeric temporary password for the
// customer reset flow. Demo-grade — production hashes a one-time
// reset token and emails a reset URL instead.
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++)
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function allowsPasswordlessLocalFallback(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_ALLOW_PASSWORDLESS_LOCAL_FALLBACK === "true";
}

function currentClientIpForSecurity(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(CLIENT_IP_KEY) || "local-browser";
}

function accessBlockForUser(u: User | null): boolean {
  if (!u || !u.tenantId) return false;
  if (!u.active || u.staffAccessStatus === "banned" || u.staffAccessStatus === "deleted") return true;
  return !!api.security.accessBlockFor({
    tenantId: u.tenantId,
    userId: u.id,
    ipAddress: currentClientIpForSecurity(),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks the last id we persisted, so we can ignore our own storage events.
  const lastIdRef = useRef<string | null>(null);

  // Initial hydration from localStorage.
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (id) {
      const u = api.users.get(id);
      if (u && !accessBlockForUser(u)) {
        lastIdRef.current = u.id;
        setUser(u);
      } else {
        const serverUser = loadServerSessionUser();
        if (serverUser && serverUser.id === id && !accessBlockForUser(serverUser)) {
          lastIdRef.current = serverUser.id;
          setUser(serverUser);
        } else if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEY);
          clearServerSessionUser();
        }
      }
    } else {
      const serverUser = loadServerSessionUser();
      if (serverUser && !accessBlockForUser(serverUser)) {
        lastIdRef.current = serverUser.id;
        setUser(serverUser);
      } else if (typeof window !== "undefined") {
        clearServerSessionUser();
      }
    }
    setLoading(false);
  }, []);

  // Cross-tab one-device enforcement: if another tab signs a different user
  // in or out, this tab reflects the change immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const nextId = e.newValue;
      if (nextId === lastIdRef.current) return;
      if (!nextId) {
        lastIdRef.current = null;
        setUser(null);
        return;
      }
      const u = api.users.get(nextId);
      if (u && !accessBlockForUser(u)) {
        lastIdRef.current = nextId;
        setUser(u);
      } else {
        const serverUser = loadServerSessionUser();
        if (serverUser && serverUser.id === nextId && !accessBlockForUser(serverUser)) {
          lastIdRef.current = nextId;
          setUser(serverUser);
          return;
        }
        lastIdRef.current = null;
        setUser(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((u: User | null) => {
    lastIdRef.current = u ? u.id : null;
    setUser(u);
    if (typeof window === "undefined") return;
    if (u) window.localStorage.setItem(STORAGE_KEY, u.id);
    else {
      window.localStorage.removeItem(STORAGE_KEY);
      clearServerSessionToken();
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeToDbChanges(() => {
      const fresh = api.users.get(user.id) ?? null;
      if (!fresh) {
        const serverUser = loadServerSessionUser();
        if (serverUser && serverUser.id === user.id && !accessBlockForUser(serverUser)) {
          lastIdRef.current = serverUser.id;
          setUser(serverUser);
          return;
        }
        persist(null);
        return;
      }
      if (accessBlockForUser(fresh)) {
        persist(null);
        return;
      }
      lastIdRef.current = fresh.id;
      setUser(fresh);
    });
  }, [persist, user?.id]);

  const persistIfAllowed = useCallback(
    (u: User | null) => {
      if (!u || accessBlockForUser(u)) {
        persist(null);
        return null;
      }
      persist(u);
      return u;
    },
    [persist]
  );

  const signInWithEmail = useCallback(
    (email: string) => {
      const u = api.users.byEmail(email);
      if (!u) return null;
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const signInCustomer = useCallback(
    (email: string, password: string, tenantId?: string | null) => {
      const normalized = email.trim().toLowerCase();
      const u = api
        .users
        .list(tenantId ?? undefined)
        .find((row) => row.role === "customer" && row.email.toLowerCase() === normalized);
      if (!u || u.role !== "customer") return null;
      if (!u.active || accessBlockForUser(u)) return null;
      if (!u.generatedPassword && !allowsPasswordlessLocalFallback()) return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      clearServerSessionToken();
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const resetCustomerPassword = useCallback(
    (email: string, tenantId?: string | null) => {
      const normalized = email.trim().toLowerCase();
      const u = api
        .users
        .list(tenantId ?? undefined)
        .find((row) => row.role === "customer" && row.email.toLowerCase() === normalized);
      if (!u || u.role !== "customer") return null;
      const tempPassword = generateTempPassword();
      const updated =
        api.users.update(u.id, { generatedPassword: tempPassword }) ?? u;
      return { user: updated, tempPassword };
    },
    []
  );

  const changeMyPassword = useCallback(
    (currentPassword: string, newPassword: string) => {
      if (!user)
        return { ok: false as const, reason: "Not signed in." };
      if (newPassword.length < 8)
        return {
          ok: false as const,
          reason: "New password must be at least 8 characters.",
        };
      if (user.generatedPassword && user.generatedPassword !== currentPassword)
        return { ok: false as const, reason: "Current password is incorrect." };
      const updated = api.users.update(user.id, {
        generatedPassword: newPassword,
      });
      if (updated) setUser(updated);
      return { ok: true as const };
    },
    [user]
  );

  const signInStaff = useCallback(
    async (identifier: string, password: string) => {
      const normalizedIdentifier = identifier.trim();
      const serverSession = await establishServerStaffSession(normalizedIdentifier, password);
      if (serverSession.ok) {
        const serverUser = resolveServerStaffUser(serverSession.user, normalizedIdentifier);
        if (!serverUser) return null;
        const signedIn = persistIfAllowed(serverUser);
        if (signedIn) storeServerSessionUser(signedIn);
        return signedIn;
      }

      const legacyStaff = localStaffWithMatchingPassword(normalizedIdentifier, password);
      if (legacyStaff) {
        const promotedSession = await establishServerStaffLocalPromotion(legacyStaff, password);
        if (promotedSession.ok) {
          const serverUser = resolveServerStaffUser(promotedSession.user, normalizedIdentifier);
          if (!serverUser) return null;
          const signedIn = persistIfAllowed(serverUser);
          if (signedIn) {
            api.users.update(legacyStaff.id, { generatedPassword: undefined });
            storeServerSessionUser(signedIn);
          }
          return signedIn;
        }
      }

      if (!serverSession.allowLocalFallback) return null;
      const u = legacyStaff ?? api.users.byIdentifier(normalizedIdentifier);
      if (!u || !isStaffRole(u.role)) return null;
      const agency = u.tenantId ? api.agencies.get(u.tenantId) : undefined;
      if (!agency || !agency.active) return null;
      if (accessBlockForUser(u)) return null;
      // If the account has a generated password on file, it must match.
      // Legacy local fixture accounts only fall back to identifier-only
      // sign-in when an explicit local env flag is enabled.
      if (!u.generatedPassword && !allowsPasswordlessLocalFallback()) return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      clearServerSessionUser();
      const signedIn = persistIfAllowed(u);
      return signedIn;
    },
    [persistIfAllowed]
  );

  const signInMaster = useCallback(
    (email: string, password: string) => {
      const u = api.users.masterByEmail(email);
      if (!u || !isLockingMasterAccount(u)) return null;
      if (!u.generatedPassword && !allowsPasswordlessLocalFallback()) return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      clearServerSessionToken();
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const createMasterAccount = useCallback(
    (input: { name: string; email: string; password: string }) => {
      if (api.users.masterAccountExists()) {
        return { ok: false as const, reason: "exists" as const };
      }
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      if (!name) return { ok: false as const, reason: "missing_name" as const };
      if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false as const, reason: "invalid_email" as const };
      if (input.password.length < 12) return { ok: false as const, reason: "weak_password" as const };
      try {
        const user = api.users.create({
          role: "master_admin",
          tenantId: null,
          email,
          name,
          generatedPassword: input.password,
          passwordUpdatedAt: new Date().toISOString(),
          profileCompleted: true,
        });
        clearServerSessionToken();
        persistIfAllowed(user);
        return { ok: true as const, user };
      } catch {
        return { ok: false as const, reason: "exists" as const };
      }
    },
    [persistIfAllowed]
  );

  const registerStaff = useCallback(
    async (input: {
      agencyCode: string;
      branchId?: string;
      role: StaffRole;
      firstName: string;
      lastName: string;
      phone: string;
      businessEmail: string;
      password: string;
    }) => {
      const serverSession = await establishServerStaffRegistration(input);
      if (serverSession.ok) {
        const serverUser = resolveServerStaffUser(serverSession.user, input.businessEmail);
        if (!serverUser) return { ok: false as const, reason: "server_session_invalid" };
        const localResult = api.users.registerStaff(input);
        const localUser = localResult.ok
          ? api.users.update(localResult.user.id, { generatedPassword: undefined }) ?? localResult.user
          : api.users.byIdentifier(input.businessEmail);
        const signedIn = persistIfAllowed(localUser && isStaffRole(localUser.role)
          ? {
              ...localUser,
              id: serverUser.id,
              tenantId: serverUser.tenantId,
              branchId: serverUser.branchId ?? localUser.branchId,
              email: serverUser.email,
              businessEmail: localUser.businessEmail ?? serverUser.email,
              name: serverUser.name || localUser.name,
              generatedPassword: undefined,
            }
          : serverUser);
        if (!signedIn) return { ok: false as const, reason: "access_blocked" };
        storeServerSessionUser(signedIn);
        return { ok: true as const, user: signedIn, agencyId: signedIn.tenantId ?? serverUser.tenantId ?? "" };
      }
      if (!serverSession.allowLocalFallback) {
        return { ok: false as const, reason: serverSession.reason };
      }
      const result = api.users.registerStaff(input);
      if (!result.ok) return result;
      persistIfAllowed(result.user);
      return { ok: true as const, user: result.user, agencyId: result.agency.id };
    },
    [persistIfAllowed]
  );

  const signOut = useCallback(() => persist(null), [persist]);

  const refreshUser = useCallback(() => {
    if (!user) return null;
    const fresh = api.users.get(user.id) ?? null;
    const next = fresh ?? loadServerSessionUser();
    setUser(next);
    lastIdRef.current = next?.id ?? null;
    return next;
  }, [user]);

  const hasRole = useCallback(
    (...roles: Role[]) => !!user && roles.includes(user.role),
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signInWithEmail,
      signInCustomer,
      resetCustomerPassword,
      changeMyPassword,
      signInStaff,
      signInMaster,
      createMasterAccount,
      registerStaff,
      signOut,
      refreshUser,
      hasRole,
    }),
    [
      user,
      loading,
      signInWithEmail,
      signInCustomer,
      resetCustomerPassword,
      changeMyPassword,
      signInStaff,
      signInMaster,
      createMasterAccount,
      registerStaff,
      signOut,
      refreshUser,
      hasRole,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type ServerSessionResult =
  | { ok: true; user: ServerSessionUser }
  | { ok: false; allowLocalFallback: boolean; reason: string };

type ServerSessionUser = {
  id: string;
  tenantId: string | null;
  branchId?: string | null;
  role: string;
  email: string;
  name: string;
};

function localStaffWithMatchingPassword(identifier: string, password: string): User | null {
  const u = api.users.byIdentifier(identifier);
  if (!u || !isStaffRole(u.role)) return null;
  const agency = u.tenantId ? api.agencies.get(u.tenantId) : undefined;
  if (!agency || !agency.active) return null;
  if (accessBlockForUser(u)) return null;
  if (!u.generatedPassword || u.generatedPassword !== password) return null;
  return u;
}

function serializeAgencyForStaffPromotion(agency: Agency) {
  return {
    id: agency.id,
    name: agency.name,
    contactEmail: agency.contactEmail,
    phone: agency.phone,
    address: agency.address,
    website: agency.website,
    websiteSlug: agency.websiteSlug,
    websiteEnabled: agency.websiteEnabled,
    tier: agency.tier,
    active: agency.active,
    allowedUsers: agency.allowedUsers,
    agencyCode: agency.agencyCode,
    agencyCodeEncrypted: agency.agencyCodeEncrypted,
    agencyCodePreview: agency.agencyCodePreview,
  };
}

function serializeBranchForStaffPromotion(branch: Branch) {
  return {
    id: branch.id,
    agencyId: branch.agencyId,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    zip: branch.zip,
    phone: branch.phone,
  };
}

async function establishServerStaffSession(identifier: string, password: string): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  const payload = JSON.stringify({ identifier, password });
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/employee/login`,
    "/api/auth/employee/login",
    "/api/app/api/auth/employee/login",
  ]);
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (response.status === 404 || response.status === 405) continue;
      sawReachableAuthRoute = true;
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; token?: string; reason?: string; user?: Partial<ServerSessionUser> }
        | null;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        storeServerSessionToken(json.token);
        return { ok: true, user: json.user };
      }
      clearServerSessionToken();
      clearServerSessionUser();
      return {
        ok: false,
        allowLocalFallback: import.meta.env.DEV,
        reason: json?.reason || `auth_http_${response.status}`,
      };
    } catch {
      continue;
    }
  }
  clearServerSessionToken();
  clearServerSessionUser();
  return {
    ok: false,
    allowLocalFallback: import.meta.env.DEV && !sawReachableAuthRoute,
    reason: "auth_route_unavailable",
  };
}

async function establishServerStaffRegistration(input: {
  agencyCode: string;
  branchId?: string;
  role: StaffRole;
  firstName: string;
  lastName: string;
  phone: string;
  businessEmail: string;
  password: string;
}): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  const payload = JSON.stringify(input);
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/employee/register`,
    "/api/auth/employee/register",
    "/api/app/api/auth/employee/register",
  ]);
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      if (response.status === 404 || response.status === 405) continue;
      sawReachableAuthRoute = true;
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; token?: string; error?: string; reason?: string; user?: Partial<ServerSessionUser> }
        | null;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        storeServerSessionToken(json.token);
        return { ok: true, user: json.user };
      }
      clearServerSessionToken();
      clearServerSessionUser();
      return {
        ok: false,
        allowLocalFallback: import.meta.env.DEV,
        reason: json?.error || json?.reason || `auth_http_${response.status}`,
      };
    } catch {
      continue;
    }
  }
  clearServerSessionToken();
  clearServerSessionUser();
  return {
    ok: false,
    allowLocalFallback: import.meta.env.DEV && !sawReachableAuthRoute,
    reason: "auth_route_unavailable",
  };
}

async function establishServerStaffLocalPromotion(localUser: User, password: string): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  if (!localUser.tenantId || !isStaffRole(localUser.role)) {
    return { ok: false, allowLocalFallback: false, reason: "missing_fields" };
  }
  const agency = api.agencies.get(localUser.tenantId);
  if (!agency) return { ok: false, allowLocalFallback: false, reason: "agency_not_found" };
  const branch = localUser.branchId
    ? api.branches.listByAgency(agency.id).find((candidate) => candidate.id === localUser.branchId)
    : undefined;
  const payload = JSON.stringify({
    password,
    user: {
      id: localUser.id,
      tenantId: localUser.tenantId,
      branchId: localUser.branchId ?? null,
      role: localUser.role,
      email: localUser.email,
      businessEmail: localUser.businessEmail ?? localUser.email,
      firstName: localUser.firstName,
      lastName: localUser.lastName,
      name: localUser.name,
      phone: localUser.phone,
      active: localUser.active !== false,
      staffAccessStatus: localUser.staffAccessStatus ?? "active",
    },
    agency: serializeAgencyForStaffPromotion(agency),
    branch: branch ? serializeBranchForStaffPromotion(branch) : null,
  });
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/employee/promote-local`,
    "/api/auth/employee/promote-local",
    "/api/app/api/auth/employee/promote-local",
  ]);
  const stateToken = envValue("VITE_STATE_SYNC_TOKEN");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (stateToken) headers["x-state-sync-token"] = stateToken;
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
      });
      if (response.status === 404 || response.status === 405) continue;
      sawReachableAuthRoute = true;
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; token?: string; error?: string; reason?: string; user?: Partial<ServerSessionUser> }
        | null;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        storeServerSessionToken(json.token);
        return { ok: true, user: json.user };
      }
      clearServerSessionToken();
      clearServerSessionUser();
      return {
        ok: false,
        allowLocalFallback: import.meta.env.DEV,
        reason: json?.error || json?.reason || `auth_http_${response.status}`,
      };
    } catch {
      continue;
    }
  }
  clearServerSessionToken();
  clearServerSessionUser();
  return {
    ok: false,
    allowLocalFallback: import.meta.env.DEV && !sawReachableAuthRoute,
    reason: "auth_route_unavailable",
  };
}

function resolveServerStaffUser(serverUser: ServerSessionUser, identifier: string): User | null {
  if (!isStaffRole(serverUser.role as Role)) return null;
  const local =
    api.users.get(serverUser.id) ??
    api.users.byIdentifier(serverUser.email) ??
    api.users.byIdentifier(identifier);
  if (local && isStaffRole(local.role)) {
    return {
      ...local,
      tenantId: serverUser.tenantId,
      branchId: serverUser.branchId ?? local.branchId,
      email: serverUser.email,
      businessEmail: local.businessEmail ?? serverUser.email,
      name: serverUser.name || local.name,
      active: local.active !== false,
    };
  }
  return {
    id: serverUser.id,
    tenantId: serverUser.tenantId,
    branchId: serverUser.branchId ?? undefined,
    role: serverUser.role as StaffRole,
    email: serverUser.email,
    businessEmail: serverUser.email,
    name: serverUser.name || serverUser.email,
    staffAccessStatus: "active",
    profileCompleted: true,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

function isServerStaffUser(value: unknown): value is ServerSessionUser {
  const user = value as Partial<ServerSessionUser> | null | undefined;
  return Boolean(
    user &&
      typeof user.id === "string" &&
      typeof user.email === "string" &&
      typeof user.name === "string" &&
      (user.tenantId === null || typeof user.tenantId === "string") &&
      isStaffRole(user.role as Role)
  );
}

function storeServerSessionToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.localStorage.setItem(LEGACY_AUTH_TOKEN_KEY, token);
}

function clearServerSessionToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
  clearServerSessionUser();
}

function storeServerSessionUser(user: User) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SERVER_AUTH_USER_KEY, JSON.stringify(user));
}

function loadServerSessionUser(): User | null {
  if (typeof window === "undefined") return null;
  if (!window.localStorage.getItem(AUTH_TOKEN_KEY) && !window.localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)) {
    clearServerSessionUser();
    return null;
  }
  const raw = window.localStorage.getItem(SERVER_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string" &&
      isStaffRole(parsed.role)
    ) {
      return {
        id: parsed.id,
        tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : null,
        branchId: typeof parsed.branchId === "string" ? parsed.branchId : undefined,
        role: parsed.role,
        email: parsed.email,
        businessEmail: parsed.businessEmail ?? parsed.email,
        name: parsed.name,
        staffAccessStatus: parsed.staffAccessStatus ?? "active",
        profileCompleted: parsed.profileCompleted ?? true,
        active: parsed.active !== false,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      };
    }
  } catch {
    // Ignore corrupt persisted auth shadow data.
  }
  clearServerSessionUser();
  return null;
}

function clearServerSessionUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SERVER_AUTH_USER_KEY);
}

function uniqueAuthUrls(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.replace(/\/+$/, "");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
