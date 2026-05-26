import { useMemo } from "react";
import { useAuth } from "./auth";
import { api } from "./api";
import { useTenant } from "./tenant";

// Returns the CustomerProfile bound to the signed-in user, creating one
// in the active tenant if missing. Used by every customer portal page.
export function useCustomer() {
  const { user } = useAuth();
  const { agency } = useTenant();
  return useMemo(() => {
    if (!user || user.role !== "customer") return null;
    let profile = api.customers.byUserId(user.id);
    if (!profile && agency) {
      profile = api.customers.create({
        tenantId: agency.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        marketingOptInEmail: true,
        marketingOptInSms: false,
      });
    }
    return profile ?? null;
  }, [user, agency]);
}