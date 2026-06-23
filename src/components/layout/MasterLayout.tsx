import {
  Activity,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  Database,
  FileCheck2,
  GraduationCap,
  History,
  LayoutDashboard,
  LayoutGrid,
  MonitorPlay,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { PortalShell } from "./PortalShell";

export function MasterLayout() {
  return (
    <PortalShell
      subtitle="Master portal · Founder"
      nav={[
        { to: "/master", label: "Dashboard", icon: <LayoutDashboard />, end: true },
        { to: "/master/leads", label: "Leads", icon: <UserPlus /> },
        { to: "/master/demos", label: "Demos", icon: <MonitorPlay /> },
        { to: "/master/agencies", label: "Agencies", icon: <Building2 /> },
        { to: "/master/carriers", label: "Carrier library", icon: <ShieldCheck /> },
        { to: "/master/categories", label: "Insurance categories", icon: <LayoutGrid /> },
        { to: "/master/billing", label: "Billing", icon: <BadgeDollarSign /> },
        { to: "/master/renewals", label: "Renewals", icon: <CalendarClock /> },
        { to: "/master/activities", label: "Activities", icon: <History /> },
        { to: "/master/build-plan", label: "Build A Plan", icon: <ReceiptText /> },
        { to: "/master/e-signed-documents", label: "E-signed documents", icon: <FileCheck2 /> },
        { to: "/master/users", label: "Users", icon: <Users /> },
        { to: "/master/training", label: "Training videos", icon: <GraduationCap /> },
        { to: "/master/ai-rules", label: "AI rules", icon: <Sparkles /> },
        { to: "/master/analytics", label: "Usage analytics", icon: <Activity /> },
        { to: "/master/data", label: "Data tools", icon: <Database /> },
        { to: "/master/settings", label: "Platform settings", icon: <Settings2 /> },
      ]}
    />
  );
}
