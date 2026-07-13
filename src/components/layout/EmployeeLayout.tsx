import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  BarChart3,
  Building2,
  CalendarDays,
  CalendarClock,
  Calculator,
  CheckSquare,
  FileSearch,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  LifeBuoy,
  MessageCircle,
  Megaphone,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserSearch,
  Users,
} from "lucide-react";
import { PortalShell } from "./PortalShell";
import { PortalAssistant } from "@/components/help/PortalAssistant";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import {
  isRoutingManagerRole,
  isStaffRole,
  type StaffRole,
} from "@/lib/roles";
import { isRoutingAssignmentTask } from "@/lib/taskFilters";

// Per-route alert counts shown as red badges next to each nav item.
// Computed cheaply from the local DB on every render (the localStorage
// store is in-memory after first load) — no caching needed.
export function computeEmployeeBadges(
  tenantId: string,
  viewer: { id: string; role: StaffRole } | undefined
) {
  const customers = api.customers.list(tenantId);
  const prospects = api.prospects.listByTenant(tenantId);
  const policies = api.policies.listByTenant(tenantId);
  const claims = api.claims.listByTenant(tenantId);
  const renewals = api.renewals.listByTenant(tenantId);
  const docs = api.documents.listByTenant(tenantId);
  const messages = api.marketing.listMessages(tenantId);
  const tasks = api.tasks.listByTenant(tenantId);

  // Notification badges use ownership scope: managers can still
  // access broader tenant views, but they should not receive alerts
  // for clients assigned to another staff member.
  const visibleCustomerIds = new Set(
    viewer ? api.customers.listOwned(tenantId, viewer).map((c) => c.id) : []
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
    viewer && isRoutingManagerRole(viewer.role)
      ? customers.filter(
          (c) =>
            !c.assignedAgentId &&
            !(c.additionalAgentIds ?? []).length &&
            !c.assignedCsrId &&
            !(c.additionalCsrIds ?? []).length
        ).length
      : 0;
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
        const notifs = api.aiNotifications
          .listUnacked(tenantId)
          .filter((n) => n.kind !== "goal_request" && n.kind !== "inbound_notice" && n.kind !== "quote_ready");
        const tasks = api.tasks.listOpen(tenantId);
        const assignedToViewer = (r: {
          assignedToId?: string;
          additionalAssignedToIds?: string[];
        }) =>
          (r.assignedToId ?? "") === viewer.id ||
          (r.additionalAssignedToIds ?? []).includes(viewer.id);
        const ownItems = [
          ...notifs,
          ...tasks.filter(
            (t) =>
              !(
                isRoutingManagerRole(viewer.role) &&
                isRoutingAssignmentTask(t)
              )
          ),
        ].filter(assignedToViewer).length;
        const managerBroadcasts =
          isRoutingManagerRole(viewer.role)
            ? notifs.filter(
                (n) => n.kind === "override_request" && !n.assignedToId
              ).length
            : 0;
        const managerRoutingWork =
          isRoutingManagerRole(viewer.role)
            ? (() => {
                const unassignedProspectIds = new Set(
                  prospects.filter((p) => !p.assignedAgentId).map((p) => p.id)
                );
                const unassignedClientIds = new Set(
                  customers.filter((c) => !c.assignedAgentId).map((c) => c.id)
                );
                const routeRequests = api.tasks
                  .listOpen(tenantId)
                  .filter((t) => t.awaitingManagerAssignment)
                  .filter(
                    (t) =>
                      !(t.prospectId && unassignedProspectIds.has(t.prospectId)) &&
                      !(t.customerId && unassignedClientIds.has(t.customerId))
                  ).length;
                return unassignedProspectIds.size + unassignedClientIds.size + routeRequests;
              })()
            : 0;
        return ownItems + managerBroadcasts + managerRoutingWork;
      })()
    : 0;

  const messagesCount = viewer
    ? api.internalMessages.unreadCountForUser(tenantId, viewer.id)
    : 0;
  const calendarCount = viewer
    ? (() => {
        const today = localDateKey(new Date().toISOString());
        const reminderCount = api.reminders
          .listForUser(tenantId, viewer.id)
          .filter((reminder) => localDateKey(reminder.remindAt) === today).length;
        const eventCount = api.calendarEvents
          .listForUser(tenantId, viewer.id)
          .filter((event) => localDateKey(event.startsAt) === today).length;
        const meetingRequestCount = api.calendarEvents.pendingRequestCount(tenantId, viewer.id);
        const dueTaskCount = api.tasks.listOpen(tenantId).filter(
          (task) =>
            !!task.dueAt &&
            localDateKey(task.dueAt) === today &&
            ((task.assignedToId ?? "") === viewer.id ||
              (task.additionalAssignedToIds ?? []).includes(viewer.id))
        ).length;
        return reminderCount + eventCount + dueTaskCount + meetingRequestCount;
      })()
    : 0;
  const accountingCount = viewer
    ? viewer.role === "manager"
      ? api.timesheets.pendingManagerCount(tenantId)
      : api.timesheets.needsSubmissionToday(tenantId, viewer.id)
        ? 1
        : 0
    : 0;
  const hrCount = viewer?.role === "manager" ? api.hr.newCount(tenantId) : 0;

  return {
    prospects: prospectsCount,
    clients: clientsCount,
    policies: policiesCount,
    renewals: renewalsCount,
    documents: documentsCount,
    marketing: marketingCount,
    tasks: tasksCount,
    messages: messagesCount,
    calendar: calendarCount,
    accounting: accountingCount,
    hr: hrCount,
  };
}

function localDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
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
  useEffect(() => {
    if (!agency?.id) return;
    api.assets.backfillLabels(agency.id);
  }, [agency?.id]);

  const role = isStaffRole(user?.role) ? user.role : undefined;
  const viewer = role && user ? { id: user.id, role } : undefined;
  const badges =
    agency
      ? (() => {
          try {
            return computeEmployeeBadges(agency.id, viewer);
          } catch (err) {
            console.error("[quotex] Employee badge calculation failed", err);
            return {
              prospects: 0,
              clients: 0,
              policies: 0,
              renewals: 0,
              documents: 0,
              marketing: 0,
              tasks: 0,
              messages: 0,
              calendar: 0,
              accounting: 0,
              hr: 0,
            };
          }
        })()
      : {
        prospects: 0,
        clients: 0,
        policies: 0,
        renewals: 0,
        documents: 0,
        marketing: 0,
        tasks: 0,
        messages: 0,
        calendar: 0,
        accounting: 0,
        hr: 0,
      };

  const rawNavItems: Array<{
    to: string;
    label: string;
    icon: ReactNode;
    badge?: number;
    end?: boolean;
    allowedRoles?: StaffRole[];
  }> = [
    // Per spec: the Activity Center is the single source of
    // truth for alerts. Other categories no longer carry red
    // badges in the rail; their work shows up as activities.
    { to: "/employee", label: "Dashboard", icon: <LayoutDashboard />, end: true },
    {
      to: "/employee/tasks",
      label: "Activity Center",
      icon: <CheckSquare />,
      badge: badges.tasks,
      allowedRoles: ["agent", "manager", "csr"],
    },
    { to: "/employee/calendar", label: "Calendar", icon: <CalendarDays /> },
    { to: "/employee/messages", label: "Messages", icon: <MessageCircle /> },
    {
      to: "/employee/prospects",
      label: "Prospects",
      icon: <UserSearch />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/clients",
      label: "Clients",
      icon: <Users />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/policies",
      label: "Policies",
      icon: <ShieldCheck />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/claims",
      label: "Claims",
      icon: <LifeBuoy />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/billing",
      label: "Billing",
      icon: <ReceiptText />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/renewals",
      label: "Renewals",
      icon: <CalendarClock />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/documents",
      label: "Document review",
      icon: <FileSearch />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/marketing",
      label: "AI marketing",
      icon: <Megaphone />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/carriers",
      label: "Carrier library",
      icon: <Building2 />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/analytics",
      label: "Analytics",
      icon: <BarChart3 />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    {
      to: "/employee/accounting",
      label: "Accounting",
      icon: <Calculator />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    { to: "/employee/hr", label: "HR", icon: <HeartHandshake /> },
    {
      to: "/employee/archive",
      label: "Archive",
      icon: <Archive />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    { to: "/employee/training", label: "Training videos", icon: <GraduationCap /> },
    {
      to: "/employee/settings",
      label: "Agency setup",
      icon: <SlidersHorizontal />,
      allowedRoles: ["agent", "manager", "csr"],
    },
    { to: "/employee/account-settings", label: "Account settings", icon: <UserCog /> },
  ];
  const navItems = rawNavItems.filter(
    (item) => !role || !item.allowedRoles || item.allowedRoles.includes(role)
  );

  return (
    <>
    <PortalShell
      showAccountFooter={false}
      compactSidebar
      subtitle={agency ? `Agency portal · ${agency.name}` : "Agency portal"}
      nav={navItems}
    />
    <ErrorBoundary compact>
      <PortalAssistant />
    </ErrorBoundary>
    </>
  );
}
