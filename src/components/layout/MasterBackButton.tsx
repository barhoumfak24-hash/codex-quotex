import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function MasterBackButton() {
  return (
    <Link to="/master" className="btn-ghost -ml-2 text-sm">
      <ArrowLeft className="h-4 w-4" /> Back to overview
    </Link>
  );
}
