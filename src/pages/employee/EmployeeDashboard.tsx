import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Bot, Building2, CalendarClock, Check, CheckSquare, ChevronDown, ChevronUp, FileSearch, MessageCircle, PartyPopper, Plus, RotateCcw, ShieldCheck, UserSearch, Users, X } from "lucide-react";
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
import { Timeline } from "@/components/ui/Timeline";
import { Badge } from "@/components/ui/Badge";
import { ProspectStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { sweepGoalAchievements } from "@/lib/performanceGoals";
import { NewReminderModal } from "@/components/tasks/NewReminderModal";
import { NewCompanyReminderModal } from "@/components/tasks/NewCompanyReminderModal";
import { PerformanceGoalsMiniCard } from "@/components/analytics/PerformanceGoalsMiniCard";
import { ImportanceIcon } from "@/components/tasks/ImportancePicker";
import type { Reminder } from "@/types";

export function EmployeeDashboard() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [newReminderOpen, setNewReminderOpen] = useState(false);
  const [newCompanyReminderOpen, setNewCompanyReminderOpen] = useState(false);
  // Which dashboard stat tile is expanded into a quick-view list.
  const [quickView, setQuickView] = useState<
    null | "clients" | "policies" | "prospects" | "renewals"
  >(null);
  const [showPastReminders, setShowPastReminders] = useState(false);
  // AI sweep on dashboard mount: auto-send customer e-sign packets,
  // create Activity Center tasks for any docs the agent owes a
  // signature on, and synthesize renewal packets so upcoming
  // renewals always have something queued. Idempotent — re-runs
  // skip docs already sent / tasked.
  const [esignBurst, setEsignBurst] = useState<{
    customerCount: number;
    customerNames: string[];
    agentTaskCount: number;
  } | null>(null);
  useEffect(() => {
    if (!agency || !user) return;
    const portalUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/customer/documents`
        : `/customer/documents`;
    const { customerSent, agentTasks } = api.esign.runAll(
      agency.id,
      user.id,
      portalUrl
    );
    const customerDocs = customerSent.reduce(
      (sum, b) => sum + b.documents.length,
      0
    );
    if (customerDocs > 0 || agentTasks.length > 0) {
      setEsignBurst({
        customerCount: customerDocs,
        customerNames: customerSent.map((s) => s.customer.name),
        agentTaskCount: agentTasks.length,
      });
    }
    // Intentionally only runs once per dashboard mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);
  // Detect any newly-achieved performance targets on mount and fire
  // the celebration notifications (runs for whoever loads the
  // dashboard first; idempotent thereafter).
  useEffect(() => {
    if (!agency || !user) return;
    const celebrated = sweepGoalAchievements(agency.id);
    // AI triage of inbound messages → auto-create activities.
    const triaged = api.communications.sweepInboundForActivities(agency.id, user.id);
    if (celebrated.length > 0 || triaged.length > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);
  const navigate = useNavigate();
  if (!agency || !user) return null;
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
  const visiblePolicies = policies.filter((p) => visibleIds.has(p.customerId));
  const renewals = api.renewals.listByTenant(agency.id);
  const messages = api.marketing
    .listMessages(agency.id)
    .filter((m) => !m.customerId || visibleIds.has(m.customerId));
  const recent = api.status
    .listByTenant(agency.id)
    .filter((e) => !e.customerId || visibleIds.has(e.customerId));
  // Notifications are surfaced exclusively in the Activity Center.
  // The dashboard tile counts items assigned TO the viewer — managers
  // see their own queue here, not tenant-wide work.
  const activityCount =
    [
      ...api.aiNotifications.listUnacked(agency.id),
      ...api.tasks.listOpen(agency.id),
    ].filter((r) => (r.assignedToId ?? "") === viewer.id).length;

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
                    )}#performance-goals`
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

      {esignBurst && (
        <div className="rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 flex items-start gap-3">
          <Bot className="h-4 w-4 mt-0.5 shrink-0 text-violet-600" />
          <div className="flex-1 space-y-1">
            <div className="font-medium">AI e-sign sweep complete</div>
            {esignBurst.customerCount > 0 && (
              <div className="text-xs text-violet-800">
                Sent {esignBurst.customerCount} packet
                {esignBurst.customerCount === 1 ? "" : "s"} to clients:{" "}
                {esignBurst.customerNames.join(", ")}.
              </div>
            )}
            {esignBurst.agentTaskCount > 0 && (
              <div className="text-xs text-violet-800">
                Created {esignBurst.agentTaskCount} Activity Center task
                {esignBurst.agentTaskCount === 1 ? "" : "s"} for documents waiting on
                agent signature.
              </div>
            )}
            <div className="text-[11px] text-violet-700">
              Outbound emails are in each client's Communications thread; agent
              tasks live in the Activity Center.
            </div>
          </div>
          <button
            type="button"
            className="text-violet-600 hover:text-violet-900 text-xs"
            onClick={() => setEsignBurst(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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
        <Link to="/employee/tasks" className="block hover:opacity-90">
          <StatCard
            label="Activity Center"
            value={activityCount}
            icon={<CheckSquare className="h-5 w-5" />}
            hint={activityCount > 0 ? "Open the Activity Center" : "All caught up"}
          />
        </Link>
      </div>

      <StatQuickView
        which={quickView}
        onClose={() => setQuickView(null)}
        customers={customers}
        policies={visiblePolicies}
        prospects={newProspects}
        renewals={renewals.filter((r) => r.status === "upcoming")}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Prospect queue"
            subtitle="New leads and abandoned quotes detected by AI."
            action={<Link to="/employee/prospects" className="btn-outline text-xs inline-flex">View all</Link>}
          />
          <ul className="divide-y divide-ink-100">
            {newProspects.slice(0, 6).map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                <Link to={`/employee/prospects/${p.id}`} className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-ink-500 mt-0.5 truncate">{p.aiSummary}</div>
                </Link>
                <div className="text-right">
                  <ProspectStatusBadge status={p.status} />
                  <div className="text-[11px] text-ink-400 mt-1">{fmt.relative(p.lastActivityAt)}</div>
                </div>
              </li>
            ))}
            {newProspects.length === 0 && (
              <li className="py-6 text-sm text-ink-400 text-center">No open prospects.</li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Notifications"
            subtitle="New activities assigned to you, inbound client messages, and AI alerts."
            action={
              <Link
                to="/employee/tasks"
                className="btn-outline text-xs inline-flex"
              >
                <Bell className="h-3 w-3" /> Activity Center
              </Link>
            }
          />
          <NotificationsList
            tenantId={agency.id}
            userId={user.id}
            visibleCustomerIds={visibleIds}
          />
        </Card>

        <Card>
          <CardHeader
            title="My reminders"
            subtitle="Private follow-ups — set against an Activity Center card or freeform. Soonest first."
            action={
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => setNewCompanyReminderOpen(true)}
                  title="Send one reminder to a chosen group of teammates"
                >
                  <Building2 className="h-3.5 w-3.5" /> Company reminder
                </button>
                <button
                  type="button"
                  className="btn-gold text-xs"
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
                  onDismiss={() => {
                    api.reminders.dismiss(r.id);
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
                <ul className="mt-2 divide-y divide-ink-100">
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
              )}
            </div>
          )}
        </Card>

        <NewReminderModal
          open={newReminderOpen}
          onClose={() => setNewReminderOpen(false)}
          tenantId={agency.id}
          userId={user.id}
          onCreated={refresh}
        />

        <NewCompanyReminderModal
          open={newCompanyReminderOpen}
          onClose={() => setNewCompanyReminderOpen(false)}
          tenantId={agency.id}
          createdById={user.id}
          onCreated={refresh}
        />

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent status updates"
            action={
              <Link to="/employee/status-updates" className="btn-outline text-xs inline-flex">
                View all
              </Link>
            }
          />
          <Timeline events={recent.slice(0, 10)} />
        </Card>

        <PerformanceGoalsMiniCard agencyId={agency.id} isManager={user.role === "manager"} />

        <ExpandableCard
          title="Internal messages"
          subtitle="Unread DMs and group threads from your teammates."
          action={
            <Link
              to="/employee/messages"
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

        <Card>
          <CardHeader title="AI marketing activity" action={<Link className="btn-outline text-xs inline-flex" to="/employee/marketing">View</Link>} />
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

        <Card>
          <CardHeader title="Documents needing review" action={<Link to="/employee/documents" className="btn-outline text-xs inline-flex">View all</Link>} />
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
}: {
  which: null | "clients" | "policies" | "prospects" | "renewals";
  onClose: () => void;
  customers: import("@/types").CustomerProfile[];
  policies: import("@/types").Policy[];
  prospects: import("@/types").Prospect[];
  renewals: import("@/types").Renewal[];
}) {
  if (!which) return null;

  const title =
    which === "clients"
      ? "Clients"
      : which === "policies"
      ? "Bound policies"
      : which === "prospects"
      ? "Open prospects"
      : "Renewals upcoming";

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="max-h-[65vh] overflow-y-auto">
        {which === "clients" && <ClientList customers={customers} />}
        {which === "policies" && (
          <PolicyList policies={policies.filter((p) => p.status === "bound")} showPremium />
        )}
        {which === "prospects" && <ProspectList prospects={prospects} />}
        {which === "renewals" && <RenewalList renewals={renewals} />}
      </div>
    </Modal>
  );
}

function ReminderRow({
  reminder,
  onDismiss,
}: {
  reminder: Reminder;
  onDismiss: () => void;
}) {
  const task = reminder.taskId
    ? api.tasks.listByTenant(reminder.tenantId).find((t) => t.id === reminder.taskId)
    : undefined;
  const isGeneral = !reminder.taskId;
  const label = reminder.title ?? task?.title ?? "(activity removed)";
  return (
    <li className="py-2.5 flex items-start gap-3">
      <ImportanceIcon
        importance={reminder.importance}
        className="h-4 w-4 mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        {isGeneral ? (
          <div className="text-sm font-medium truncate">{label}</div>
        ) : (
          <Link
            to={`/employee/tasks?focus=${reminder.taskId}`}
            className="text-sm font-medium truncate block hover:text-gold-700"
          >
            {label}
          </Link>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge tone={isGeneral ? "neutral" : "info"}>
            {isGeneral ? "General" : "Activity"}
          </Badge>
        </div>
        {reminder.note && (
          <div className="text-xs text-ink-600 mt-0.5 italic">"{reminder.note}"</div>
        )}
        <div className="text-[11px] text-ink-500 mt-0.5">{fmt.dateTime(reminder.remindAt)}</div>
      </div>
      <button
        type="button"
        className="btn-outline text-xs"
        onClick={onDismiss}
        title="Dismiss reminder"
      >
        <Check className="h-3.5 w-3.5" /> Done
      </button>
    </li>
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
}: {
  tenantId: string;
  userId: string;
  visibleCustomerIds: Set<string>;
}) {
  // Tasks assigned to me in the last 7 days, not yet started.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentTasks = api.tasks
    .listOpen(tenantId)
    .filter(
      (t) =>
        t.assignedToId === userId &&
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

  type NotificationRow = {
    key: string;
    at: string;
    kind: "task" | "client_msg" | "internal_msg";
    icon: typeof Bell;
    iconClass: string;
    title: string;
    detail: string;
    href: string;
    // Internal-message rows carry the urgency the sender tagged on
    // the message so the dashboard recolors the icon yellow / amber
    // / red. Tasks + client messages leave this undefined.
    urgency?: import("@/types").TaskSeverity;
  };
  // Look up staff once so each internal-message row can resolve a
  // sender name without re-querying for every row.
  const staff = api.users.list(tenantId);
  const rows: NotificationRow[] = [];
  recentTasks.forEach((t) =>
    rows.push({
      key: `task:${t.id}`,
      at: t.createdAt,
      kind: "task",
      icon: CheckSquare,
      iconClass: "text-gold-600",
      title: "New activity assigned",
      detail: t.title,
      href: `/employee/tasks?focus=${t.id}`,
    })
  );
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
    });
  });
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
          <li key={r.key} className="py-2">
            <Link
              to={r.href}
              className="flex items-start gap-2 hover:text-gold-700"
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