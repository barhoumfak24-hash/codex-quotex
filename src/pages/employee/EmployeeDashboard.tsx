import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Bot, CalendarClock, Check, CheckSquare, ChevronDown, ChevronUp, FileSearch, MessageCircle, PartyPopper, Plus, RotateCcw, ShieldCheck, Target, UserSearch, Users, X } from "lucide-react";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { Modal } from "@/components/ui/Modal";
import {
  ClientList,
  PolicyList,
  ProspectList,
  RenewalList,
} from "@/components/analytics/MetricLists";
import { Confetti } from "@/components/ui/Confetti";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { isRoutingManagerRole } from "@/lib/roles";
import { sweepGoalAchievements } from "@/lib/performanceGoals";
import { isRoutingAssignmentTask } from "@/lib/taskFilters";
import { NewReminderModal } from "@/components/tasks/NewReminderModal";
import { PerformanceGoalsMiniCard } from "@/components/analytics/PerformanceGoalsMiniCard";
import { ImportanceIcon } from "@/components/tasks/ImportancePicker";
import type { Reminder } from "@/types";

function quoteWorkspaceDeepLink(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}quoteWorkspace=expanded`;
}

export function EmployeeDashboard() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [newReminderOpen, setNewReminderOpen] = useState(false);
  // Which dashboard stat tile is expanded into a quick-view list.
  const [quickView, setQuickView] = useState<
    null | "clients" | "policies" | "prospects" | "renewals" | "activities"
  >(null);
  const [showPastReminders, setShowPastReminders] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState<Reminder | null>(null);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  // Keep upcoming-renewal packets available, but do not send or
  // assign e-signature work just because a document was tagged as
  // requiring a signature. Sending stays behind explicit user actions.
  useEffect(() => {
    if (!agency || !user) return;
    const seeded = api.esign.seedRenewalPackets(agency.id, user.id);
    if (seeded.length > 0) refresh();
    // Intentionally only runs once per dashboard mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);
  // Detect any newly-achieved performance targets on mount and fire
  // the celebration notifications (runs for whoever loads the
  // dashboard first; idempotent thereafter).
  useEffect(() => {
    if (!agency || !user) return;
    const celebrated = sweepGoalAchievements(agency.id);
    const reassigned = api.routing.reconcileAccountWorkOwnership(agency.id);
    // AI triage of inbound messages opens activities only for owned work.
    const triaged = api.communications.sweepInboundForActivities(agency.id, user.id);
    if (celebrated.length > 0 || reassigned > 0 || triaged.length > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);
  const navigate = useNavigate();
  if (!user) return null;
  if (!agency) {
    return (
      <div className="p-6">
        <Card className="max-w-3xl">
          <CardHeader
            title="Agency workspace is loading"
            subtitle="Quotex is reconnecting your agency workspace. If this stays here, reload the portal or sign in again."
            action={
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => window.location.reload()}
              >
                <RotateCcw className="h-4 w-4" />
                Reload
              </button>
            }
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate("/employee/login", { replace: true })}
          >
            Sign in again
          </button>
        </Card>
      </div>
    );
  }
  const dashboardRouteState = { fromDashboard: true };
  const viewer = { id: user.id, role: user.role };
  const reminders = api.reminders.listForUser(agency.id, user.id);
  const pastReminders = api.reminders.listDismissedForUser(agency.id, user.id);
  const unreadInternalThreads = api.internalMessages.unreadThreadsForUser(
    agency.id,
    user.id
  );
  const staff = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager");
  const prospects = api.prospects.listByTenant(agency.id);
  const policies = api.policies.listByTenant(agency.id);
  // Access control: agents only see their assigned book of clients
  // on the dashboard (stat tiles + recent activity).
  const customers = api.customers.listVisible(agency.id, viewer);
  const visibleIds = new Set(customers.map((c) => c.id));
  const notificationCustomerIds = new Set(
    api.customers.listOwned(agency.id, viewer).map((c) => c.id)
  );
  const visiblePolicies = policies.filter((p) => visibleIds.has(p.customerId));
  const renewals = api.renewals.listByTenant(agency.id);
  const messages = api.marketing
    .listMessages(agency.id)
    .filter((m) => !m.customerId || visibleIds.has(m.customerId));
  const hidesManagerAssignmentFollowUp = (t: import("@/types").Task) =>
    user.role === "manager" && isRoutingAssignmentTask(t);
  const assignedToViewer = (r: {
    assignedToId?: string;
    additionalAssignedToIds?: string[];
  }) =>
    (r.assignedToId ?? "") === viewer.id ||
    (r.additionalAssignedToIds ?? []).includes(viewer.id);
  const isManager = isRoutingManagerRole(user.role);
  const routingProspects = isManager
    ? api.prospects
        .listByTenant(agency.id)
        .filter(
          (prospect) =>
            !api.routing.hasAssignedOwner("prospect", prospect.id) &&
            !api.routing.isDismissed("prospect", prospect.id)
        )
    : [];
  const routingClients = isManager
    ? api.customers
        .list(agency.id)
        .filter(
          (customer) =>
            !api.routing.hasAssignedOwner("client", customer.id) &&
            !api.routing.isDismissed("client", customer.id)
        )
    : [];
  const routingProspectIds = new Set(routingProspects.map((p) => p.id));
  const routingClientIds = new Set(routingClients.map((c) => c.id));
  const routingTasks = isManager
    ? api.tasks
        .listOpen(agency.id)
        .filter((t) => t.awaitingManagerAssignment)
        .filter(
          (t) =>
            !(t.prospectId && routingProspectIds.has(t.prospectId)) &&
            !(t.customerId && routingClientIds.has(t.customerId))
        )
    : [];
  const routingCount = routingProspects.length + routingClients.length + routingTasks.length;
  const assignedActivityNotifications = api.aiNotifications
    .listUnacked(agency.id)
    .filter((n) => n.kind !== "goal_request" && n.kind !== "timesheet_due" && n.kind !== "inbound_notice" && n.kind !== "quote_ready")
    .filter(assignedToViewer);
  const assignedActivityTasks = api.tasks
    .listOpen(agency.id)
    .filter((t) => !hidesManagerAssignmentFollowUp(t))
    .filter((t) => !t.awaitingManagerAssignment)
    .filter(assignedToViewer);
  // Notifications are surfaced exclusively in the Activity Center.
  // The dashboard tile counts items assigned TO the viewer — managers
  // see their own queue here, not tenant-wide work.
  const activityCount =
    assignedActivityNotifications.length + assignedActivityTasks.length + routingCount;
  const activityItems = {
    notifications: assignedActivityNotifications,
    tasks: assignedActivityTasks,
    routingProspects,
    routingClients,
    routingTasks,
  };

  const newProspects = prospects.filter((p) => p.status === "new" || p.status === "abandoned");

  // Unacked goal-achievement celebrations. Managers see every one;
  // agents see company achievements + personal goals they're on.
  const goalAchievements = (() => {
    const all = api.aiNotifications
      .listUnacked(agency.id)
      .filter((n) => n.kind === "goal_achieved");
    if (user.role === "manager") return all;
    const activeGoals = api.agencies.get(agency.id)?.performanceGoals ?? [];
    const archived = api.agencies.get(agency.id)?.performanceGoalHistory ?? [];
    return all.filter((n) => {
      const g =
        activeGoals.find((x) => x.id === n.goalId) ??
        archived.find((x) => x.id === n.goalId);
      if (!g) return false;
      if (g.scope === "company") return true;
      return (g.assigneeIds ?? []).includes(user.id);
    });
  })();
  return (
    <div className="space-y-6">
      {goalAchievements.length > 0 && <Confetti />}
      {goalAchievements.map((n) => (
        <div
          key={n.id}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start justify-between gap-3 flex-wrap"
        >
          <div className="min-w-0 flex items-start gap-2">
            <PartyPopper className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-emerald-900">{n.title}</div>
              <div className="text-xs text-emerald-800/80 mt-0.5">{n.summary}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {user.role === "manager" && (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  api.aiNotifications.acknowledge(n.id, user.id);
                  navigate(
                    `/employee/analytics?celebrate=${encodeURIComponent(
                      n.goalId ?? ""
                    )}#performance-goals`,
                    { state: dashboardRouteState }
                  );
                }}
              >
                View
              </button>
            )}
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                api.aiNotifications.dismiss(n.id, user.id);
                refresh();
              }}
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      <div>
        <h1 className="font-display text-3xl">Agency dashboard</h1>
        <p className="text-ink-500 text-sm mt-1">{agency.name}</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label={viewer.role === "agent" ? "My clients" : "Active clients"}
          value={customers.length}
          icon={<Users className="h-5 w-5" />}
          hint="Quick view"
          onClick={() => setQuickView("clients")}
        />
        <StatCard
          label="Bound policies"
          value={visiblePolicies.filter((p) => p.status === "bound").length}
          icon={<ShieldCheck className="h-5 w-5" />}
          hint="Quick view"
          onClick={() => setQuickView("policies")}
        />
        <StatCard
          label="Open prospects"
          value={newProspects.length}
          icon={<UserSearch className="h-5 w-5" />}
          hint="Quick view"
          onClick={() => setQuickView("prospects")}
        />
        <StatCard
          label="Renewals upcoming"
          value={renewals.filter((r) => r.status === "upcoming").length}
          icon={<CalendarClock className="h-5 w-5" />}
          hint="Quick view"
          onClick={() => setQuickView("renewals")}
        />
        <StatCard
          label="Activity Center"
          value={activityCount}
          icon={<CheckSquare className="h-5 w-5" />}
          hint={activityCount > 0 ? "Quick view" : "All caught up"}
          onClick={() => setQuickView("activities")}
        />
      </div>

      <StatQuickView
        which={quickView}
        onClose={() => setQuickView(null)}
        customers={customers}
        policies={visiblePolicies}
        prospects={newProspects}
        renewals={renewals.filter((r) => r.status === "upcoming")}
        activityItems={activityItems}
        userId={user.id}
        onChanged={refresh}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-full min-h-[17rem]">
          <CardHeader
            title="My reminders"
            hideSubtitle
            subtitle="Private follow-ups — set against an Activity Center card or freeform. Soonest first."
            action={
              <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  className="btn-gold text-xs !px-2.5 whitespace-nowrap"
                  onClick={() => setNewReminderOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> New reminder
                </button>
              </div>
            }
          />
          {reminders.length === 0 ? (
            <div className="text-sm text-ink-400 flex items-start gap-2">
              <Bell className="h-4 w-4 text-ink-300 mt-0.5 shrink-0" />
              <span>
                No reminders set. Click <span className="font-medium">New reminder</span>{" "}
                above for a general follow-up, or use{" "}
                <span className="font-medium">Set personal reminder</span> on any activity.
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {reminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  onOpen={() => setSelectedReminder(r)}
                  onRemove={() => {
                    if (!window.confirm("Delete this reminder?")) return;
                    api.reminders.remove(r.id);
                    refresh();
                  }}
                />
              ))}
            </ul>
          )}

          {pastReminders.length > 0 && (
            <div className="mt-4 pt-3 border-t border-ink-100">
              <button
                type="button"
                className="text-xs text-ink-600 hover:text-ink-900 inline-flex items-center gap-1"
                onClick={() => setShowPastReminders((v) => !v)}
              >
                {showPastReminders ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {showPastReminders ? "Hide" : "Show"} past reminders ({pastReminders.length})
              </button>
              {showPastReminders && (
                <div
                  className={`mt-2 ${
                    pastReminders.length > 5 ? "max-h-[18rem] dropdown-scroll-y" : ""
                  }`}
                >
                  <ul className="divide-y divide-ink-100">
                    {pastReminders.map((r) => (
                      <PastReminderRow
                        key={r.id}
                        reminder={r}
                        onRestore={() => {
                          api.reminders.restore(r.id);
                          refresh();
                        }}
                        onRemove={() => {
                          api.reminders.remove(r.id);
                          refresh();
                        }}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="h-full min-h-[17rem]">
          <CardHeader
            title="Notifications"
            action={
              <Link
                to="/employee/tasks"
                state={dashboardRouteState}
                className="btn-outline text-xs inline-flex"
              >
                <Bell className="h-3 w-3" /> Activity Center
              </Link>
            }
          />
          <NotificationsList
            tenantId={agency.id}
            userId={user.id}
            visibleCustomerIds={notificationCustomerIds}
            onChanged={refresh}
          />
        </Card>

        <ActivityCenterDashboardCard
          className="h-full min-h-[17rem]"
          activityItems={activityItems}
          routingCount={routingCount}
          isManager={isManager}
          userId={user.id}
          onChanged={refresh}
        />

        <NewReminderModal
          open={newReminderOpen}
          onClose={() => setNewReminderOpen(false)}
          tenantId={agency.id}
          userId={user.id}
          onCreated={refresh}
        />

        <ReminderDetailModal
          reminder={selectedReminder}
          onClose={() => setSelectedReminder(null)}
          onDismiss={(id) => {
            api.reminders.dismiss(id);
            setSelectedReminder(null);
            refresh();
          }}
        />

        <PerformanceGoalsMiniCard
          agencyId={agency.id}
          isManager={user.role === "manager"}
          className="lg:col-span-3"
        />

        <ExpandableCard
          className="h-full min-h-[14rem]"
          title="Internal messages"
          subtitle="Unread DMs and group threads from your teammates."
          action={
            <Link
              to="/employee/messages"
              state={dashboardRouteState}
              className="btn-outline text-xs inline-flex"
            >
              <MessageCircle className="h-3 w-3" /> View
            </Link>
          }
        >
          {unreadInternalThreads.length === 0 ? (
            <div className="text-sm text-ink-400 flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-ink-300" /> All caught up.
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {unreadInternalThreads.slice(0, 5).map(({ thread, latest }) => {
                const fromName =
                  staff.find((s) => s.id === latest.fromUserId)?.name ?? "—";
                return (
                  <li key={thread.id} className="py-2">
                    <Link
                      to={`/employee/messages?thread=${thread.id}`}
                      state={dashboardRouteState}
                      className="block hover:text-gold-700"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">
                          {thread.topic ?? fromName}
                        </div>
                        <span className="text-[10px] text-ink-500 shrink-0">
                          {fmt.relative(latest.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs text-ink-500 mt-0.5 truncate">
                        {latest.body}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ExpandableCard>

        <Card className="h-full min-h-[14rem]">
          <CardHeader title="AI marketing activity" action={<Link className="btn-outline text-xs inline-flex" to="/employee/marketing" state={dashboardRouteState}>View</Link>} />
          {messages.length === 0 ? (
            <div className="text-sm text-ink-400">No outreach yet.</div>
          ) : (
            <ul className="space-y-3">
              {messages.slice(0, 5).map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-gold-600" />
                    <span className="font-medium truncate">{m.subject ?? "SMS message"}</span>
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    {fmt.relative(m.sentAt ?? m.createdAt)} · <Badge tone={m.deliveryStatus === "opened" ? "success" : "info"}>{fmt.titleCase(m.deliveryStatus)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="h-full min-h-[14rem]">
          <CardHeader title="Documents needing review" action={<Link to="/employee/documents" state={dashboardRouteState} className="btn-outline text-xs inline-flex">View all</Link>} />
          <DocsPending tenantId={agency.id} visibleIds={visibleIds} />
        </Card>
      </div>
    </div>
  );
}

// Quick-view modal for the dashboard stat tiles. Uses the same
// drill-down rows as the manager Analytics metric modals so each
// record expands to details + an Open/Profile/Policy link.
function StatQuickView({
  which,
  onClose,
  customers,
  policies,
  prospects,
  renewals,
  activityItems,
  userId,
  onChanged,
}: {
  which: null | "clients" | "policies" | "prospects" | "renewals" | "activities";
  onClose: () => void;
  customers: import("@/types").CustomerProfile[];
  policies: import("@/types").Policy[];
  prospects: import("@/types").Prospect[];
  renewals: import("@/types").Renewal[];
  activityItems: {
    notifications: ReturnType<typeof api.aiNotifications.listUnacked>;
    tasks: ReturnType<typeof api.tasks.listOpen>;
    routingProspects: import("@/types").Prospect[];
    routingClients: import("@/types").CustomerProfile[];
    routingTasks: ReturnType<typeof api.tasks.listOpen>;
  };
  userId: string;
  onChanged: () => void;
}) {
  if (!which) return null;

  const title =
    which === "clients"
      ? "Clients"
      : which === "policies"
      ? "Bound policies"
      : which === "prospects"
      ? "Open prospects"
      : which === "renewals"
      ? "Renewals upcoming"
      : "Activity Center";
  const category = {
    clients: { to: "/employee/clients", label: "Open clients" },
    policies: { to: "/employee/policies", label: "Open policies" },
    prospects: { to: "/employee/prospects", label: "Open prospects" },
    renewals: { to: "/employee/renewals", label: "Open renewals" },
    activities: { to: "/employee/tasks", label: "Open Activity Center" },
  }[which];

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          Quick snapshot from the dashboard. Open the full category for filters and actions.
        </p>
        <Link to={category.to} state={{ fromDashboard: true }} onClick={onClose} className="btn-gold text-xs shrink-0">
          {category.label}
        </Link>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {which === "clients" && <ClientList customers={customers} />}
        {which === "policies" && (
          <PolicyList policies={policies.filter((p) => p.status === "bound")} showPremium />
        )}
        {which === "prospects" && <ProspectList prospects={prospects} />}
        {which === "renewals" && <RenewalList renewals={renewals} />}
        {which === "activities" && (
          <ActivityQuickList {...activityItems} userId={userId} onChanged={onChanged} />
        )}
      </div>
    </Modal>
  );
}

function ActivityQuickList({
  notifications,
  tasks,
  routingProspects,
  routingClients,
  routingTasks,
  maxRows,
  userId,
  onChanged,
}: {
  notifications: ReturnType<typeof api.aiNotifications.listUnacked>;
  tasks: ReturnType<typeof api.tasks.listOpen>;
  routingProspects: import("@/types").Prospect[];
  routingClients: import("@/types").CustomerProfile[];
  routingTasks: ReturnType<typeof api.tasks.listOpen>;
  maxRows?: number;
  userId: string;
  onChanged: () => void;
}) {
  type ActivityRow = {
    id: string;
    at: string;
    title: string;
    detail: string;
    href: string;
    tone?: import("@/types").TaskSeverity;
    removeLabel: string;
    onRemove: () => void;
  };
  const rows: ActivityRow[] = [
    ...notifications.map((n) => ({
      id: `notification:${n.id}`,
      at: n.createdAt,
      title: n.title,
      detail: n.summary,
      href: n.taskId ? `/employee/tasks?focus=${n.taskId}` : "/employee/tasks",
      tone: n.severity,
      removeLabel: "Delete notification",
      onRemove: () => api.aiNotifications.remove(n.id),
    })),
    ...tasks.map((t) => ({
      id: `task:${t.id}`,
      at: t.createdAt,
      title: t.title,
      detail: t.aiSummary ?? t.description ?? fmt.titleCase(t.status ?? "open"),
      href: `/employee/tasks?focus=${t.id}`,
      tone: t.severity,
      removeLabel: "Delete activity",
      onRemove: () => api.tasks.remove(t.id),
    })),
    ...routingTasks.map((t) => ({
      id: `routing-task:${t.id}`,
      at: t.routeRequestedAt ?? t.createdAt,
      title:
        t.routeRequestMode === "reroute"
          ? `Reroute request: ${t.title.replace(/^Reroute .* requested:\s*/i, "")}`
          : t.routeRequestKind
          ? `Route request: ${t.title.replace(/^Route .* requested:\s*/i, "")}`
          : t.title,
      detail: t.description ?? "Manager routing confirmation needed.",
      href: `/employee/tasks?focus=${t.id}`,
      tone: (t.routeRequestMode === "reroute" ? "warning" : "info") as import("@/types").TaskSeverity,
      removeLabel: "Delete routing activity",
      onRemove: () => api.tasks.remove(t.id),
    })),
    ...routingProspects.map((p) => ({
      id: `routing-prospect:${p.id}`,
      at: p.lastActivityAt ?? p.createdAt,
      title: `Route prospect: ${p.name}`,
      detail: `${fmt.titleCase(p.lineOfBusiness ?? "personal")} lines - ${fmt.titleCase(
        String(p.assetType).replace(/_/g, " ")
      )}`,
      href: "/employee/tasks",
      tone: "info" as const,
      removeLabel: "Delete prospect routing entry",
      onRemove: () => api.routing.remove("prospect", p.id, userId),
    })),
    ...routingClients.map((c) => ({
      id: `routing-client:${c.id}`,
      at: c.createdAt,
      title: `Route client: ${c.businessName || c.name}`,
      detail: c.businessName ? `${c.name} - ${fmt.titleCase(c.lineOfBusiness ?? "commercial")} lines` : `${fmt.titleCase(c.lineOfBusiness ?? "personal")} lines`,
      href: "/employee/tasks",
      tone: "info" as const,
      removeLabel: "Delete client routing entry",
      onRemove: () => api.routing.remove("client", c.id, userId),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  if (rows.length === 0) {
    return <div className="text-sm text-ink-400 text-center py-6">All caught up.</div>;
  }

  return (
    <ul className="divide-y divide-ink-100">
      {rows.slice(0, maxRows).map((row) => (
        <li key={row.id} className="group py-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ImportanceIcon importance={row.tone ?? "info"} className="h-4 w-4 shrink-0" />
              <div className="text-sm font-medium text-ink-900 truncate">{row.title}</div>
            </div>
            <div className="mt-1 text-xs text-ink-500 line-clamp-2">{row.detail}</div>
            <div className="mt-1 text-[11px] text-ink-400">{fmt.relative(row.at)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link to={row.href} state={{ fromDashboard: true }} className="btn-outline text-[11px] shrink-0">
              Open
            </Link>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-400 opacity-100 transition hover:bg-alert-soft hover:text-alert sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
              aria-label={row.removeLabel}
              title={row.removeLabel}
              onClick={() => {
                if (!window.confirm("Permanently delete this item?")) return;
                row.onRemove();
                onChanged();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityCenterDashboardCard({
  activityItems,
  routingCount,
  isManager,
  userId,
  onChanged,
  className = "",
}: {
  activityItems: {
    notifications: ReturnType<typeof api.aiNotifications.listUnacked>;
    tasks: ReturnType<typeof api.tasks.listOpen>;
    routingProspects: import("@/types").Prospect[];
    routingClients: import("@/types").CustomerProfile[];
    routingTasks: ReturnType<typeof api.tasks.listOpen>;
  };
  routingCount: number;
  isManager: boolean;
  userId: string;
  onChanged: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title="Activity Center"
        hideSubtitle
        action={
          <Link to="/employee/tasks" state={{ fromDashboard: true }} className="btn-outline text-xs inline-flex">
            Open
          </Link>
        }
      />
      <ActivityQuickList {...activityItems} maxRows={5} userId={userId} onChanged={onChanged} />
    </Card>
  );
}

function ReminderRow({
  reminder,
  onOpen,
  onRemove,
}: {
  reminder: Reminder;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const task = reminder.taskId
    ? api.tasks.listByTenant(reminder.tenantId).find((t) => t.id === reminder.taskId)
    : undefined;
  const label = reminder.title ?? task?.title ?? "(activity removed)";
  return (
    <li className="group flex items-center gap-1 py-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-ink-900 hover:text-gold-700"
        onClick={onOpen}
        title="Open reminder details"
      >
        <span className="shrink-0 text-ink-400">-</span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <button
        type="button"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 opacity-100 transition hover:bg-alert-soft hover:text-alert sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
        onClick={onRemove}
        aria-label={`Delete reminder: ${label}`}
        title="Delete reminder"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function ReminderDetailModal({
  reminder,
  onClose,
  onDismiss,
}: {
  reminder: Reminder | null;
  onClose: () => void;
  onDismiss: (id: string) => void;
}) {
  if (!reminder) return null;
  const task = reminder.taskId
    ? api.tasks.listByTenant(reminder.tenantId).find((t) => t.id === reminder.taskId)
    : undefined;
  const title = reminder.title ?? task?.title ?? "Reminder";
  const typeLabel = reminder.scope === "company" ? "Company reminder" : task ? "Activity reminder" : "Personal reminder";
  const explanation =
    reminder.note ??
    (task
      ? "This reminder is attached to an Activity Center card."
      : reminder.scope === "company"
        ? "This company reminder was sent to selected teammates."
        : "This is a personal follow-up reminder.");
  return (
    <Modal open onClose={onClose} title="Reminder" size="sm">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
          <p className="mt-2 text-sm text-ink-600">{explanation}</p>
        </div>
        <div className="rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2 text-sm text-ink-700 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-500">Type</span>
            <span className="font-medium text-right">{typeLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-500">Reminder time</span>
            <span className="font-medium text-right">{fmt.dateTime(reminder.remindAt)}</span>
          </div>
          {task && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-500">Activity</span>
              <Link
                to={`/employee/tasks?focus=${reminder.taskId}`}
                state={{ fromDashboard: true }}
                className="font-medium text-gold-700 hover:text-gold-800 text-right"
                onClick={onClose}
              >
                Open activity
              </Link>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={() => onDismiss(reminder.id)}>
            <Check className="h-4 w-4" /> Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PastReminderRow({
  reminder,
  onRestore,
  onRemove,
}: {
  reminder: Reminder;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const task = reminder.taskId
    ? api.tasks.listByTenant(reminder.tenantId).find((t) => t.id === reminder.taskId)
    : undefined;
  const label = reminder.title ?? task?.title ?? "(activity removed)";
  return (
    <li className="py-2 flex items-start gap-3 opacity-75">
      <ImportanceIcon
        importance={reminder.importance}
        className="h-4 w-4 mt-0.5 shrink-0 opacity-60"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate text-ink-700 line-through decoration-ink-300">
          {label}
        </div>
        {reminder.note && (
          <div className="text-xs text-ink-500 mt-0.5 italic truncate">
            "{reminder.note}"
          </div>
        )}
        <div className="text-[11px] text-ink-400 mt-0.5">
          Was due {fmt.dateTime(reminder.remindAt)}
        </div>
      </div>
      <button
        type="button"
        className="btn-outline text-xs"
        onClick={onRestore}
        title="Restore to active reminders"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Restore
      </button>
      <button
        type="button"
        className="btn-outline text-xs !px-2"
        onClick={onRemove}
        title="Delete permanently"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// Lightweight notifications feed: newly-assigned activities + unread
// inbound customer messages + unread internal DMs, sorted newest
// first. Each row deep-links to the right place — Activity Center
// for tasks, Messages page for the client / internal threads. Caps
// at 6 rows so the card stays readable.
function NotificationsList({
  tenantId,
  userId,
  visibleCustomerIds,
  onChanged,
}: {
  tenantId: string;
  userId: string;
  visibleCustomerIds: Set<string>;
  onChanged: () => void;
}) {
  // Tasks assigned to me in the last 7 days, not yet started.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentTasks = api.tasks
    .listOpen(tenantId)
    .filter(
      (t) =>
        (t.assignedToId === userId || (t.additionalAssignedToIds ?? []).includes(userId)) &&
        new Date(t.createdAt).getTime() >= sevenDaysAgo &&
        !t.startedAt
    );

  // Pending inbound customer messages for clients the user can see.
  const pendingComms = api.communications
    .listPendingForTenant(tenantId)
    .filter((c) => !c.customerId || visibleCustomerIds.has(c.customerId))
    .slice(0, 6);

  // Unread internal DMs (latest message per thread).
  const unreadInternal = api.internalMessages.unreadThreadsForUser(
    tenantId,
    userId
  );
  const goalRequests = api.aiNotifications
    .listUnacked(tenantId)
    .filter((n) => n.kind === "goal_request" && (n.assignedToId ?? "") === userId);
  const timesheetNotifications = api.aiNotifications
    .listUnacked(tenantId)
    .filter((n) => n.kind === "timesheet_due" && (n.assignedToId ?? "") === userId);
  const inboundNotices = api.aiNotifications
    .listUnacked(tenantId)
    .filter((n) => n.kind === "inbound_notice" && (n.assignedToId ?? "") === userId)
    .filter((n) => !n.customerId || visibleCustomerIds.has(n.customerId));
  const quoteReadyNotifications = api.aiNotifications
    .listUnacked(tenantId)
    .filter((n) => n.kind === "quote_ready" && (n.assignedToId ?? "") === userId)
    .filter((n) => !n.customerId || visibleCustomerIds.has(n.customerId));

  type NotificationRow = {
    key: string;
    at: string;
    kind: "task" | "client_msg" | "internal_msg" | "goal_request" | "timesheet_due" | "inbound_notice" | "quote_ready";
    icon: typeof Bell;
    iconClass: string;
    title: string;
    detail: string;
    href: string;
    // Internal-message rows carry the urgency the sender tagged on
    // the message so the dashboard recolors the icon yellow / amber
    // / red. Tasks + client messages leave this undefined.
    urgency?: import("@/types").TaskSeverity;
    onOpen?: () => void;
    onDismiss: () => void;
    dismissLabel: string;
  };
  // Look up staff once so each internal-message row can resolve a
  // sender name without re-querying for every row.
  const staff = api.users.list(tenantId);
  const rows: NotificationRow[] = [];
  recentTasks.forEach((t) => {
    const incompleteQuote = /stopped mid-quote/i.test(t.title);
    rows.push({
      key: `task:${t.id}`,
      at: t.createdAt,
      kind: "task",
      icon: CheckSquare,
      iconClass: "text-gold-600",
      title: incompleteQuote ? "Incomplete customer quote" : "New activity assigned",
      detail: t.title,
      href: `/employee/tasks?focus=${t.id}`,
      onDismiss: () => api.tasks.remove(t.id),
      dismissLabel: "Delete activity notification",
    });
  });
  pendingComms.forEach((c) => {
    const customer = c.customerId ? api.customers.get(c.customerId) : null;
    const name = customer?.name ?? "a contact";
    rows.push({
      key: `comm:${c.id}`,
      at: c.createdAt,
      kind: "client_msg",
      icon: MessageCircle,
      iconClass: "text-blue-500",
      title: `New message from ${name}`,
      detail: c.subject ?? c.body.slice(0, 80),
      href: c.customerId
        ? `/employee/messages?contact=client:${c.customerId}`
        : "/employee/messages",
      onDismiss: () => {
        api.communications.remove(c.id);
        api.aiNotifications
          .listUnacked(tenantId)
          .filter((notification) => notification.communicationId === c.id)
          .forEach((notification) => api.aiNotifications.remove(notification.id));
      },
      dismissLabel: "Delete message notification",
    });
  });
  unreadInternal.forEach(({ thread, latest }) => {
    const fromName =
      staff.find((s) => s.id === latest.fromUserId)?.name ?? "A teammate";
    rows.push({
      key: `internal:${thread.id}`,
      at: latest.createdAt,
      kind: "internal_msg",
      icon: MessageCircle,
      iconClass: "text-violet-500",
      title: `New internal message from ${fromName}`,
      detail: latest.body.slice(0, 80),
      href: `/employee/messages?thread=${thread.id}`,
      urgency: latest.urgency,
      onDismiss: () => api.internalMessages.remove(latest.id),
      dismissLabel: "Delete internal message notification",
    });
  });
  goalRequests.forEach((n) =>
    rows.push({
      key: `goal-request:${n.id}`,
      at: n.createdAt,
      kind: "goal_request",
      icon: Target,
      iconClass: "text-gold-700",
      title: n.title,
      detail: n.summary,
      href: `/employee/analytics?request=${encodeURIComponent(
        n.goalRequestId ?? ""
      )}#performance-goals`,
      urgency: "info",
      onOpen: () => api.aiNotifications.dismiss(n.id, userId),
      onDismiss: () => api.aiNotifications.remove(n.id),
      dismissLabel: "Delete notification",
    })
  );
  timesheetNotifications.forEach((n) =>
    rows.push({
      key: `timesheet:${n.id}`,
      at: n.createdAt,
      kind: "timesheet_due",
      icon: CalendarClock,
      iconClass: "text-gold-700",
      title: n.title,
      detail: n.summary,
      href: "/employee/accounting",
      urgency: "info",
      onOpen: () => api.aiNotifications.dismiss(n.id, userId),
      onDismiss: () => api.aiNotifications.remove(n.id),
      dismissLabel: "Delete notification",
    })
  );
  inboundNotices.forEach((n) => {
    const comm = n.communicationId
      ? api.communications.listByTenant(tenantId).find((c) => c.id === n.communicationId)
      : undefined;
    rows.push({
      key: `inbound-notice:${n.id}`,
      at: n.createdAt,
      kind: "inbound_notice",
      icon: Bell,
      iconClass: "text-blue-500",
      title: n.title.replace(/^Notification:\s*/i, ""),
      detail: n.summary,
      href: n.customerId
        ? `/employee/messages?contact=client:${n.customerId}`
        : n.prospectId
        ? `/employee/messages?contact=prospect:${n.prospectId}`
        : comm?.carrierContactId
        ? `/employee/messages?contact=carrier:${comm.carrierContactId}`
        : "/employee/messages",
      urgency: n.severity ?? "info",
      onOpen: () => api.aiNotifications.dismiss(n.id, userId),
      onDismiss: () => api.aiNotifications.remove(n.id),
      dismissLabel: "Delete notification",
    });
  });
  quoteReadyNotifications.forEach((n) =>
    rows.push({
      key: `quote-ready:${n.id}`,
      at: n.createdAt,
      kind: "quote_ready",
      icon: Bot,
      iconClass: "text-emerald-600",
      title: n.title,
      detail: n.summary,
      href: n.customerId
        ? quoteWorkspaceDeepLink(`/employee/clients/${n.customerId}`)
        : n.prospectId
        ? quoteWorkspaceDeepLink(`/employee/prospects/${n.prospectId}`)
        : "/employee",
      urgency: n.severity ?? "info",
      onOpen: () => api.aiNotifications.dismiss(n.id, userId),
      onDismiss: () => api.aiNotifications.remove(n.id),
      dismissLabel: "Delete notification",
    })
  );
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));

  if (rows.length === 0) {
    return (
      <div className="text-sm text-ink-400 flex items-center gap-2">
        <Bell className="h-4 w-4 text-ink-300" /> All caught up.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink-100">
      {rows.slice(0, 6).map((r) => {
        const Icon = r.icon;
        const urgencyLabel =
          r.urgency === "urgent"
            ? "High"
            : r.urgency === "warning"
            ? "Medium"
            : r.urgency === "info"
            ? "Low"
            : null;
        const urgencyClass =
          r.urgency === "urgent"
            ? "bg-alert-soft text-alert border-alert-ring"
            : r.urgency === "warning"
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-yellow-50 text-yellow-700 border-yellow-200";
        return (
          <li key={r.key} className="group flex items-start gap-1 py-2">
            <Link
              to={r.href}
              state={{ fromDashboard: true }}
              onClick={r.onOpen}
              className="flex min-w-0 flex-1 items-start gap-2 hover:text-gold-700"
            >
              {r.kind === "internal_msg" && r.urgency ? (
                <ImportanceIcon
                  importance={r.urgency}
                  className="h-4 w-4 mt-0.5 shrink-0"
                />
              ) : (
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${r.iconClass}`} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{r.title}</span>
                    {urgencyLabel && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${urgencyClass}`}
                      >
                        {urgencyLabel}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-ink-500 shrink-0">
                    {fmt.relative(r.at)}
                  </span>
                </div>
                <div className="text-xs text-ink-500 mt-0.5 truncate">
                  {r.detail}
                </div>
              </div>
            </Link>
            <button
              type="button"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 opacity-100 transition hover:bg-alert-soft hover:text-alert sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
              onClick={() => {
                if (!window.confirm("Permanently delete this item?")) return;
                r.onDismiss();
                onChanged();
              }}
              aria-label={r.dismissLabel}
              title={r.dismissLabel}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DocsPending({ tenantId, visibleIds }: { tenantId: string; visibleIds: Set<string> }) {
  const docs = api.documents
    .listByTenant(tenantId)
    .filter((d) => d.status === "pending" && (!d.customerId || visibleIds.has(d.customerId)));
  if (docs.length === 0) return <div className="text-sm text-ink-400">All caught up.</div>;
  return (
    <ul className="divide-y divide-ink-100">
      {docs.slice(0, 5).map((d) => (
        <li key={d.id} className="py-2 flex items-center gap-3 text-sm">
          <FileSearch className="h-4 w-4 text-ink-400" />
          <div className="min-w-0 flex-1 truncate">{d.fileName}</div>
          <Badge tone="warn">Pending</Badge>
        </li>
      ))}
    </ul>
  );
}
