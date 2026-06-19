import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { toSurfaceRoute } from "@/lib/appSurface";
import type { Role } from "@/types";

export function RequireRole({
  roles,
  redirectTo,
  children,
}: {
  roles: Role[];
  redirectTo: string;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50 text-ink-900 flex items-center justify-center p-6">
        <div className="rounded-lg border border-ink-100 bg-white px-5 py-4 shadow-soft">
          <p className="font-semibold">Checking your session</p>
          <p className="text-sm text-ink-500">Loading your portal access...</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to={redirectTo} state={{ from: location }} replace />;
  if (!roles.includes(user.role)) return <Navigate to={toSurfaceRoute("/", location.pathname)} replace />;
  return <>{children}</>;
}
