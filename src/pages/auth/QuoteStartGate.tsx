import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { toSurfaceRoute } from "@/lib/appSurface";

// "Get a Private Quote" entry point. Customers go straight to the quote flow.
// Anyone else (signed-out, or signed in as an agent/master) is bounced to the
// customer login page; we encode the original destination in router state so
// CustomerLoginPage can redirect after a successful sign-in.
export function QuoteStartGate() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const route = (path: string) => toSurfaceRoute(path, location.pathname);
  if (loading) return null;
  if (user && user.role === "customer") {
    return <Navigate to={route("/customer/quote/new")} replace />;
  }
  return (
    <Navigate
      to={route("/login")}
      replace
      state={{ from: { pathname: route("/customer/quote/new") } }}
    />
  );
}
