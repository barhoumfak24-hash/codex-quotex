import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
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
  if (loading) return null;
  if (!user) return <Navigate to={redirectTo} state={{ from: location }} replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}