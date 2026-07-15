import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Agency, Branch, Role, User } from "@/types";
import { api } from "./api";
import { apiBaseUrl, envValue } from "./apiBase";
import { db, subscribeToDbChanges } from "./db";
import { isStaffRole, type StaffRole } from "./roles";

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
  ) => Promise<AuthResult>;
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
  signInStaff: (identifier: string, password: string) => Promise<AuthResult>;
  signInMaster: (email: string, password: string) => Promise<AuthResult>;
  createMasterAccount: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<
    | { ok: true; user: User }
    | { ok: false; reason: "exists" | "invalid_email" | "weak_password" | "missing_name" | "server_unavailable" }
  >;
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
const SESSION_CHANGED_KEY = "quotex.auth.sessionChanged.v1";
const CLIENT_IP_KEY = "quotex.security.clientIp.v1";
const AUTH_TOKEN_KEY = "quotex.authToken";
const LEGACY_AUTH_TOKEN_KEY = "quotex.jwt";
const SERVER_AUTH_USER_KEY = "quotex.auth.serverUser.v1";
const AUTH_REQUEST_TIMEOUT_MS = 25_000;

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

function accessBlockForUser(u: User | null, options: { trustServerSession?: boolean } = {}): boolean {
  if (!u || !u.tenantId) return false;
  const staffStatus = u.staffAccessStatus as string | undefined;
  if (!u.active || staffStatus === "banned" || staffStatus === "deleted" || staffStatus === "inactive") return true;
  if (options.trustServerSession) return false;
  const agency = api.agencies.get(u.tenantId);
  if (agency && !agency.active) return true;
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

  const persist = useCallback((u: User | null) => {
    lastIdRef.current = u ? u.id : null;
    setUser(u);
    if (typeof window === "undefined") return;
    safeStorageRemove(STORAGE_KEY);
    if (!u) {
      clearServerSessionToken();
    }
    safeStorageSet(SESSION_CHANGED_KEY, String(Date.now()));
  }, []);

  // Initial hydration from the server session only. Browser-local user records
  // are not allowed to authenticate a production session.
  useEffect(() => {
    let cancelled = false;
    migrateLegacyAuthStorage();
    const tokenAtHydrationStart = currentServerSessionToken();

    if (!tokenAtHydrationStart) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    establishServerCurrentSession(tokenAtHydrationStart)
      .then(async (session) => {
        if (cancelled) return;
        const currentToken = currentServerSessionToken();
        if (currentToken && currentToken !== tokenAtHydrationStart) return;
        if (session.ok) {
          const resolved = resolveAnyServerUser(session.user);
          if (resolved && !accessBlockForUser(resolved, { trustServerSession: true })) {
            storeServerSessionUser(resolved);
            persist(resolved);
            await db.hydrateNow();
          } else {
            persist(null);
          }
        } else if (!isTransientSessionFailure(session.reason)) {
          persist(null);
        } else {
          setUser(loadServerSessionUser());
        }
      })
      .catch(() => {
        if (!cancelled && currentServerSessionToken() === tokenAtHydrationStart) setUser(loadServerSessionUser());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [persist]);

  // Cross-tab one-device enforcement: if another tab signs a different user
  // in or out, this tab reflects the change immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_CHANGED_KEY && e.key !== AUTH_TOKEN_KEY) return;
      const token = currentServerSessionToken();
      if (!token) {
        lastIdRef.current = null;
        setUser(null);
        return;
      }
      establishServerCurrentSession().then(async (session) => {
        if (!session.ok) {
          if (isTransientSessionFailure(session.reason)) {
            const cached = loadServerSessionUser();
            if (cached && !accessBlockForUser(cached, { trustServerSession: true })) {
              lastIdRef.current = cached.id;
              setUser(cached);
              return;
            }
          }
          lastIdRef.current = null;
          setUser(null);
          return;
        }
        const resolved = resolveAnyServerUser(session.user);
        if (resolved && !accessBlockForUser(resolved, { trustServerSession: true })) {
          storeServerSessionUser(resolved);
          await db.hydrateNow();
          lastIdRef.current = resolved.id;
          setUser(resolved);
          return;
        }
        lastIdRef.current = null;
        setUser(null);
      });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (hasServerSessionToken()) {
      return subscribeToDbChanges(() => {
        if (!user.tenantId) return;
        const agency = api.agencies.get(user.tenantId);
        if (agency && !agency.active) persist(null);
      });
    }
    return subscribeToDbChanges(() => {
      const fresh = api.users.get(user.id) ?? null;
      if (!fresh) {
        const serverUser = loadServerSessionUser();
        if (serverUser && serverUser.id === user.id && !accessBlockForUser(serverUser, { trustServerSession: true })) {
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
    (u: User | null, options: { trustServerSession?: boolean } = {}) => {
      if (!u || accessBlockForUser(u, options)) {
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
      if (!allowsPasswordlessLocalFallback()) return null;
      const u = api.users.byEmail(email);
      if (!u) return null;
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const signInCustomer = useCallback(
    async (email: string, password: string, tenantId?: string | null): Promise<AuthResult> => {
      const normalized = email.trim().toLowerCase();
      const serverSession = await establishCanonicalLogin("customer", normalized, password, tenantId);
      if (!serverSession.ok) {
        persist(null);
        return { ok: false, reason: serverSession.reason };
      }
      const serverUser = resolveAnyServerUser(serverSession.user);
      const signedIn = persistIfAllowed(serverUser, { trustServerSession: true });
      if (!signedIn) return { ok: false, reason: "account_disabled" };
      storeServerSessionUser(signedIn);
      return { ok: true, user: signedIn };
    },
    [persist, persistIfAllowed]
  );

  const resetCustomerPassword = useCallback(
    (email: string, tenantId?: string | null) => {
      if (!allowsPasswordlessLocalFallback()) return null;
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
      if (!allowsPasswordlessLocalFallback()) {
        return {
          ok: false as const,
          reason: "Password changes must be completed through the secure server.",
        };
      }
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
    async (identifier: string, password: string): Promise<AuthResult> => {
      const normalizedIdentifier = identifier.trim();
      const serverSession = await establishCanonicalLogin("staff", normalizedIdentifier, password);
      if (!serverSession.ok) {
        persist(null);
        return { ok: false, reason: serverSession.reason };
      }
      syncServerSessionContext({ agency: serverSession.user.agency });
      const serverUser = resolveServerStaffUser(serverSession.user, normalizedIdentifier);
      if (!serverUser) return { ok: false, reason: "wrong_portal" };
      const signedIn = persistIfAllowed(serverUser, { trustServerSession: true });
      if (!signedIn) return { ok: false, reason: "account_disabled" };
      storeServerSessionUser(signedIn);
      return { ok: true, user: signedIn };
    },
    [persist, persistIfAllowed]
  );

  const signInMaster = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      const normalizedEmail = email.trim().toLowerCase();
      const directMasterSession = await establishServerMasterSession(normalizedEmail, password);
      const serverSession = directMasterSession.ok
        ? directMasterSession
        : await establishCanonicalLogin("master", normalizedEmail, password);
      if (!serverSession.ok) {
        persist(null);
        return { ok: false, reason: serverSession.reason };
      }
      const signedIn = persistIfAllowed(resolveServerMasterUser(serverSession.user, normalizedEmail), {
        trustServerSession: true,
      });
      if (!signedIn) return { ok: false, reason: "account_disabled" };
      storeServerSessionUser(signedIn);
      return { ok: true, user: signedIn };
    },
    [persist, persistIfAllowed]
  );

  const createMasterAccount = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      if (!name) return { ok: false as const, reason: "missing_name" as const };
      if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false as const, reason: "invalid_email" as const };
      if (input.password.length < 12) return { ok: false as const, reason: "weak_password" as const };
      const serverSession = await establishServerMasterCreate({ name, email, password: input.password });
      if (!serverSession.ok && !serverSession.allowLocalFallback) {
        return {
          ok: false as const,
          reason: serverSession.reason === "master_account_exists" ? "exists" as const : "server_unavailable" as const,
        };
      }
      const localUser =
        api.users.masterByEmail(email) ??
        (() => {
          try {
            return api.users.create({
              role: "master_admin",
              tenantId: null,
              email,
              name,
              generatedPassword: undefined,
              passwordUpdatedAt: new Date().toISOString(),
              profileCompleted: true,
            });
          } catch {
            return null;
          }
        })();
      const serverUser = serverSession.ok
        ? resolveServerMasterUser(serverSession.user, email, localUser)
        : localUser ?? {
            id: `master_${Date.now()}`,
            role: "master_admin" as const,
            tenantId: null,
            email,
            businessEmail: email,
            name,
            profileCompleted: true,
            active: true,
            createdAt: new Date().toISOString(),
          };
      const signedIn = persistIfAllowed(serverUser, { trustServerSession: serverSession.ok });
      if (!signedIn) return { ok: false as const, reason: "server_unavailable" as const };
      if (serverSession.ok) storeServerSessionUser(signedIn);
      return { ok: true as const, user: signedIn };
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
        syncServerSessionContext(serverSession);
        const serverUser = resolveServerStaffUser(serverSession.user, input.businessEmail);
        if (!serverUser) return { ok: false as const, reason: "server_session_invalid" };
        const localResult = api.users.registerStaff(input);
        const localUser = localResult.ok
          ? api.users.update(localResult.user.id, { generatedPassword: undefined }) ?? localResult.user
          : api.users.byIdentifier(input.businessEmail);
        const candidate = localUser && isStaffRole(localUser.role)
          ? {
              ...localUser,
              id: serverUser.id,
              tenantId: serverUser.tenantId,
              branchId: serverUser.branchId ?? localUser.branchId,
              email: serverUser.email,
              businessEmail: localUser.businessEmail ?? serverUser.email,
              name: serverUser.name || localUser.name,
              generatedPassword: undefined,
              staffAccessStatus: "active" as const,
              profileCompleted: true,
              active: true,
            }
          : serverUser;
        const signedIn = persistIfAllowed(candidate, { trustServerSession: true });
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

  const signOut = useCallback(() => {
    void fetchAuthRoute(`${apiBaseUrl()}/auth/logout`, {
      method: "POST",
      headers: currentServerSessionToken() ? { authorization: `Bearer ${currentServerSessionToken()}` } : undefined,
    }).catch(() => undefined);
    persist(null);
  }, [persist]);

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
  | { ok: true; user: ServerSessionUser; agency?: ServerSessionAgency | null }
  | { ok: false; allowLocalFallback: boolean; reason: string };

type CanonicalLoginScope = "customer" | "staff" | "master";

type ServerSessionUser = {
  id: string;
  tenantId: string | null;
  branchId?: string | null;
  role: string;
  email: string;
  name: string;
  agency?: ServerSessionAgency;
};

type AuthRouteJson = {
  ok?: boolean;
  token?: string;
  error?: string;
  reason?: string;
  user?: Partial<ServerSessionUser>;
  agency?: Partial<ServerSessionAgency> | null;
};

type ServerSessionAgency = {
  id: string;
  name: string;
  contactEmail?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  websiteSlug?: string | null;
  websiteEnabled?: boolean | null;
  serviceAreas?: unknown;
  agencyCodePreview?: string | null;
  tier?: string | null;
  active?: boolean | null;
  allowedUsers?: number | null;
  allowedProspectsPerMonth?: number | null;
  allowedAiMessagesPerMonth?: number | null;
  allowedCarriers?: number | null;
  createdAt?: string | null;
};

function localStaffWithMatchingPassword(identifier: string, password: string): User | null {
  const u = localStaffByIdentifier(identifier);
  if (!u || !isStaffRole(u.role)) return null;
  const agency = u.tenantId ? api.agencies.get(u.tenantId) : undefined;
  if (!agency || !agency.active) return null;
  if (accessBlockForUser(u)) return null;
  if (!u.generatedPassword || u.generatedPassword !== password) return null;
  return u;
}

function localMasterWithMatchingPassword(email: string, password: string): User | null {
  const u = api.users.masterByEmail(email);
  if (!u || u.role !== "master_admin") return null;
  if (accessBlockForUser(u)) return null;
  if (!u.generatedPassword || u.generatedPassword !== password) return null;
  return u;
}

function localStaffByIdentifier(identifier: string, tenantId?: string | null): User | null {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  return (
    api.users
      .list(tenantId ?? undefined)
      .find(
        (row) =>
          isStaffRole(row.role) &&
          ((row.username?.toLowerCase() ?? "") === normalized ||
            row.email.toLowerCase() === normalized ||
            row.businessEmail?.toLowerCase() === normalized)
      ) ?? null
  );
}

function serializeAgencyForStaffPromotion(agency: Agency) {
  const contactEmail = agency.contactEmail?.trim();
  return {
    id: agency.id,
    name: agency.name,
    contactEmail: contactEmail && /^\S+@\S+\.\S+$/.test(contactEmail) ? contactEmail : undefined,
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

function syncServerSessionContext(session: { agency?: ServerSessionAgency | null }) {
  if (!session.agency) return;
  const serverAgency = session.agency;
  const existing = db.list("agencies").find((agency) => agency.id === serverAgency.id);
  const agencyPatch: Partial<Agency> = {
    name: serverAgency.name,
    contactEmail: serverAgency.contactEmail ?? existing?.contactEmail ?? serverAgency.name,
    phone: serverAgency.phone ?? existing?.phone,
    address: serverAgency.address ?? existing?.address,
    website: serverAgency.website ?? existing?.website,
    websiteSlug: serverAgency.websiteSlug ?? existing?.websiteSlug,
    websiteEnabled: serverAgency.websiteEnabled ?? existing?.websiteEnabled ?? false,
    tier: normalizeServerAgencyTier(serverAgency.tier ?? existing?.tier),
    active: serverAgency.active !== false,
    allowedUsers: boundedSessionNumber(serverAgency.allowedUsers, existing?.allowedUsers ?? 1),
    allowedProspectsPerMonth: boundedSessionNumber(
      serverAgency.allowedProspectsPerMonth,
      existing?.allowedProspectsPerMonth ?? 100
    ),
    allowedAiMessagesPerMonth: boundedSessionNumber(
      serverAgency.allowedAiMessagesPerMonth,
      existing?.allowedAiMessagesPerMonth ?? 500
    ),
    allowedCarriers: boundedSessionNumber(serverAgency.allowedCarriers, existing?.allowedCarriers ?? 10),
    agencyCodePreview: serverAgency.agencyCodePreview ?? existing?.agencyCodePreview ?? "",
  };

  if (existing) {
    db.update("agencies", existing.id, agencyPatch);
    return;
  }

  const now = new Date().toISOString();
  const agency: Agency = {
    id: serverAgency.id,
    name: serverAgency.name,
    contactEmail: serverAgency.contactEmail ?? serverAgency.name,
    phone: serverAgency.phone ?? undefined,
    address: serverAgency.address ?? undefined,
    website: serverAgency.website ?? undefined,
    websiteSlug: serverAgency.websiteSlug ?? undefined,
    websiteEnabled: serverAgency.websiteEnabled ?? false,
    serviceAreas: [],
    agencyCodeEncrypted: "",
    agencyCodePreview: serverAgency.agencyCodePreview ?? "",
    tier: normalizeServerAgencyTier(serverAgency.tier),
    active: serverAgency.active !== false,
    allowedUsers: boundedSessionNumber(serverAgency.allowedUsers, 1),
    allowedProspectsPerMonth: boundedSessionNumber(serverAgency.allowedProspectsPerMonth, 100),
    allowedAiMessagesPerMonth: boundedSessionNumber(serverAgency.allowedAiMessagesPerMonth, 500),
    allowedCarriers: boundedSessionNumber(serverAgency.allowedCarriers, 10),
    createdAt: now,
  };
  db.insert("agencies", agency);
}

function normalizeServerAgencyTier(value: unknown): Agency["tier"] {
  return value === "mid" || value === "ultra" ? value : "minimum";
}

function boundedSessionNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
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
      const response = await fetchAuthRoute(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      const json = await readAuthRouteJson(response);
      if (isMissingAuthRoute(response, json)) continue;
      sawReachableAuthRoute = true;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        await storeServerSessionAndHydrate(json.token);
        return { ok: true, user: json.user, agency: isServerSessionAgency(json.agency) ? json.agency : null };
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

async function establishCanonicalLogin(
  scope: CanonicalLoginScope,
  identifier: string,
  password: string,
  tenantId?: string | null
): Promise<{ ok: true; user: ServerSessionUser } | { ok: false; reason: AuthFailReason }> {
  if (typeof window === "undefined") return { ok: false, reason: "server_unreachable" };
  try {
    const response = await fetchAuthRoute(`${apiBaseUrl()}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, identifier, password, tenantId: tenantId || undefined }),
    });
    const json = await readAuthRouteJson(response);
    if (
      response.ok &&
      json?.ok &&
      typeof json.token === "string" &&
      json.token.trim() &&
      isServerAnyUser(json.user)
    ) {
      await storeServerSessionAndHydrate(json.token);
      return { ok: true, user: json.user };
    }
    clearServerSessionToken();
    clearServerSessionUser();
    return { ok: false, reason: normalizeAuthFailReason(json?.reason || json?.error, response.status) };
  } catch {
    clearServerSessionToken();
    clearServerSessionUser();
    return { ok: false, reason: "server_unreachable" };
  }
}

async function establishServerMasterSession(email: string, password: string): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  const payload = JSON.stringify({ email, password });
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/master/login`,
    "/api/auth/master/login",
    "/api/app/api/auth/master/login",
  ]);
  return postMasterAuthRoute(candidates, payload);
}

async function establishServerMasterCreate(input: {
  name: string;
  email: string;
  password: string;
}): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  const payload = JSON.stringify(input);
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/master/create`,
    "/api/auth/master/create",
    "/api/app/api/auth/master/create",
  ]);
  return postMasterAuthRoute(candidates, payload);
}

async function establishServerCurrentSession(expectedToken?: string | null): Promise<ServerSessionResult> {
  if (typeof window === "undefined") {
    return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  }
  const token = expectedToken || currentServerSessionToken();
  if (!token) {
    return { ok: false, allowLocalFallback: true, reason: "missing_token" };
  }
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/session`,
    "/api/auth/session",
    "/api/app/api/auth/session",
  ]);
  for (const url of candidates) {
    try {
      const response = await fetchAuthRoute(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await readAuthRouteJson(response);
      if (isMissingAuthRoute(response, json)) continue;
      if (response.ok && json?.ok && isServerAnyUser(json.user)) {
        return { ok: true, user: json.user };
      }
      const reason = normalizeAuthFailReason(json?.reason || json?.error, response.status);
      if ((response.status === 401 || response.status === 403) && currentServerSessionToken() === token) {
        clearServerSessionToken();
        clearServerSessionUser();
      }
      return { ok: false, allowLocalFallback: false, reason };
    } catch {
      continue;
    }
  }
  return { ok: false, allowLocalFallback: false, reason: "server_unreachable" };
}

async function establishServerMasterLocalPromotion(localUser: User, password: string): Promise<ServerSessionResult> {
  if (typeof window === "undefined") return { ok: false, allowLocalFallback: false, reason: "browser_unavailable" };
  if (localUser.role !== "master_admin") return { ok: false, allowLocalFallback: false, reason: "missing_fields" };
  const payload = JSON.stringify({
    password,
    user: {
      id: localUser.id,
      role: "master_admin",
      email: localUser.email,
      name: localUser.name || localUser.email,
      active: localUser.active !== false,
      staffAccessStatus: localUser.staffAccessStatus ?? "active",
    },
  });
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/master/promote-local`,
    "/api/auth/master/promote-local",
    "/api/app/api/auth/master/promote-local",
  ]);
  return postMasterAuthRoute(candidates, payload);
}

async function postMasterAuthRoute(candidates: string[], payload: string): Promise<ServerSessionResult> {
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetchAuthRoute(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      const json = await readAuthRouteJson(response);
      if (isMissingAuthRoute(response, json)) continue;
      sawReachableAuthRoute = true;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerMasterUser(json.user)) {
        await storeServerSessionAndHydrate(json.token);
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
  const agency = api.agencies.byCode(input.agencyCode);
  const branch = input.branchId && agency
    ? api.branches.listByAgency(agency.id).find((candidate) => candidate.id === input.branchId)
    : undefined;
  if (agency) await db.syncNow().catch(() => false);
  const payload = JSON.stringify({
    ...input,
    agency: agency ? serializeAgencyForStaffPromotion(agency) : undefined,
    branch: branch ? serializeBranchForStaffPromotion(branch) : undefined,
  });
  const candidates = uniqueAuthUrls([
    `${apiBaseUrl()}/auth/employee/register`,
    "/api/auth/employee/register",
    "/api/app/api/auth/employee/register",
  ]);
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetchAuthRoute(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      const json = await readAuthRouteJson(response);
      if (isMissingAuthRoute(response, json)) continue;
      sawReachableAuthRoute = true;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        await storeServerSessionAndHydrate(json.token);
        return { ok: true, user: json.user, agency: isServerSessionAgency(json.agency) ? json.agency : null };
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

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeSessionAgencyTier(value: unknown, fallback?: Agency["tier"]): Agency["tier"] {
  if (value === "minimum" || value === "mid" || value === "ultra") return value;
  if (value === "starter" || value === "basic") return "minimum";
  return fallback ?? "minimum";
}

function normalizeSessionServiceAreas(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((area): area is string => typeof area === "string")
    .map((area) => area.trim().toUpperCase())
    .filter(Boolean);
}

function hydrateServerStaffAgency(serverUser: ServerSessionUser): Agency | undefined {
  const snapshot = serverUser.agency;
  if (!serverUser.tenantId || !snapshot || snapshot.id !== serverUser.tenantId || !snapshot.id || !snapshot.name) {
    return undefined;
  }
  const existing = db.list("agencies").find((agency) => agency.id === snapshot.id);
  const row: Agency = {
    ...(existing ?? {}),
    id: snapshot.id,
    name: snapshot.name,
    contactEmail: snapshot.contactEmail?.trim() || existing?.contactEmail || serverUser.email,
    phone: snapshot.phone ?? existing?.phone,
    address: snapshot.address ?? existing?.address,
    website: snapshot.website ?? existing?.website,
    websiteSlug: snapshot.websiteSlug ?? existing?.websiteSlug,
    websiteEnabled: typeof snapshot.websiteEnabled === "boolean" ? snapshot.websiteEnabled : existing?.websiteEnabled,
    serviceAreas: normalizeSessionServiceAreas(snapshot.serviceAreas, existing?.serviceAreas ?? []),
    agencyCodeEncrypted: existing?.agencyCodeEncrypted ?? "",
    agencyCodePreview: snapshot.agencyCodePreview ?? existing?.agencyCodePreview ?? "",
    tier: normalizeSessionAgencyTier(snapshot.tier, existing?.tier),
    active: snapshot.active !== false,
    allowedUsers: positiveInteger(snapshot.allowedUsers, existing?.allowedUsers ?? 1),
    allowedProspectsPerMonth: positiveInteger(
      snapshot.allowedProspectsPerMonth,
      existing?.allowedProspectsPerMonth ?? 100
    ),
    allowedAiMessagesPerMonth: positiveInteger(
      snapshot.allowedAiMessagesPerMonth,
      existing?.allowedAiMessagesPerMonth ?? 500
    ),
    allowedCarriers: positiveInteger(snapshot.allowedCarriers, existing?.allowedCarriers ?? 10),
    softwareProduct: existing?.softwareProduct ?? "full_platform",
    createdAt: snapshot.createdAt || existing?.createdAt || new Date().toISOString(),
  };
  if (existing) return db.update("agencies", existing.id, row) ?? row;
  return db.insert("agencies", row);
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
  const headers: Record<string, string> = { "content-type": "application/json" };
  let sawReachableAuthRoute = false;
  for (const url of candidates) {
    try {
      const response = await fetchAuthRoute(url, {
        method: "POST",
        headers,
        body: payload,
      });
      const json = await readAuthRouteJson(response);
      if (isMissingAuthRoute(response, json)) continue;
      sawReachableAuthRoute = true;
      if (response.ok && json?.ok && typeof json.token === "string" && json.token.trim() && isServerStaffUser(json.user)) {
        await storeServerSessionAndHydrate(json.token);
        return { ok: true, user: json.user, agency: isServerSessionAgency(json.agency) ? json.agency : null };
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
  hydrateServerStaffAgency(serverUser);
  const local =
    api.users.get(serverUser.id) ??
    localStaffByIdentifier(serverUser.email, serverUser.tenantId) ??
    localStaffByIdentifier(identifier, serverUser.tenantId);
  if (local && isStaffRole(local.role)) {
    return {
      ...local,
      id: serverUser.id,
      tenantId: serverUser.tenantId,
      branchId: serverUser.branchId ?? local.branchId,
      email: serverUser.email,
      businessEmail: local.businessEmail ?? serverUser.email,
      name: serverUser.name || local.name,
      generatedPassword: undefined,
      staffAccessStatus: "active",
      profileCompleted: true,
      active: true,
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

function resolveServerMasterUser(serverUser: ServerSessionUser, identifier: string, localMaster?: User | null): User {
  const local =
    localMaster ??
    api.users.get(serverUser.id) ??
    api.users.masterByEmail(serverUser.email) ??
    api.users.masterByEmail(identifier);
  return {
    ...(local ?? {}),
    id: serverUser.id,
    tenantId: null,
    branchId: undefined,
    role: "master_admin",
    email: serverUser.email,
    businessEmail: serverUser.email,
    name: serverUser.name || local?.name || serverUser.email,
    generatedPassword: undefined,
    staffAccessStatus: "active",
    profileCompleted: true,
    active: true,
    createdAt: local?.createdAt ?? new Date().toISOString(),
  };
}

function resolveServerCustomerUser(serverUser: ServerSessionUser): User | null {
  if (serverUser.role !== "customer") return null;
  const local =
    api.users.get(serverUser.id) ??
    api.users
      .list(serverUser.tenantId ?? undefined)
      .find((candidate) => candidate.role === "customer" && candidate.email.toLowerCase() === serverUser.email.toLowerCase());
  return {
    ...(local ?? {}),
    id: serverUser.id,
    tenantId: serverUser.tenantId,
    branchId: serverUser.branchId ?? local?.branchId,
    role: "customer",
    email: serverUser.email,
    businessEmail: local?.businessEmail ?? serverUser.email,
    name: serverUser.name || local?.name || serverUser.email,
    generatedPassword: undefined,
    profileCompleted: true,
    active: true,
    createdAt: local?.createdAt ?? new Date().toISOString(),
  };
}

function resolveAnyServerUser(serverUser: ServerSessionUser, cachedUser?: User | null): User | null {
  if (serverUser.role === "master_admin") {
    const localMaster =
      cachedUser?.role === "master_admin"
        ? cachedUser
        : api.users.masterByEmail(serverUser.email);
    return resolveServerMasterUser(serverUser, serverUser.email, localMaster);
  }
  if (serverUser.role === "customer") return resolveServerCustomerUser(serverUser);
  return resolveServerStaffUser(serverUser, serverUser.email);
}

function isServerAnyUser(value: unknown): value is ServerSessionUser {
  return isServerMasterUser(value) || isServerStaffUser(value) || isServerCustomerUser(value);
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

function isServerSessionAgency(value: unknown): value is ServerSessionAgency {
  const agency = value as Partial<ServerSessionAgency> | null | undefined;
  return Boolean(
    agency &&
      typeof agency.id === "string" &&
      typeof agency.name === "string"
  );
}

function isServerCustomerUser(value: unknown): value is ServerSessionUser {
  const user = value as Partial<ServerSessionUser> | null | undefined;
  return Boolean(
    user &&
      typeof user.id === "string" &&
      typeof user.email === "string" &&
      typeof user.name === "string" &&
      (user.tenantId === null || typeof user.tenantId === "string") &&
      user.role === "customer"
  );
}

function isServerMasterUser(value: unknown): value is ServerSessionUser {
  const user = value as Partial<ServerSessionUser> | null | undefined;
  return Boolean(
    user &&
      typeof user.id === "string" &&
      typeof user.email === "string" &&
      typeof user.name === "string" &&
      user.tenantId === null &&
      user.role === "master_admin"
  );
}

function isPersistableServerUser(value: Partial<User>): value is Partial<User> & Pick<User, "id" | "email" | "name" | "role"> {
  return Boolean(
    typeof value.id === "string" &&
      typeof value.email === "string" &&
      typeof value.name === "string" &&
      (isStaffRole(value.role as Role) || value.role === "master_admin" || value.role === "customer")
  );
}

function storeServerSessionToken(token: string) {
  if (typeof window === "undefined") return;
  if (!safeStorageSet(AUTH_TOKEN_KEY, token)) {
    safeSessionStorageSet(AUTH_TOKEN_KEY, token);
  }
  safeStorageRemove(LEGACY_AUTH_TOKEN_KEY);
  safeSessionStorageRemove(LEGACY_AUTH_TOKEN_KEY);
}

async function storeServerSessionAndHydrate(token: string) {
  storeServerSessionToken(token);
  await db.hydrateNow();
}

function currentServerSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    safeStorageGet(AUTH_TOKEN_KEY) ||
    safeSessionStorageGet(AUTH_TOKEN_KEY) ||
    safeStorageGet(LEGACY_AUTH_TOKEN_KEY) ||
    safeSessionStorageGet(LEGACY_AUTH_TOKEN_KEY)
  );
}

function hasServerSessionToken(): boolean {
  return Boolean(currentServerSessionToken());
}

function clearServerSessionToken() {
  if (typeof window === "undefined") return;
  safeStorageRemove(AUTH_TOKEN_KEY);
  safeStorageRemove(LEGACY_AUTH_TOKEN_KEY);
  safeSessionStorageRemove(AUTH_TOKEN_KEY);
  safeSessionStorageRemove(LEGACY_AUTH_TOKEN_KEY);
  clearServerSessionUser();
}

function storeServerSessionUser(user: User) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(user);
  if (safeStorageSet(SERVER_AUTH_USER_KEY, payload)) {
    safeSessionStorageRemove(SERVER_AUTH_USER_KEY);
    return;
  }
  safeSessionStorageSet(SERVER_AUTH_USER_KEY, payload);
}

function loadServerSessionUser(): User | null {
  if (typeof window === "undefined") return null;
  if (!currentServerSessionToken()) {
    clearServerSessionUser();
    return null;
  }
  const raw = safeStorageGet(SERVER_AUTH_USER_KEY) || safeSessionStorageGet(SERVER_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (isPersistableServerUser(parsed)) {
      return {
        id: parsed.id,
        tenantId: parsed.role === "master_admin" ? null : typeof parsed.tenantId === "string" ? parsed.tenantId : null,
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
  safeStorageRemove(SERVER_AUTH_USER_KEY);
  safeSessionStorageRemove(SERVER_AUTH_USER_KEY);
}

function migrateLegacyAuthStorage() {
  if (typeof window === "undefined") return;
  const legacyToken = safeStorageGet(LEGACY_AUTH_TOKEN_KEY) || safeSessionStorageGet(LEGACY_AUTH_TOKEN_KEY);
  if (!currentServerSessionToken() && legacyToken) {
    storeServerSessionToken(legacyToken);
  }
  safeStorageRemove(LEGACY_AUTH_TOKEN_KEY);
  safeSessionStorageRemove(LEGACY_AUTH_TOKEN_KEY);
  safeStorageRemove(STORAGE_KEY);
}

function isTransientSessionFailure(reason: string | undefined): boolean {
  return reason === "server_unreachable" || reason === "rate_limited";
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
  ) {
    return reason;
  }
  if (status === 403) return "account_disabled";
  if (status === 409) return "password_not_set";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "server_unreachable";
  return "invalid_credentials";
}

export function authFailureMessage(reason: AuthFailReason, portal?: "customer" | "staff" | "master"): string {
  if (reason === "account_disabled") return "This account has been disabled. Contact your administrator.";
  if (reason === "agency_inactive") return "Your agency's subscription is inactive.";
  if (reason === "password_not_set") return "Your account doesn't have a password yet. Use Forgot password to set one.";
  if (reason === "rate_limited") return "Too many attempts. Try again in a minute.";
  if (reason === "server_unreachable") return "Can't reach the sign-in server. Check your connection and try again.";
  if (reason === "wrong_portal") {
    if (portal === "staff") return "This login belongs to a different portal. Use the customer or master sign-in.";
    if (portal === "customer") return "This login belongs to a different portal. Use the agency staff or master sign-in.";
    if (portal === "master") return "This login belongs to a different portal. Use the customer or agency staff sign-in.";
    return "This login belongs to a different portal.";
  }
  return "Email or password is incorrect.";
}

function loadCachedBrowserUser(): User | null {
  if (typeof window === "undefined") return null;
  const id = safeStorageGet(STORAGE_KEY);
  if (id) {
    const localUser = api.users.get(id);
    if (localUser && !accessBlockForUser(localUser)) return localUser;
    const serverUser = loadServerSessionUser();
    if (serverUser && serverUser.id === id && !accessBlockForUser(serverUser, { trustServerSession: true })) return serverUser;
    safeStorageRemove(STORAGE_KEY);
    clearServerSessionUser();
    return null;
  }

  const serverUser = loadServerSessionUser();
  if (serverUser && !accessBlockForUser(serverUser, { trustServerSession: true })) return serverUser;
  clearServerSessionUser();
  return null;
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

async function readAuthRouteJson(response: Response): Promise<AuthRouteJson | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  return (await response.json().catch(() => null)) as AuthRouteJson | null;
}

async function fetchAuthRoute(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers ?? {});
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  try {
    return await fetch(url, { ...init, headers, cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Auth should never crash because browser storage is unavailable or full.
  }
}

function safeSessionStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeSessionStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Auth should never crash because browser storage is unavailable or full.
  }
}

function isMissingAuthRoute(response: Response, json: AuthRouteJson | null): boolean {
  if (response.status === 405) return !json?.error && !json?.reason;
  if (response.status !== 404) return false;
  return !json?.error && !json?.reason;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
