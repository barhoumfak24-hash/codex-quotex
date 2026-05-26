import { Briefcase, FileText, Home, LifeBuoy, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { PortalShell } from "./PortalShell";
import { useTenant } from "@/lib/tenant";

export function CustomerLayout() {
  const { agency } = useTenant();
  return (
    <PortalShell
      subtitle={agency ? `Client portal · ${agency.name}` : "Client portal"}
      nav={[
        { to: "/customer", label: "Overview", icon: <Home />, end: true },
        { to: "/customer/assets", label: "My assets", icon: <Briefcase /> },
        { to: "/customer/policies", label: "Policies", icon: <ShieldCheck /> },
        { to: "/customer/documents", label: "Documents", icon: <FileText /> },
        { to: "/customer/claims", label: "Claims", icon: <LifeBuoy /> },
        { to: "/customer/quote/new", label: "Get a quote", icon: <Sparkles /> },
        { to: "/customer/settings", label: "Profile", icon: <Settings /> },
      ]}
    />
  );
}