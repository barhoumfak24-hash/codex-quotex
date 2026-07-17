import { ArrowLeft, Briefcase, FileText, Home, LifeBuoy, MessageCircle, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { PortalShell } from "./PortalShell";
import { useTenant } from "@/lib/tenant";

export function CustomerLayout() {
  const { agency } = useTenant();
  return (
    <PortalShell
      subtitle={agency ? `Client portal · ${agency.name}` : "Client portal"}
      nav={[
        {
          to: "/customer",
          appTo: "/",
          appLabel: "Back to app home",
          appDescription: "Return to the Quotex app home.",
          label: "Overview",
          icon: <Home />,
          appIcon: <ArrowLeft />,
          end: true,
        },
        { to: "/customer/assets", label: "My assets", icon: <Briefcase /> },
        { to: "/customer/policies", label: "Policies", icon: <ShieldCheck /> },
        { to: "/customer/documents", label: "Documents", icon: <FileText /> },
        { to: "/customer/claims", label: "Claims", icon: <LifeBuoy /> },
        { to: "/customer/messages", label: "Messages", icon: <MessageCircle /> },
        { to: "/customer/quote/new", label: "Get a quote", icon: <Sparkles /> },
        { to: "/customer/settings", label: "Profile", icon: <Settings /> },
      ]}
    />
  );
}
