import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { isStaffRole } from "@/lib/roles";

// Staff-only gate that forces a first-time profile completion. If the
// signed-in user is an agent or manager and `profileCompleted` is not yet
// true, every protected route bounces them to `/employee/welcome` until
// they fill the form.
export function RequireProfile({
  children,
  completePath = "/employee/welcome",
}: {
  children: React.ReactNode;
  completePath?: string;
}) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <>{children}</>;
  const isStaff = isStaffRole(user.role);
  const needsCompletion = isStaff && user.profileCompleted === false;
  if (needsCompletion && location.pathname !== completePath) {
    return <Navigate to={completePath} replace />;
  }
  return <>{children}</>;
}
