import { Link, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function EmployeeBackButton() {
  const location = useLocation();
  const state = location.state as { fromDashboard?: boolean } | null;

  if (!state?.fromDashboard) return null;

  return (
    <Link to="/employee" className="btn-ghost -ml-2 text-sm">
      <ArrowLeft className="h-4 w-4" /> Back to dashboard
    </Link>
  );
}
