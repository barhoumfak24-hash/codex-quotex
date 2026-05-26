import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Role, User } from "@/types";
import { api } from "./api";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // Signs in as a seeded demo user of the requested role.
  signInDemo: (role: Role, tenantId?: string | null) => User;
  // Backwards-compat alias for email-only sign in (customer flow).
  signInWithEmail: (email: string) => User | null;
  // Customer sign-in: email + password. If the user has no password
  // on file (legacy seed accounts), falls back to email-only auth.
  signInCustomer: (email: string, password: string) => User | null;
  // Trigger a customer password reset. Generates a new temporary
  // password and returns it so the demo can show the new value;
  // production fires an actual email with a reset token.
  resetCustomerPassword: (
    email: string
  ) => { user: User; tempPassword: string } | null;
  // Update the signed-in customer's password (account settings UI).
  changeMyPassword: (
    currentPassword: string,
    newPassword: string
  ) => { ok: true } | { ok: false; reason: string };
  // Staff sign-in: accepts username or email, verifies password if present.
  signInStaff: (identifier: string, password: string) => User | null;
  signInWithGoogle: () => User;
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
      if (u) {
        lastIdRef.current = u.id;
        setUser(u);
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
      lastIdRef.current = nextId;
      setUser(u ?? null);
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

  const signInDemo = useCallback(
    (role: Role, tenantId: string | null = null) => {
      const all = api.users.list();
      const existing = all.find(
        (u) => u.role === role && (tenantId == null || u.tenantId === tenantId)
      );
      const u =
        existing ??
        api.users.create({
          role,
          tenantId,
          email: `${role}@demo.example`,
          name: `Demo ${role}`,
        });
      persist(u);
      return u;
    },
    [persist]
  );

  const signInWithEmail = useCallback(
    (email: string) => {
      const u = api.users.byEmail(email);
      if (!u) return null;
      persist(u);
      return u;
    },
    [persist]
  );

  const signInCustomer = useCallback(
    (email: string, password: string) => {
      const u = api.users.byEmail(email.trim());
      if (!u || u.role !== "customer") return null;
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      persist(u);
      return u;
    },
    [persist]
  );

  const resetCustomerPassword = useCallback(
    (email: string) => {
      const u = api.users.byEmail(email.trim());
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
      if (!u) return null;
      // If the account has a generated password on file, it must match.
      // Seed accounts that pre-date the credential system fall back to
      // identifier-only sign-in (acceptable for the demo).
      if (u.generatedPassword && u.generatedPassword !== password) return null;
      persist(u);
      return u;
    },
    [persist]
  );

  const signInWithGoogle = useCallback(() => {
    const demo =
      api.users.byEmail("customer@demo.example") ??
      api.users.create({
        role: "customer",
        tenantId: "agency_palmcoast",
        email: "customer@demo.example",
        name: "Demo Customer",
      });
    persist(demo);
    return demo;
  }, [persist]);

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
      signInDemo,
      signInWithEmail,
      signInCustomer,
      resetCustomerPassword,
      changeMyPassword,
      signInStaff,
      signInWithGoogle,
      signOut,
      refreshUser,
      hasRole,
    }),
    [
      user,
      loading,
      signInDemo,
      signInWithEmail,
      signInCustomer,
      resetCustomerPassword,
      changeMyPassword,
      signInStaff,
      signInWithGoogle,
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