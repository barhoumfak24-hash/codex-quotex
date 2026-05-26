import { useEffect, useState } from "react";
import {
  Archive,
  BarChart3,
  Building2,
  CalendarClock,
  CheckSquare,
  FileSearch,
  LayoutDashboard,
  MessageCircle,
  Megaphone,
  ShieldCheck,
  Sparkles,
  UserSearch,
  Users,
} from "lucide-react";
import { PortalShell } from "./PortalShell";
import { PortalAssistant } from "@/components/help/PortalAssistant";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";

// Per-route alert counts shown as red badges next to each nav item.
// Computed cheaply from the local DB on every render (the localStorage
// store is in-memory after first load) — no caching needed.
function computeEmployeeBadges(
  tenantId: string,
  viewer: { id: string; role: "agent" | "manager" } | undefined
) {
  const customers = api.customers.list(tenantId);
  const prospects = api.prospects.listByTenant(tenantId);
  const policies = api.policies.listByTenant(tenantId);
  const claims = api.claims.listByTenant(tenantId);
  const renewals = api.renewals.listByTenant(tenantId);
  const docs = api.documents.listByTenant(tenantId);
  const messages = api.marketing.listMessages(tenantId);

  // For agents, every per-client signal is filtered to clients
  // assigned to them. Managers see all signals in the tenant.
  const visibleCustomerIds = new Set(
    viewer?.role === "manager"
      ? customers.map((c) => c.id)
      : customers.filter((c) => c.assignedAgentId === viewer?.id).map((c) => c.id)
  );
  const visibleFilter = <T extends { customerId?: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.customerId || visibleCustomerIds.has(r.customerId));

  // Prospects awaiting first agent touch.
  const prospectsCount = prospects.filter(
    (p) => p.status === "new" || p.status === "abandoned"
  ).length;

  // Clients badge is the SUM of every individual thing pending —
  // each open claim is one alert, each unresolved customer request
  // is one alert, each unassigned client is one alert. A single
  // customer can contribute multiple. The old behavior deduped by
  // customer which under-counted when a client had 3 messages in.
  // Agents only count items tied to their assigned clients.
  const openClaimsTotal = visibleFilter(claims.filter((c) => c.status !== "closed")).length;
  const pendingRequestsTotal = visibleFilter(
    api.communications.listPendingForTenant(tenantId)
  ).length;
  const unassignedTotal =
    viewer?.role === "manager" ? customers.filter((c) => !c.assignedAgentId).length : 0;
  const clientsCount = openClaimsTotal + pendingRequestsTotal + unassignedTotal;

  // Policies that need agent action (anything between submission and
  // bound / declined / final state). Agents only count their own.
  const policiesCount = visibleFilter(
    policies.filter((p) =>
      [
        "submitted_to_agent",
        "under_agent_review",
        "submitted_to_carrier",
        "carrier_reviewing",
        "documents_needed",
      ].includes(p.status)
    )
  ).length;

  // Renewals/documents/marketing badges only count records tied to
  // a customer the viewer is allowed to see. Records with no
  // customerId (tenant-scoped only) are included for everyone.
  const renewalRows = renewals.filter((r) => r.status === "upcoming");
  const renewalsCount = visibleFilter(
    renewalRows.map((r) => {
      const policy = policies.find((p) => p.id === r.policyId);
      return { ...r, customerId: policy?.customerId };
    })
  ).length;
  const documentsCount = visibleFilter(docs.filter((d) => d.status === "pending")).length;
  const marketingCount = visibleFilter(
    messages.filter((m) => m.deliveryStatus === "draft")
  ).length;
  // Tasks badge = items assigned TO the viewer. Managers don't
  // get alerted for tenant work that isn't theirs — they only
  // see their own queue here, with one carve-out: override
  // requests are tenant-wide manager broadcasts (any manager can
  // grant), so they always pump the manager badge even though
  // they have no assignedToId.
  const tasksCount = viewer
    ? (() => {
        const notifs = api.aiNotifications.listUnacked(tenantId);
        const tasks = api.tasks.listOpen(tenantId);
        const ownItems = [...notifs, ...tasks].filter(
          (r) => (r.assignedToId ?? "") === viewer.id
        ).length;
        const managerBroadcasts =
          viewer.role === "manager"
            ? notifs.filter(
                (n) => n.kind === "override_request" && !n.assignedToId
              ).length
            : 0;
        return ownItems + managerBroadcasts;
      })()
    : 0;

  const messagesCount = viewer
    ? api.internalMessages.unreadCountForUser(tenantId, viewer.id)
    : 0;

  return {
    prospects: prospectsCount,
    clients: clientsCount,
    policies: policiesCount,
    renewals: renewalsCount,
    documents: documentsCount,
    marketing: marketingCount,
    tasks: tasksCount,
    messages: messagesCount,
  };
}

export function EmployeeLayout() {
  const { agency } = useTenant();
  const { user } = useAuth();
  // Tick this whenever ANY db mutation happens so the sidebar
  // badges recompute in lockstep. Without this the layout only
  // re-renders on route changes, leaving stale counts behind after
  // an in-place archive / approval / status change on a child page.
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  const role = user?.role === "manager" || user?.role === "agent" ? user.role : undefined;
  const viewer = role && user ? { id: user.id, role } : undefined;
  const badges = agency
    ? computeEmployeeBadges(agency.id, viewer)
    : { prospects: 0, clients: 0, policies: 0, renewals: 0, documents: 0, marketing: 0, tasks: 0, messages: 0 };

  return (
    <>
    <PortalShell
      subtitle={agency ? `Agency portal · ${agency.name}` : "Agency portal"}
      nav={[
        // Per spec: the Activity Center is the single source of
        // truth for alerts. Other categories no longer carry red
        // badges in the rail; their work shows up as activities.
        { to: "/employee", label: "Dashboard", icon: <LayoutDashboard />, end: true },
        { to: "/employee/tasks", label: "Activity Center", icon: <CheckSquare />, badge: badges.tasks },
        { to: "/employee/messages", label: "Messages", icon: <MessageCircle />, badge: badges.messages },
        { to: "/employee/prospects", label: "Prospects", icon: <UserSearch /> },
        { to: "/employee/clients", label: "Clients", icon: <Users /> },
        { to: "/employee/policies", label: "Policies", icon: <ShieldCheck /> },
        { to: "/employee/renewals", label: "Renewals", icon: <CalendarClock /> },
        { to: "/employee/documents", label: "Document review", icon: <FileSearch /> },
        { to: "/employee/marketing", label: "AI marketing", icon: <Megaphone /> },
        { to: "/employee/carriers", label: "Carrier recommendations", icon: <Building2 /> },
        // Analytics is manager-only — agents don't get a tile in
        // their rail. The route guard mirrors this for direct nav.
        ...(role === "manager"
          ? [{ to: "/employee/analytics", label: "Analytics", icon: <BarChart3 /> }]
          : []),
        { to: "/employee/archive", label: "Archive", icon: <Archive /> },
        { to: "/employee/settings", label: "Agency settings", icon: <Sparkles /> },
      ]}
    />
    <PortalAssistant />
    </>
  );
}