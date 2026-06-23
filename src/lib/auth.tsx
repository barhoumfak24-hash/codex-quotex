import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Role, User } from "@/types";
import { api } from "./api";
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
  signInStaff: (identifier: string, password: string) => User | null;
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
  }) =>
    | { ok: true; user: User; agencyId: string }
    | { ok: false; reason: ReturnType<typeof api.users.registerStaff> extends { ok: false; reason: infer R } ? R : string };
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
      } else if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
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
    else window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeToDbChanges(() => {
      const fresh = api.users.get(user.id) ?? null;
      if (!fresh || accessBlockForUser(fresh)) {
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
    (identifier: string, password: string) => {
      const u = api.users.byIdentifier(identifier.trim());
      if (!u || !isStaffRole(u.role)) return null;
      const agency = u.tenantId ? api.agencies.get(u.tenantId) : undefined;
      if (!agency || !agency.active) return null;
      if (accessBlockForUser(u)) return null;
      // If the account has a generated password on file, it must match.
      // Legacy local fixture accounts only fall back to identifier-only
      // sign-in when an explicit local env flag is enabled.
      if (!u.generatedPassword && !allowsPasswordlessLocalFallback()) return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const signInMaster = useCallback(
    (email: string, password: string) => {
      const normalized = email.trim().toLowerCase();
      const u = api
        .users
        .list(null)
        .find((row) => row.role === "master_admin" && row.email.toLowerCase() === normalized);
      if (!u || !isLockingMasterAccount(u)) return null;
      if (!u.generatedPassword && !allowsPasswordlessLocalFallback()) return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      return persistIfAllowed(u);
    },
    [persistIfAllowed]
  );

  const createMasterAccount = useCallback(
    (input: { name: string; email: string; password: string }) => {
      if (api.users.list(null).some(isLockingMasterAccount)) {
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
        persistIfAllowed(user);
        return { ok: true as const, user };
      } catch {
        return { ok: false as const, reason: "exists" as const };
      }
    },
    [persistIfAllowed]
  );

  const registerStaff = useCallback(
    (input: {
      agencyCode: string;
      branchId?: string;
      role: StaffRole;
      firstName: string;
      lastName: string;
      phone: string;
      businessEmail: string;
      password: string;
    }) => {
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
    setUser(fresh);
    lastIdRef.current = fresh?.id ?? null;
    return fresh;
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
