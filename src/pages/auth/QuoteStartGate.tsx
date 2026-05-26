import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// "Get a Private Quote" entry point. Customers go straight to the quote flow.
// Anyone else (signed-out, or signed in as an agent/master) is bounced to the
// customer login page; we encode the original destination in router state so
// CustomerLoginPage can redirect after a successful sign-in.
export function QuoteStartGate() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && user.role === "customer") {
    return <Navigate to="/customer/quote/new" replace />;
  }
  return (
    <Navigate
      to="/login"
      replace
      state={{ from: { pathname: "/customer/quote/new" } }}
    />
  );
}