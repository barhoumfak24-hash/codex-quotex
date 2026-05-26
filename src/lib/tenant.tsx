import { createContext, useContext, useMemo, useState } from "react";
import type { Agency } from "@/types";
import { api } from "./api";
import { useAuth } from "./auth";

interface TenantContextValue {
  agency: Agency | null;
  setAgencyId: (id: string | null) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

// The master admin's chosen agency (or a logged-out visitor's public
// context, e.g. for the signup / quote flow) persists across reloads.
// Agents, managers, and customers are always pinned to their own
// agency (derived from the signed-in user) — no cross-agency overlap.
const STORAGE_KEY = "quotex.tenantId.v1";
const PUBLIC_DEFAULT = "agency_palmcoast";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Used only for the master admin's browsing selection and the public
  // (logged-out) marketing/quote context.
  const [floatingAgencyId, _setFloatingAgencyId] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY) ?? PUBLIC_DEFAULT
      : PUBLIC_DEFAULT
  );

  // Resolve the active agency:
  //   • signed-in agent / manager / customer → their OWN tenant, always
  //   • master admin → the agency they've selected to browse
  //   • logged out → the public default (signup / quote flow)
  const agencyId =
    user == null
      ? floatingAgencyId
      : user.role === "master_admin"
      ? floatingAgencyId
      : user.tenantId ?? null;

  const agency = useMemo(
    () => (agencyId ? api.agencies.get(agencyId) ?? null : null),
    [agencyId]
  );

  // Switching tenants is allowed only when there's no signed-in staff /
  // customer to pin to (master admin, or a logged-out visitor). For
  // agents / managers / customers the call is ignored so they can never
  // end up viewing another agency.
  const setAgencyId = (id: string | null) => {
    if (user && user.role !== "master_admin") return;
    _setFloatingAgencyId(id);
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <TenantContext.Provider value={{ agency, setAgencyId }}>{children}</TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be inside TenantProvider");
  return ctx;
}