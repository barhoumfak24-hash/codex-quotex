import {
  Activity,
  BadgeDollarSign,
  Building2,
  Database,
  LayoutDashboard,
  LayoutGrid,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { PortalShell } from "./PortalShell";

export function MasterLayout() {
  return (
    <PortalShell
      subtitle="Master portal · Founder"
      nav={[
        { to: "/master", label: "Dashboard", icon: <LayoutDashboard />, end: true },
        { to: "/master/agencies", label: "Agencies", icon: <Building2 /> },
        { to: "/master/carriers", label: "Carrier library", icon: <ShieldCheck /> },
        { to: "/master/categories", label: "Insurance categories", icon: <LayoutGrid /> },
        { to: "/master/billing", label: "Billing", icon: <BadgeDollarSign /> },
        { to: "/master/users", label: "Users", icon: <Users /> },
        { to: "/master/ai-rules", label: "AI rules", icon: <Sparkles /> },
        { to: "/master/analytics", label: "Usage analytics", icon: <Activity /> },
        { to: "/master/data", label: "Data tools", icon: <Database /> },
        { to: "/master/settings", label: "Platform settings", icon: <Settings2 /> },
      ]}
    />
  );
}