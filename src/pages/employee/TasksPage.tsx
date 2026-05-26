import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Anchor,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  Briefcase,
  Building2,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Gem,
  Hand,
  Home,
  Info,
  ListTodo,
  Lock,
  Mail,
  Package,
  Plus,
  RotateCcw,
  Sparkles,
  Umbrella,
  User,
  UserCog,
  UserSearch,
  X,
} from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { CustomMessageComposer } from "@/components/marketing/CustomMessageComposer";
import { SetReminderModal } from "@/components/tasks/SetReminderModal";
import { ReassignModal } from "@/components/tasks/ReassignModal";
import { RequestReassignModal } from "@/components/tasks/RequestReassignModal";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useDemoNotice } from "@/lib/demo";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import type { AssetType, Task, TaskStatus } from "@/types";

// =====================================================================
// Activity Center (sidebar #2).
//
// Each row is a rich activity card carrying the full context an
// agent needs to act without leaving the page:
//
//   - "Customer received automated message regarding [topic]…" header
//   - Client + assigned-agent block (links to client profile)
//   - Policy block (carrier logo placeholder, policy #, dates, premium)
//   - AI-generated plain-language summary
//   - "Go to <Carrier> Agent Portal" deep-link (manager-only inline
//      add-URL fallback when the carrier doesn't have one configured)
//   - Quick actions: Reply / View Full Request / Mark In Progress /
//     Mark Resolved / Snooze / Reassign (manager-only)
//
// Every state change writes an audit row (see api.tasks.history)
// so the manager can reconstruct the full handling history.
// =====================================================================

const ASSET_ICON: Record<AssetType, React.ComponentType<{ className?: string }>> = {
  coastal_home: Home,
  luxury_vehicle: Car,
  yacht: Anchor,
  jewelry: Gem,
  umbrella_liability: Umbrella,
  full_portfolio: Briefcase,
  other: Package,
};

type StatusFilter = "all" | TaskStatus;

export function TasksPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const showDemoNotice = useDemoNotice();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  useEffect(() => subscribeToDbChanges(refresh), []);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [carrierFilter, setCarrierFilter] = useState<string>("all");
  // Manager-only "whose queue am I viewing?" picker. Defaults to
  // "me" so a manager lands on their own work first; they can
  // switch to a specific agent's view or "all" to see everything.
  // For agents this is forced to "me" via the visibleIds gate.
  const [managerView, setManagerView] = useState<string>("me");
  // Composer state for the Reply-to-Customer flow.
  const [replyTask, setReplyTask] = useState<Task | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [createActivityOpen, setCreateActivityOpen] = useState(false);
  // `?focus=<taskId>` deep-link from elsewhere in the app (e.g. the
  // Open-activities card on a client profile). The matching
  // ActivityCard opens expanded + scrolls itself into view on mount.
  const [searchParams] = useSearchParams();
  const focusedTaskId = searchParams.get("focus");
  const navigate = useNavigate();

  // When arriving via ?focus=<taskId> (e.g. from an Analytics agent
  // drill-down or a client profile), the focused activity may belong
  // to a different agent's queue than the manager's default "me"
  // view — so the card wouldn't render and focus would silently fail.
  // Switch the queue picker to the task's owner (or "all") so the
  // activity is actually visible and can scroll into view.
  useEffect(() => {
    if (!focusedTaskId || !agency || !user || user.role !== "manager") return;
    const t = api.tasks.listByTenant(agency.id).find((x) => x.id === focusedTaskId);
    if (!t) return;
    const owner = t.assignedToId ?? "";
    setManagerView(owner && owner !== user.id ? owner : owner ? "me" : "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedTaskId, agency?.id, user?.id]);

  // Customer-driven AI notifications no longer sit in a manual inbox —
  // they promote straight into activities the moment the Activity
  // Center loads. Upcoming renewals also auto-spawn an activity for the
  // owning agent. (Both idempotent.)
  useEffect(() => {
    if (!agency || !user) return;
    api.aiNotifications.autoPromote(agency.id, user.id);
    api.renewals.ensureActivities(agency.id);
    // AI triage of inbound messages → auto-create activities.
    api.communications.sweepInboundForActivities(agency.id, user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);

  if (!agency || !user) return null;

  const viewer = { id: user.id, role: user.role };
  const visibleIds = new Set(
    api.customers.listVisible(agency.id, viewer).map((c) => c.id)
  );
  const isManager = user.role === "manager";
  const agents = api.users.list(agency.id).filter((u) => u.role === "agent" || u.role === "manager");
  const carriers = api.carriers.list();
  // Resolve the manager's queue selection into a concrete agentId
  // (or null = "all agents"). Agents always view their own queue.
  const queueAgentId: string | null = isManager
    ? managerView === "all"
      ? null
      : managerView === "me"
      ? user.id
      : managerView
    : user.id;

  // Unacked notifications still sit at the top — they're the
  // "fresh" Activity Center inbox. Acknowledging promotes them to
  // a Task with the full context carried over.
  // For managers, the queue picker scopes the visible work to a
  // specific agent (default themselves) or to everyone.
  // For agents, queueAgentId is always their own id.
  // A row's effective owner. Explicit assignedToId wins; otherwise an
  // activity tied to a client that already has an assigned agent
  // belongs to that agent (so the manager never sees assigned-clients'
  // work as unrouted in their own queue). Falls back to "" (unowned).
  function effectiveOwner(row: { assignedToId?: string; customerId?: string }): string {
    if (row.assignedToId) return row.assignedToId;
    if (row.customerId) {
      const c = api.customers.get(row.customerId);
      if (c?.assignedAgentId) return c.assignedAgentId;
    }
    return "";
  }

  function inSelectedQueue<T extends { assignedToId?: string; customerId?: string }>(
    rows: T[]
  ): T[] {
    if (queueAgentId == null) return rows;
    return rows.filter((r) => effectiveOwner(r) === queueAgentId);
  }

  // Active = open + in_progress + snoozed (we still surface
  // snoozed ones in a collapsible band below). Resolved tasks go
  // to the bottom card.
  const openTasks = inSelectedQueue(
    api.tasks
      .listOpen(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
      // Activities an agent punted to a manager live in the Routing
      // card (below), not the To-do board.
      .filter((t) => !t.awaitingManagerAssignment)
  );
  const snoozedTasks = inSelectedQueue(
    api.tasks
      .listSnoozed(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
  );
  const completedTasks = inSelectedQueue(
    api.tasks
      .listCompleted(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
  );

  // Manager-only routing surface: prospects + clients in the
  // tenant with no assigned agent. The manager can assign each
  // one to a specific agent (or themselves) inline.
  const unroutedProspects = isManager
    ? api.prospects.listByTenant(agency.id).filter((p) => !p.assignedAgentId)
    : [];
  const unroutedClients = isManager
    ? api.customers.list(agency.id).filter((c) => !c.assignedAgentId)
    : [];
  // Activities an agent handed to a manager to assign — surfaced
  // tenant-wide in the Routing card so any manager can pick them up.
  const awaitingActivities = isManager
    ? api.tasks.listOpen(agency.id).filter((t) => t.awaitingManagerAssignment)
    : [];

  // Sort order:
  //   1. Manual priorityRank desc — pinned (1) → default (0) →
  //      deprioritized (-1).
  //   2. Severity rank (urgent > warning > info).
  //   3. Age, newest first.
  const sortedOpen = useMemo(() => {
    const rank: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
    return [...openTasks].sort((a, b) => {
      const pa = a.priorityRank ?? 0;
      const pb = b.priorityRank ?? 0;
      if (pa !== pb) return pb - pa;
      const ra = rank[a.severity ?? "info"] ?? 9;
      const rb = rank[b.severity ?? "info"] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }, [openTasks]);

  // Apply filters to the open list. Agent-queue scoping is done
  // earlier via inSelectedQueue() so the picker can also drive
  // the routing card + notifications.
  const filteredOpen = useMemo(() => {
    return sortedOpen.filter((t) => {
      if (statusFilter !== "all" && api.tasks.statusOf(t) !== statusFilter) return false;
      if (carrierFilter !== "all") {
        const policy = t.policyId ? api.policies.get(t.policyId) : undefined;
        if (!policy || policy.carrierId !== carrierFilter) return false;
      }
      return true;
    });
  }, [sortedOpen, statusFilter, carrierFilter]);

  function customerLink(customerId?: string) {
    if (!customerId) return null;
    const c = api.customers.get(customerId);
    if (!c || !api.customers.canSee(c, viewer)) return null;
    return (
      <Link to={`/employee/clients/${c.id}`} className="text-gold-700 hover:underline">
        {c.name}
      </Link>
    );
  }

  function startReply(t: Task) {
    api.tasks.logView(t.id, user!.id);
    setReplyTask(t);
    setComposeOpen(true);
  }

  return (
    <div className="space-y-6">
      {focusedTaskId && (
        <button
          type="button"
          className="btn-ghost -ml-2"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Activity Center</h1>
          <p className="text-ink-500 text-sm mt-1">
            {isManager
              ? "Route unrouted prospects + clients, view any agent's queue, or work your own. The Viewing queue picker below scopes the columns to a specific agent or all agents."
              : "AI actions taken on your behalf, plus the follow-ups you still owe. Each entry shows the customer's request, the policy in play, and a one-click link to the carrier's agent portal so you can service the change end-to-end."}
          </p>
        </div>
        <button
          type="button"
          className="btn-gold text-sm shrink-0"
          onClick={() => setCreateActivityOpen(true)}
        >
          <Plus className="h-4 w-4" /> Create new activity
        </button>
      </div>

      <CreateActivityModal
        open={createActivityOpen}
        onClose={() => setCreateActivityOpen(false)}
        tenantId={agency.id}
        viewer={{ id: user.id, role: user.role }}
        onCreated={refresh}
      />

      {/* Manager-only routing surface */}
      {isManager && (
        <RoutingCard
          prospects={unroutedProspects}
          clients={unroutedClients}
          activities={awaitingActivities}
          agents={agents}
          currentUserId={user.id}
          currentUserName={user.name}
        />
      )}

      {/* Filters */}
      {(openTasks.length > 0 || snoozedTasks.length > 0 || isManager) && (
        <div className="flex items-end gap-3 flex-wrap">
          {isManager && (
            <FilterSelect
              label="Viewing queue"
              value={managerView}
              onChange={setManagerView}
              options={[
                { value: "me", label: `Me — ${user.name}` },
                { value: "all", label: "All agents" },
                ...agents
                  .filter((a) => a.id !== user.id)
                  .map((a) => ({ value: a.id, label: `${a.name} (${a.role})` })),
              ]}
            />
          )}
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: "all", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "snoozed", label: "Snoozed" },
              { value: "resolved", label: "Resolved" },
            ]}
          />
          <FilterSelect
            label="Carrier"
            value={carrierFilter}
            onChange={setCarrierFilter}
            options={[
              { value: "all", label: "All carriers" },
              ...carriers.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      )}

      {/* Two-column board: To do | In progress */}
      <ActivityBoard
        tasks={filteredOpen}
        viewerIsManager={isManager}
        onStartReply={startReply}
        totalUnfiltered={sortedOpen.length}
        focusedTaskId={focusedTaskId}
      />

      {/* Snoozed band */}
      {snoozedTasks.length > 0 && (
        <Card>
          <CardHeader
            title={`Snoozed (${snoozedTasks.length})`}
            subtitle="Hidden from the open list until each snooze window passes."
          />
          <ul className="divide-y divide-ink-100">
            {snoozedTasks.map((t) => (
              <li key={t.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{t.title}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    Returns {t.snoozedUntil ? fmt.dateTime(t.snoozedUntil) : "soon"}
                    {customerLink(t.customerId) && <> · {customerLink(t.customerId)}</>}
                  </div>
                </div>
                <button
                  className="btn-ghost text-xs shrink-0"
                  onClick={() => api.tasks.markInProgress(t.id, user.id)}
                  title="Bring back into the open list"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Resume now
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Completed band — collapsible */}
      <CompletedSection
        tasks={completedTasks}
        onReopen={(id) => api.tasks.reopen(id, user.id)}
        canSee={(cId) => customerLink(cId) !== null}
        customerLink={customerLink}
      />

      {/* Reply composer — prefilled with the AI draft body */}
      {replyTask && (
        <CustomMessageComposer
          open={composeOpen}
          onClose={() => {
            setComposeOpen(false);
            setReplyTask(null);
          }}
          initialCustomerIds={replyTask.customerId ? [replyTask.customerId] : undefined}
          initialChannel="email"
          initialSubject={replyTask.aiReplySubject ?? `Re: your policy request`}
          initialBody={replyTask.aiReplyBody}
          onSent={() => {
            api.tasks.logReply(replyTask.id, user.id, { channel: "email" });
            setComposeOpen(false);
            setReplyTask(null);
            refresh();
          }}
          onSubmitted={refresh}
        />
      )}

      {/* Demo-mode reminder for the "add carrier portal" inline path */}
      <div className="text-[11px] text-ink-400">
        Carrier agent-portal URLs are managed under{" "}
        <Link to="/master/carriers" className="text-gold-700 hover:underline">
          Master → Carriers
        </Link>
        . When a portal URL is missing, the activity card shows a manager-only "Add carrier portal
        link" prompt so the next user can fix it inline.
      </div>
    </div>
  );

  function CompletedSection({
    tasks,
    onReopen,
    canSee: _canSee,
    customerLink: linkFor,
  }: {
    tasks: Task[];
    onReopen: (id: string) => void;
    canSee: (id?: string) => boolean;
    customerLink: (id?: string) => React.ReactNode;
  }) {
    const [open, setOpen] = useState(false);
    return (
      <Card>
        <CardHeader
          title={`Resolved (${tasks.length})`}
          subtitle="Closed activities. Reopen if you need to revisit one."
          action={
            <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show"}
            </button>
          }
        />
        {open && (
          tasks.length === 0 ? (
            <div className="text-sm text-ink-400">No resolved activities yet.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {tasks.map((t) => (
                <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink-700 line-through truncate">{t.title}</div>
                    <div className="text-[11px] text-ink-400 mt-0.5">
                      {t.startedAt && (
                        <>Started {fmt.dateTime(t.startedAt)} · </>
                      )}
                      Resolved {t.completedAt ? fmt.dateTime(t.completedAt) : "—"}
                      {t.startedAt && t.completedAt && (
                        <> · Handle time {durationLabel(t.startedAt, t.completedAt)}</>
                      )}
                      {linkFor(t.customerId) ? <> · {linkFor(t.customerId)}</> : null}
                    </div>
                  </div>
                  <button
                    className="btn-ghost text-xs shrink-0"
                    onClick={() => onReopen(t.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </Card>
    );
  }
}

// ---------------------------------------------------------------------
// Two-column board: To do | In progress
//
// Open + snoozeable activities split by status. Click "Mark in
// progress" on a To-do card to move it across; click "Mark
// resolved" from either column to close it out.
// ---------------------------------------------------------------------

// =====================================================================
// Manager-only routing card. Shows every prospect + client in
// the tenant with no assigned agent and gives the manager a
// per-row "Assign to…" dropdown so they can route the work to
// any agent — including themselves — in one click.
// =====================================================================

interface AssignIntent {
  kind: "prospect" | "client" | "activity";
  id: string;
  name: string;
  // Pre-checked agents when the modal opens. The manager can
  // add or remove agents before confirming. For prospects the
  // modal collapses to single-select (radio); for clients it's
  // multi-select (checkbox).
  preselected: string[];
}

function RoutingCard({
  prospects,
  clients,
  activities,
  agents,
  currentUserId,
  currentUserName,
}: {
  prospects: import("@/types").Prospect[];
  clients: import("@/types").CustomerProfile[];
  activities: Task[];
  agents: { id: string; name: string; role: string }[];
  currentUserId: string;
  currentUserName: string;
}) {
  // Two-click confirmation: every assignment goes through a
  // confirm modal before mutating state. The same modal also
  // lets the manager add or remove agents (multi-select for
  // clients, single-select for prospects).
  const [confirming, setConfirming] = useState<AssignIntent | null>(null);
  const total = prospects.length + clients.length + activities.length;

  function performAssign(selectedIds: string[]) {
    if (!confirming || selectedIds.length === 0) return;
    if (confirming.kind === "prospect") {
      api.prospects.assignAgents(confirming.id, selectedIds, currentUserId);
    } else if (confirming.kind === "client") {
      api.customers.assignAgents(confirming.id, selectedIds, currentUserId);
    } else {
      // Activities take a single owner — the manager's pick.
      api.tasks.assign(confirming.id, selectedIds[0], currentUserId);
    }
    setConfirming(null);
  }

  return (
    <div className="rounded-lg border border-gold-200 bg-gold-50/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-lg flex items-center gap-2">
            <UserCog className="h-4 w-4 text-gold-700" /> Routing
            {total > 0 && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold tabular-nums bg-gold-600 text-white">
                {total}
              </span>
            )}
          </h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Route unassigned prospects and clients to an agent — and pick up activities an
            agent has handed off for you to assign. Each assignment is confirmed in a second
            step so you don't misroute.
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-white px-4 py-4 text-xs text-ink-400 text-center">
          Nothing waiting to be routed — every prospect, client, and handed-off activity has an
          agent assigned.
        </div>
      ) : (
        <div className="space-y-4">
        {activities.length > 0 && (
          <RoutingList
            label="Activities to assign"
            emptyHint="No handed-off activities."
            rows={activities.map((t) => {
              const sender = t.createdById
                ? api.users.get(t.createdById)?.name
                : undefined;
              const contactName = t.customerId
                ? api.customers.get(t.customerId)?.name
                : t.prospectId
                ? api.prospects.get(t.prospectId)?.name
                : undefined;
              const tags: RoutingRow["tags"] = [];
              if (t.severity)
                tags.push({
                  label: t.severity === "urgent" ? "High" : t.severity === "warning" ? "Medium" : "Low",
                  tone: t.severity === "urgent" ? "amber" : "neutral",
                });
              if (contactName) tags.push({ label: contactName, tone: "neutral" });
              return {
                id: t.id,
                name: t.title,
                hint: sender ? `Handed off by ${sender}` : "Handed off for assignment",
                link: `/employee/tasks?focus=${t.id}`,
                tags,
              };
            })}
            kind="activity"
            agents={agents}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAssign={(intent) => setConfirming(intent)}
          />
        )}
        <div className="grid lg:grid-cols-2 gap-4">
          <RoutingList
            label="Prospects"
            emptyHint="No unrouted prospects."
            rows={prospects.map((p) => {
              // Personal vs commercial isn't an explicit field on
              // Prospect — derive from the asset type. All current
              // asset types are personal lines for this private-
              // client demo book; the helper returns a friendly
              // label either way.
              const line = prospectLineLabel(p.assetType);
              const tags: RoutingRow["tags"] = [
                { label: line, tone: line === "Personal lines" ? "gold" : "indigo" },
                { label: api.helpers.assetTypeLabel(p.assetType), tone: "neutral" },
              ];
              if (p.estimatedValue) {
                tags.push({ label: `~${fmt.money(p.estimatedValue)}`, tone: "neutral" });
              }
              return {
                id: p.id,
                name: p.name,
                hint: p.email,
                link: `/employee/prospects/${p.id}`,
                tags,
              };
            })}
            kind="prospect"
            agents={agents}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAssign={(intent) => setConfirming(intent)}
          />
          <RoutingList
            label="Clients"
            emptyHint="No unrouted clients."
            rows={clients.map((c) => {
              const policies = api.policies.listByCustomer(c.id);
              const tags: RoutingRow["tags"] = [];
              if (policies.length > 0) {
                const dept = policies.some((p) => p.department === "commercial")
                  ? "Commercial lines"
                  : "Personal lines";
                tags.push({
                  label: dept,
                  tone: dept === "Commercial lines" ? "indigo" : "gold",
                });
                // Show up to 2 distinct asset types as a hint of
                // what the manager will be routing.
                const seen = new Set<string>();
                for (const p of policies) {
                  const a = api.assets.get(p.assetId);
                  if (!a) continue;
                  const label = api.helpers.assetTypeLabel(a.type);
                  if (seen.has(label)) continue;
                  seen.add(label);
                  tags.push({ label, tone: "neutral" });
                  if (seen.size >= 2) break;
                }
                tags.push({
                  label: `${policies.length} polic${policies.length === 1 ? "y" : "ies"}`,
                  tone: "neutral",
                });
              } else {
                tags.push({ label: "No policies yet", tone: "amber" });
              }
              return {
                id: c.id,
                name: c.name,
                hint: c.email,
                link: `/employee/clients/${c.id}`,
                tags,
              };
            })}
            kind="client"
            agents={agents}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAssign={(intent) => setConfirming(intent)}
          />
        </div>
        </div>
      )}

      <RoutingConfirmModal
        intent={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={performAssign}
        agents={agents}
        currentUserId={currentUserId}
      />
    </div>
  );
}

function RoutingConfirmModal({
  intent,
  onCancel,
  onConfirm,
  agents,
  currentUserId,
}: {
  intent: AssignIntent | null;
  onCancel: () => void;
  onConfirm: (agentIds: string[]) => void;
  agents: { id: string; name: string; role: string }[];
  currentUserId: string;
}) {
  // Local selection state — initialized from the preselected
  // list on the intent (e.g. "Assign to me" pre-checks the
  // current user). Multi-select for both clients and prospects.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (intent) setSelected(new Set(intent.preselected));
  }, [intent?.id, intent?.preselected.join(",")]);
  if (!intent) return null;
  const kindLabel =
    intent.kind === "client"
      ? "client"
      : intent.kind === "prospect"
      ? "prospect"
      : "activity";

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const orderedIds = Array.from(selected).sort((a, b) => {
    // Put the manager (current user) first when present so
    // assignAgents picks them as the primary owner.
    if (a === currentUserId) return -1;
    if (b === currentUserId) return 1;
    return 0;
  });

  return (
    <Modal open onClose={onCancel} title={`Assign ${intent.name}`} size="md">
      <p className="text-sm text-ink-700">
        {intent.kind === "activity"
          ? "Pick the agent who should own this activity."
          : `Pick one or more agents to own this ${kindLabel}.`}
      </p>
      <p className="text-xs text-ink-500 mt-1">
        {intent.kind === "activity"
          ? "The activity moves to that agent's queue. If you select more than one, the first is used."
          : "The first agent in the list becomes the primary owner; the rest co-own. Each newly-routed agent gets a follow-up task on their Activity Center queue."}
      </p>

      <ul className="mt-4 divide-y divide-ink-100 rounded-md border border-ink-100 max-h-[280px] overflow-y-auto">
        {agents.map((a) => {
          const checked = selected.has(a.id);
          return (
            <li key={a.id}>
              <label className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
                <input
                  type="checkbox"
                  name="assign-agent"
                  checked={checked}
                  onChange={() => toggle(a.id)}
                />
                <span className="flex-1 truncate">
                  {a.name}
                  {a.id === currentUserId && (
                    <span className="text-ink-400 ml-1.5 text-[11px]">(you)</span>
                  )}
                </span>
                <span className="text-[11px] text-ink-400 uppercase tracking-wider">
                  {a.role}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex items-center justify-between gap-2">
        <div className="text-[11px] text-ink-500">
          {selected.size === 0
            ? "Pick at least one agent."
            : selected.size === 1
            ? "1 agent selected."
            : `${selected.size} agents selected — primary owner: ${
                agents.find((a) => a.id === orderedIds[0])?.name ?? "—"
              }`}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-outline text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-gold text-sm"
            disabled={selected.size === 0}
            onClick={() => onConfirm(orderedIds)}
          >
            Confirm assign
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface RoutingRow {
  id: string;
  name: string;
  link: string;
  hint?: string;
  // Visual tags rendered as small pills in front of the hint
  // text. Used by the routing surface so a manager knows the
  // shape of the work — line (personal / commercial), asset
  // type, estimated value — before they pick an agent.
  tags?: { label: string; tone?: "neutral" | "gold" | "indigo" | "amber" }[];
}

function RoutingList({
  label,
  emptyHint,
  rows,
  kind,
  currentUserId,
  onAssign,
}: {
  label: string;
  emptyHint: string;
  rows: RoutingRow[];
  kind: "prospect" | "client" | "activity";
  agents: { id: string; name: string; role: string }[];
  currentUserId: string;
  currentUserName: string;
  onAssign: (intent: AssignIntent) => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">{label} ({rows.length})</div>
      {rows.length === 0 ? (
        <div className="text-xs text-ink-400 text-center py-4">{emptyHint}</div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  to={r.link}
                  className="text-sm font-medium text-ink-900 hover:text-gold-700 truncate block"
                >
                  {r.name}
                </Link>
                {r.tags && r.tags.length > 0 && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    {r.tags.map((t, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          t.tone === "gold"
                            ? "bg-gold-50 text-gold-700 border border-gold-200"
                            : t.tone === "indigo"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : t.tone === "amber"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-ink-100 text-ink-700"
                        }`}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                )}
                {r.hint && (
                  <div className="text-[11px] text-ink-500 truncate mt-1">{r.hint}</div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-gold text-xs"
                  onClick={() =>
                    onAssign({
                      kind,
                      id: r.id,
                      name: r.name,
                      preselected: [currentUserId],
                    })
                  }
                  title="Assign to me (will confirm)"
                >
                  Assign to me
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() =>
                    onAssign({
                      kind,
                      id: r.id,
                      name: r.name,
                      preselected: [],
                    })
                  }
                  title={`Pick one or more agents to co-own this ${kind}`}
                >
                  Pick agents…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityBoard({
  tasks,
  viewerIsManager,
  onStartReply,
  totalUnfiltered,
  focusedTaskId,
}: {
  tasks: Task[];
  viewerIsManager: boolean;
  onStartReply: (t: Task) => void;
  totalUnfiltered: number;
  focusedTaskId?: string | null;
}) {
  const todo = tasks.filter((t) => api.tasks.statusOf(t) === "open");
  const inProgress = tasks.filter((t) => api.tasks.statusOf(t) === "in_progress");

  if (totalUnfiltered === 0) {
    return (
      <Card>
        <CardHeader title="Open activities (0)" />
        <EmptyState
          title="Inbox zero"
          description="New activity lands here automatically as customers reach out."
          icon={<ListTodo className="h-8 w-8" />}
        />
      </Card>
    );
  }
  if (tasks.length === 0) {
    return (
      <Card>
        <CardHeader title="No activities match the current filters" />
        <div className="text-sm text-ink-400">Clear the filters above to see the rest.</div>
      </Card>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <BoardColumn
        title="To do"
        tasks={todo}
        emptyHint="Nothing waiting. Mark items in progress from this column to move them across."
        viewerIsManager={viewerIsManager}
        onStartReply={onStartReply}
        tone="alert"
        focusedTaskId={focusedTaskId}
      />
      <BoardColumn
        title="In progress"
        tasks={inProgress}
        emptyHint="No items in flight. Click 'Start activity' on a To-do card to move it here."
        viewerIsManager={viewerIsManager}
        onStartReply={onStartReply}
        tone="info"
        focusedTaskId={focusedTaskId}
      />
    </div>
  );
}

function BoardColumn({
  title,
  tasks,
  emptyHint,
  viewerIsManager,
  onStartReply,
  tone,
  focusedTaskId,
}: {
  title: string;
  tasks: Task[];
  emptyHint: string;
  viewerIsManager: boolean;
  onStartReply: (t: Task) => void;
  tone: "alert" | "info";
  focusedTaskId?: string | null;
}) {
  const chipClass =
    tone === "alert"
      ? "bg-alert text-white"
      : "bg-indigo-500 text-white";
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-3 min-w-0">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg">{title}</h3>
          <span
            className={`inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${chipClass}`}
          >
            {tasks.length}
          </span>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-white px-4 py-6 text-xs text-ink-400 text-center">
          {emptyHint}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <ActivityCard
              key={t.id}
              task={t}
              viewerIsManager={viewerIsManager}
              onStartReply={onStartReply}
              isFocused={focusedTaskId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Activity card
// ---------------------------------------------------------------------

function ActivityCard({
  task,
  viewerIsManager,
  onStartReply,
  isFocused,
}: {
  task: Task;
  viewerIsManager: boolean;
  onStartReply: (t: Task) => void;
  isFocused?: boolean;
}) {
  const { user } = useAuth();
  const { agency } = useTenant();
  const showDemoNotice = useDemoNotice();
  // Activities start collapsed so the To do / In progress columns
  // read as scannable lists. Agent expands a card to act on it.
  // Deep-link arrivals (?focus=<taskId>) open expanded + scroll
  // themselves into view so the agent lands on the card primed
  // to act.
  const [expanded, setExpanded] = useState(!!isFocused);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isFocused) return;
    window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, [isFocused]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [requestReassignOpen, setRequestReassignOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [importanceOpen, setImportanceOpen] = useState(false);

  const customer = task.customerId ? api.customers.get(task.customerId) : undefined;
  // For routing-driven activities the work is tied to a prospect
  // (not yet a client). Look that name up so the collapsed bar
  // can show "New prospect assigned: <name>" instead of "—".
  const prospect = task.prospectId ? api.prospects.get(task.prospectId) : undefined;
  // Resolution gate: if the AI suggester still flags missing
  // documents for this customer, the agent can't close out the
  // activity until those are uploaded. Stops them from marking
  // "done" before all carrier-required paperwork is on file.
  const missingDocs = task.customerId
    ? api.documents.suggestMissingForCustomer(task.customerId)
    : [];
  const missingDocCount = missingDocs.reduce(
    (sum, g) => sum + g.missing.length,
    0
  );
  // AI resolution checklist — fed by the same suggester + audit
  // trail. The Mark resolved button only appears for activities
  // the agent has marked in progress, and it's locked until
  // canResolve returns true (or a manager grants an override).
  const checklist = api.tasks.checklistFor(task);
  const resolveGate = api.tasks.canResolve(task);
  const resolveBlocked = !resolveGate.allowed;
  const questionnaireSent = api.tasks.hasSentQuestionnaire(task);
  const esignDocsSent = api.tasks.hasSentEsignDocs(task);
  const overrideGranted = !!task.overrideGrantedAt;
  const overrideRequested = !!task.overrideRequestedAt && !overrideGranted;
  // Personal reminders the viewer has set against this task.
  const myReminders = user ? api.reminders.listForTask(task.id, user.id) : [];
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const policy = task.policyId ? api.policies.get(task.policyId) : undefined;
  const asset = task.assetId
    ? api.assets.get(task.assetId)
    : policy
    ? api.assets.get(policy.assetId)
    : undefined;
  const carrier = policy ? api.carriers.get(policy.carrierId) : undefined;
  const assignedAgent = task.assignedToId
    ? api.users.list(task.tenantId).find((u) => u.id === task.assignedToId)
    : undefined;
  const agents = api.users.list(task.tenantId).filter((u) => u.role === "agent" || u.role === "manager");
  const status = api.tasks.statusOf(task);
  const severity = task.severity ?? "info";
  const AssetIcon = ASSET_ICON[asset?.type ?? "other"];

  // Compact collapsed bar — two-row layout. Row 1: severity
  // icon + summary + status chip. Row 2: metadata strip showing
  // policy ref, opened-when, assigned agent (when viewer is
  // looking at someone else's queue), and any blocking state
  // (missing docs / override pending). Designed so the agent
  // can scan a long Activity Center without expanding each card.
  if (!expanded) {
    const metaParts: React.ReactNode[] = [];
    if (policy) {
      metaParts.push(
        <span key="ref" className="font-mono">
          {fmt.policyRef(policy)}
        </span>
      );
    }
    metaParts.push(
      <span key="opened" className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" /> {fmt.relative(task.createdAt)} ago
      </span>
    );
    if (assignedAgent && assignedAgent.id !== user?.id) {
      metaParts.push(
        <span key="agent" className="inline-flex items-center gap-1">
          <UserCog className="h-3 w-3" /> {assignedAgent.name}
        </span>
      );
    }
    if (missingDocCount > 0) {
      metaParts.push(
        <span key="docs" className="inline-flex items-center gap-1 text-alert">
          <FileText className="h-3 w-3" /> {missingDocCount} doc
          {missingDocCount === 1 ? "" : "s"} missing
        </span>
      );
    }
    if (overrideRequested) {
      metaParts.push(
        <span key="ovr" className="inline-flex items-center gap-1 text-amber-700">
          <Lock className="h-3 w-3" /> Override requested
        </span>
      );
    }
    if (overrideGranted) {
      metaParts.push(
        <span key="ovg" className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCircle2 className="h-3 w-3" /> Override granted
        </span>
      );
    }
    return (
      <div className="relative rounded-lg border border-ink-100 bg-white shadow-luxe overflow-hidden flex items-stretch">
        <SeverityBar severity={severity} />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex-1 flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left min-w-0 hover:bg-ink-50/60"
          aria-expanded={false}
          title="Expand activity"
        >
          <SeverityIcon severity={severity} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink-900 truncate">
              {compactSummary(task, customer?.name, carrier?.name, prospect?.name)}
            </div>
            <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
              {metaParts.map((node, i) => (
                <span key={i} className="inline-flex items-center">
                  {i > 0 && <span className="text-ink-300 mr-3">·</span>}
                  {node}
                </span>
              ))}
            </div>
          </div>
          <StatusChip status={status} />
          <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`relative rounded-lg border bg-white shadow-luxe overflow-hidden flex transition-shadow ${
        isFocused ? "border-gold-400 ring-2 ring-gold-200" : "border-ink-100"
      }`}
    >
      {/* Severity bar */}
      <SeverityBar severity={severity} />
      <div className="flex-1 p-4 sm:p-5 space-y-4 min-w-0">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink-900 flex items-start gap-2">
              <SeverityIcon severity={severity} />
              <span className="leading-snug">{task.title}</span>
            </div>
            <div className="text-[11px] text-ink-400 mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Opened {fmt.dateTime(task.createdAt)}
                <span className="text-ink-500"> · {fmt.relative(task.createdAt)} ago</span>
              </span>
              {task.startedAt && (
                <span className="inline-flex items-center gap-1 text-indigo-600">
                  <Hand className="h-3 w-3" />
                  Started {fmt.dateTime(task.startedAt)}
                  <span className="text-indigo-400"> · {fmt.relative(task.startedAt)} ago</span>
                </span>
              )}
              {task.completedAt && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Resolved {fmt.dateTime(task.completedAt)}
                  <span className="text-emerald-500"> · {fmt.relative(task.completedAt)} ago</span>
                </span>
              )}
              {task.startedAt && task.completedAt && (
                <span className="text-ink-500">
                  · Handle time {durationLabel(task.startedAt, task.completedAt)}
                </span>
              )}
              <StatusChip status={status} />
              {(task.priorityRank ?? 0) === 1 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-gold-700 px-2 py-0.5 rounded bg-gold-50 border border-gold-200">
                  <ArrowUpToLine className="h-3 w-3" /> Pinned to top
                </span>
              )}
              {(task.priorityRank ?? 0) === -1 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-500 px-2 py-0.5 rounded bg-ink-50 border border-ink-100">
                  <ArrowDownToLine className="h-3 w-3" /> Sent to bottom
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs shrink-0"
            onClick={() => setExpanded(false)}
            title="Collapse to summary bar"
            aria-expanded={true}
          >
            <ChevronUp className="h-3.5 w-3.5" /> Collapse
          </button>
        </div>

        {/* Two-column info: Client + Policy */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Client block */}
          <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 text-sm">
            <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">Client</div>
            <dl className="space-y-1.5">
              <Row
                label="Name"
                value={
                  customer ? (
                    <Link to={`/employee/clients/${customer.id}`} className="text-gold-700 hover:underline font-medium">
                      {customer.name}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <Row
                label="Policy #"
                value={
                  policy ? (
                    <Link to={`/employee/clients/${policy.customerId}`} className="text-gold-700 hover:underline font-mono text-xs">
                      {fmt.policyRef(policy)}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <Row label="Asset" value={asset?.label ?? "—"} />
              <Row
                label="Assigned agent"
                value={
                  assignedAgent ? (
                    <span>
                      {assignedAgent.name}
                      {assignedAgent.email && (
                        <a className="text-ink-500 ml-1" href={`mailto:${assignedAgent.email}`}>
                          ({assignedAgent.email})
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-alert">Unassigned</span>
                  )
                }
              />
            </dl>
          </div>

          {/* Policy block */}
          <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 text-sm">
            <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">Policy</div>
            <div className="flex items-start gap-3">
              <CarrierLogo carrier={carrier} AssetIcon={AssetIcon} />
              <dl className="space-y-1.5 min-w-0 flex-1">
                <Row label="Carrier" value={carrier?.name ?? "—"} />
                <Row
                  label="Type"
                  value={asset ? api.helpers.assetTypeLabel(asset.type) : "—"}
                />
                <Row label="Effective" value={fmt.date(policy?.effectiveDate)} />
                <Row label="Renewal" value={fmt.date(policy?.renewalDate)} />
                <Row
                  label="Premium"
                  value={
                    policy?.finalPremium
                      ? fmt.money(policy.finalPremium)
                      : policy?.premiumEstimate
                      ? `${fmt.money(policy.premiumEstimate)} (est)`
                      : "—"
                  }
                />
                <Row
                  label="Status"
                  value={policy ? <PolicyStatusBadge status={policy.status} /> : "—"}
                />
              </dl>
            </div>
          </div>
        </div>

        {/* AI summary */}
        {task.aiSummary && (
          <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-900">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-violet-700 font-semibold mb-1">
              <Sparkles className="h-3 w-3" /> AI summary of customer's need
            </div>
            <p className="leading-snug">{task.aiSummary}</p>
            {task.severityReason && !task.severityChangedById && (
              <p className="mt-2 pt-2 border-t border-violet-200 text-[11px] text-violet-700">
                <span className="font-semibold">AI graded {
                  severity === "urgent"
                    ? "High"
                    : severity === "warning"
                    ? "Medium"
                    : "Low"
                } importance:</span>{" "}
                {task.severityReason}
              </p>
            )}
          </div>
        )}

        {/* Carrier portal CTA */}
        {carrier && (
          <CarrierPortalLink carrier={carrier} viewerIsManager={viewerIsManager} onAdded={() => { /* db change pings subscribeToDbChanges */ }} />
        )}

        {/* View Full Request body */}
        {task.originalMessageContent && (
          <div>
            <button
              type="button"
              className="text-xs text-ink-600 hover:text-gold-700 inline-flex items-center gap-1"
              onClick={() => {
                setShowOriginal((v) => !v);
                if (!showOriginal) api.tasks.logView(task.id, user?.id);
              }}
            >
              {showOriginal ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showOriginal ? "Hide" : "View"} full original request
            </button>
            {showOriginal && (
              <pre className="mt-2 rounded-md border border-ink-100 bg-ink-50 p-3 text-xs text-ink-700 whitespace-pre-wrap font-sans">
                {task.originalMessageContent}
              </pre>
            )}
          </div>
        )}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-ink-100">
          {status !== "in_progress" && (
            <button
              type="button"
              className="btn bg-blue-600 text-white hover:bg-blue-700 text-xs"
              onClick={() => api.tasks.markInProgress(task.id, user?.id)}
              title="Start working this activity — the customer is auto-texted that an agent is on it."
            >
              <Hand className="h-3.5 w-3.5" /> Start activity
            </button>
          )}
          {(() => {
            // Profile deep-link — Client or Prospect depending on
            // what the activity is tied to. Hidden if neither is
            // set OR if the viewer isn't allowed to see the
            // referenced client (the agent might be viewing a
            // task spawned before reassignment).
            if (task.customerId) {
              const c = api.customers.get(task.customerId);
              if (c && api.customers.canSee(c, user ? { id: user.id, role: user.role } : undefined)) {
                return (
                  <Link to={`/employee/clients/${task.customerId}`} className="btn-primary text-xs inline-flex">
                    <User className="h-3.5 w-3.5" /> Go to client profile
                  </Link>
                );
              }
              return null;
            }
            if (task.prospectId) {
              return (
                <Link to={`/employee/prospects/${task.prospectId}`} className="btn-primary text-xs inline-flex">
                  <UserSearch className="h-3.5 w-3.5" /> Go to prospect profile
                </Link>
              );
            }
            return null;
          })()}
          {/* Required outbound actions before resolve unlocks. Both
              must be sent (the resolve gate enforces this). Once
              sent, the button shows a done state. */}
          {status === "in_progress" && task.customerId && (
            <>
              <button
                type="button"
                className={`text-xs ${
                  questionnaireSent
                    ? "btn-outline !border-emerald-300 !text-emerald-700"
                    : "btn-outline"
                }`}
                disabled={questionnaireSent}
                onClick={() => api.tasks.sendQuestionnaire(task.id, user?.id)}
                title={
                  questionnaireSent
                    ? "Questionnaire already sent"
                    : "Email the intake questionnaire to the customer"
                }
              >
                {questionnaireSent ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                {questionnaireSent ? "Questionnaire sent" : "Send questionnaire"}
              </button>
              <button
                type="button"
                className={`text-xs ${
                  esignDocsSent
                    ? "btn-outline !border-emerald-300 !text-emerald-700"
                    : "btn-outline"
                }`}
                disabled={esignDocsSent}
                onClick={() => api.tasks.sendEsignDocuments(task.id, user?.id)}
                title={
                  esignDocsSent
                    ? "Nothing waiting on the customer's e-signature, or already sent"
                    : "Email the customer the documents that need their e-signature — signed copies file themselves"
                }
              >
                {esignDocsSent ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {esignDocsSent ? "E-sign docs sent" : "Send documents requiring e-sign"}
              </button>
            </>
          )}
          {/* Mark resolved only renders for activities the agent
              has picked up. It stays locked until every AI
              checklist item is done (or a manager grants an
              override). Locked state opens the disclaimer modal. */}
          {status === "in_progress" && (
            <button
              type="button"
              className={`text-xs ${
                resolveBlocked
                  ? "btn-outline !border-alert-ring !text-alert"
                  : "btn-outline"
              }`}
              onClick={() => {
                // Blocked + agent → disclaimer (with request-
                // override button). Blocked + manager → same
                // disclaimer but with "Resolve anyway (override)"
                // CTA so the override is visible + audited.
                if (resolveBlocked && !overrideGranted) {
                  setDisclaimerOpen(true);
                  return;
                }
                api.tasks.markComplete(task.id, user?.id);
              }}
              title={
                resolveBlocked
                  ? viewerIsManager
                    ? `${resolveGate.missingSteps} checklist item${
                        resolveGate.missingSteps === 1 ? "" : "s"
                      } still pending — managers can override, click to confirm.`
                    : `Locked — click to see what the AI is still waiting on.`
                  : "Mark this activity resolved"
              }
            >
              {resolveBlocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {resolveBlocked
                ? viewerIsManager
                  ? overrideGranted
                    ? "Mark resolved"
                    : "Mark resolved (override)"
                  : "Mark resolved (locked)"
                : "Mark resolved"}
            </button>
          )}
          {status === "in_progress" && resolveBlocked && task.customerId && missingDocCount > 0 && (
            <Link
              to={`/employee/clients/${task.customerId}#client-doc-uploader`}
              className="btn-outline text-xs !border-alert-ring !text-alert hover:!bg-alert-soft"
              title="Open the client's Documents card to upload the required files"
            >
              <FileText className="h-3.5 w-3.5" /> Upload {missingDocCount} missing doc
              {missingDocCount === 1 ? "" : "s"}
            </Link>
          )}
          {overrideRequested && viewerIsManager && (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                if (!user) return;
                if (
                  !confirm(
                    `Grant manager override?\n\nThe agent will be able to mark this activity resolved without finishing the AI checklist. The override${
                      task.overrideReason ? ` (reason: ${task.overrideReason})` : ""
                    } is recorded in the audit trail.`
                  )
                )
                  return;
                api.tasks.grantManagerOverride(task.id, user.id);
                // Clear the matching broadcast so it stops pumping the badge.
                const notif = api.aiNotifications
                  .listUnacked(task.tenantId)
                  .find((n) => n.kind === "override_request" && n.taskId === task.id);
                if (notif) api.aiNotifications.acknowledge(notif.id, user.id);
              }}
              title="Agent requested an override. Grant it to unlock their Mark resolved button."
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Grant override
            </button>
          )}
          {overrideRequested && !viewerIsManager && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-500 px-2 py-1 rounded bg-ink-50 border border-ink-100">
              <Clock className="h-3 w-3" /> Override requested
            </span>
          )}
          {overrideGranted && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 px-2 py-1 rounded bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="h-3 w-3" /> Override granted
            </span>
          )}
          {task.awaitingManagerAssignment && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-amber-700 px-2 py-1 rounded bg-amber-50 border border-amber-200"
              title={
                viewerIsManager
                  ? "An agent sent this for you to assign. Use Reassign to route it."
                  : "Sent to a manager to assign."
              }
            >
              <UserCog className="h-3 w-3" /> Awaiting manager assignment
            </span>
          )}
          {myReminders.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-blue-700 px-2 py-1 rounded bg-blue-50 border border-blue-200"
              title={
                myReminders[0].note
                  ? `Reminder: ${myReminders[0].note}`
                  : "Personal reminder set"
              }
            >
              <Bell className="h-3 w-3" /> Reminder · {fmt.dateTime(myReminders[0].remindAt)}
            </span>
          )}
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setReminderOpen(true)}
            title="Schedule a private reminder. The activity stays open in everyone's queue — only you get pinged."
          >
            <Bell className="h-3.5 w-3.5" /> Set personal reminder
          </button>
          {/* Importance: collapsed by default into a single button
              showing the current level. Clicking expands inline to
              the three options (matching the same icons used for the
              top-left severity indicator: Info / AlertTriangle /
              AlertCircle). Picking an option saves + collapses. */}
          {(() => {
            const levels = [
              {
                value: "info" as const,
                label: "Low",
                color: "text-yellow-600",
                activeBg: "bg-yellow-50 border-yellow-300",
              },
              {
                value: "warning" as const,
                label: "Medium",
                color: "text-amber-600",
                activeBg: "bg-amber-50 border-amber-300",
              },
              {
                value: "urgent" as const,
                label: "High",
                color: "text-alert",
                activeBg: "bg-alert-soft border-alert-ring",
              },
            ];
            const current = levels.find((l) => l.value === severity) ?? levels[0];
            const Icon =
              current.value === "urgent"
                ? AlertCircle
                : current.value === "warning"
                ? AlertTriangle
                : Info;
            if (!importanceOpen) {
              const aiGraded =
                !task.severityChangedById && !!task.severityReason;
              return (
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => setImportanceOpen(true)}
                  title={
                    aiGraded
                      ? `AI graded ${current.label}: ${task.severityReason}`
                      : "Change importance — click to see all three levels."
                  }
                >
                  <Icon className={`h-3.5 w-3.5 ${current.color}`} /> Importance:{" "}
                  <span className={current.color}>{current.label}</span>
                  {aiGraded && (
                    <Sparkles className="h-3 w-3 text-violet-500" />
                  )}
                  <ChevronDown className="h-3 w-3" />
                </button>
              );
            }
            return (
              <div
                className="inline-flex items-stretch rounded-md border border-ink-200 overflow-hidden text-xs"
                role="group"
                aria-label="Set importance"
              >
                {levels.map((l) => {
                  const active = severity === l.value;
                  const LevelIcon =
                    l.value === "urgent"
                      ? AlertCircle
                      : l.value === "warning"
                      ? AlertTriangle
                      : Info;
                  return (
                    <button
                      key={l.value}
                      type="button"
                      className={`px-2.5 py-1 inline-flex items-center gap-1.5 border-r border-ink-200 last:border-r-0 ${
                        active
                          ? `${l.activeBg} font-medium`
                          : "bg-white hover:bg-ink-50"
                      }`}
                      onClick={() => {
                        api.tasks.setSeverity(task.id, l.value, user?.id);
                        setImportanceOpen(false);
                      }}
                      aria-pressed={active}
                      title={`Set importance to ${l.label}`}
                    >
                      <LevelIcon className={`h-3.5 w-3.5 ${l.color}`} />
                      <span className={active ? l.color : "text-ink-700"}>{l.label}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="px-2 py-1 inline-flex items-center justify-center bg-ink-50 hover:bg-ink-100 text-ink-500"
                  onClick={() => setImportanceOpen(false)}
                  title="Collapse"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })()}
          {(task.priorityRank ?? 0) !== 1 ? (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => api.tasks.moveToFront(task.id, user?.id)}
              title="Pin this activity to the top of the list"
            >
              <ArrowUpToLine className="h-3.5 w-3.5" /> Move to top
            </button>
          ) : (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => api.tasks.clearPriority(task.id, user?.id)}
              title="Unpin from the top"
            >
              <ArrowUpToLine className="h-3.5 w-3.5" /> Unpin
            </button>
          )}
          {(task.priorityRank ?? 0) !== -1 ? (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => api.tasks.moveToBack(task.id, user?.id)}
              title="Send this activity to the bottom of the list"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" /> Move to bottom
            </button>
          ) : (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => api.tasks.clearPriority(task.id, user?.id)}
              title="Restore default position"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" /> Restore
            </button>
          )}
          {viewerIsManager ? (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setReassignOpen(true)}
              title="Reassign to a different agent (manager only)"
            >
              <UserCog className="h-3.5 w-3.5" /> Reassign
            </button>
          ) : (
            <button
              type="button"
              className={`btn-outline text-xs ${
                task.reassignRequestedAt ? "!border-amber-300 !text-amber-700" : ""
              }`}
              onClick={() => setRequestReassignOpen(true)}
              title="Ask a manager to move this activity to another agent"
            >
              <UserCog className="h-3.5 w-3.5" />
              {task.reassignRequestedAt ? "Reassignment requested" : "Request reassignment"}
            </button>
          )}
        </div>
        {viewerIsManager && (
          <ReassignModal
            open={reassignOpen}
            onClose={() => setReassignOpen(false)}
            task={task}
            agents={agents}
            actorId={user?.id}
          />
        )}
        {!viewerIsManager && (
          <RequestReassignModal
            open={requestReassignOpen}
            onClose={() => setRequestReassignOpen(false)}
            task={task}
            agents={agents}
            actorId={user?.id}
          />
        )}
        {user && (
          <SetReminderModal
            open={reminderOpen}
            onClose={() => setReminderOpen(false)}
            task={task}
            userId={user.id}
          />
        )}
      </div>

      <ResolveDisclaimerModal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        task={task}
        checklist={checklist}
        currentUserId={user?.id ?? null}
        viewerIsManager={viewerIsManager}
        onManagerResolve={() => {
          logManagerOverride(task, resolveGate.missingSteps, user?.id);
          api.tasks.markComplete(task.id, user?.id);
          setDisclaimerOpen(false);
        }}
      />
    </div>
  );
}

// =====================================================================
// Resolution-checklist disclaimer.
//
// Pops when an agent clicks a locked Mark resolved button. Shows
// the AI's checklist with each pending step explained, plus a
// "Request manager override" button that drops a notification on
// the manager's Activity Center.
// =====================================================================

function ResolveDisclaimerModal({
  open,
  onClose,
  task,
  checklist,
  currentUserId,
  viewerIsManager,
  onManagerResolve,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
  checklist: { label: string; detail: string; done: boolean }[];
  currentUserId: string | null;
  viewerIsManager: boolean;
  onManagerResolve: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const pending = checklist.filter((s) => !s.done);
  const alreadyRequested = !!task.overrideRequestedAt && !task.overrideGrantedAt;

  function requestOverride() {
    if (!currentUserId) return;
    api.tasks.requestManagerOverride(task.id, currentUserId, reason.trim() || undefined);
    setSubmitted(true);
  }

  const title = viewerIsManager
    ? "Resolve before checklist is complete?"
    : "Mark resolved is locked";

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <p className="text-sm text-ink-700">
        {viewerIsManager
          ? `${pending.length} checklist item${
              pending.length === 1 ? "" : "s"
            } still pending. As a manager you can resolve anyway — the bypass is recorded in the audit trail. The list below shows what the AI was waiting on.`
          : "The AI hasn't seen all the steps it expects before this activity can be marked resolved. Knock out the remaining items below, or ask a manager to override."}
      </p>

      <ul className="mt-4 space-y-2">
        {checklist.map((step, i) => (
          <li
            key={i}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              step.done
                ? "border-emerald-200 bg-emerald-50/60"
                : "border-alert-ring bg-alert-soft/60"
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <Lock className="h-4 w-4 text-alert shrink-0 mt-0.5" />
            )}
            <div className="text-xs">
              <div
                className={`font-medium ${
                  step.done ? "text-emerald-900" : "text-ink-900"
                }`}
              >
                {step.label}
              </div>
              <div className={step.done ? "text-emerald-700" : "text-ink-600"}>
                {step.detail}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {viewerIsManager && (
        <div className="mt-5 rounded-md border border-alert-ring bg-alert-soft/60 p-3">
          <div className="text-xs uppercase tracking-wider text-alert font-semibold mb-1 flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> Manager override
          </div>
          <p className="text-xs text-ink-700 mb-3">
            Resolving now bypasses the AI checklist. A
            <code className="px-1 mx-0.5 rounded bg-ink-100">task.manager_override</code>
            audit row is written with your user id + the pending-step count so the bypass is
            traceable.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-outline text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-gold text-sm"
              onClick={onManagerResolve}
              disabled={pending.length === 0}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve anyway (override)
            </button>
          </div>
        </div>
      )}

      {!viewerIsManager && !submitted && !alreadyRequested && (
        <div className="mt-5 rounded-md border border-ink-100 bg-ink-50/60 p-3">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            Request manager override
          </div>
          <p className="text-xs text-ink-600 mb-2">
            If the remaining items legitimately don't apply, ask your manager to grant a one-time
            override. They'll see this in their Activity Center labeled{" "}
            <em>"Agent requested manager override"</em> and can inspect from there.
          </p>
          <textarea
            className="input text-sm min-h-[60px]"
            placeholder="(Optional) Tell the manager why the remaining steps don't apply…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button type="button" className="btn-outline text-sm" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn-gold text-sm"
              onClick={requestOverride}
              disabled={pending.length === 0}
            >
              <Sparkles className="h-3.5 w-3.5" /> Request manager override
            </button>
          </div>
        </div>
      )}

      {(submitted || alreadyRequested) && (
        <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-medium">Override request sent.</div>
          <p className="text-xs mt-1">
            Your manager will see "Agent requested manager override" in their Activity Center.
            Once granted, the Mark resolved button on this card unlocks for you.
          </p>
          <div className="mt-3 text-right">
            <button type="button" className="btn-primary text-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------

// One-line summary shown in the collapsed activity bar. We lead
// with the topic + client so the agent has the most-decision-
// relevant context at a glance, then trail with the carrier when
// known.
// Persists a manager-override audit row so the missing-docs
// gate bypass is traceable in api.tasks.history.
function logManagerOverride(task: Task, missingDocCount: number, actorId?: string) {
  api.tasks.logManagerOverride(task.id, actorId, {
    overrideKind: "missing_docs_gate",
    missingDocCount,
  });
}

function compactSummary(
  task: Task,
  customerName: string | undefined,
  carrierName: string | undefined,
  prospectName?: string | undefined
): string {
  const subject = customerName ?? prospectName;
  // Routing-driven activities ("New prospect assigned: …") and
  // override requests already carry a descriptive title; using
  // their topic ("other") would collapse to "Activity — —".
  // Prefer task.title in those cases.
  const topic = task.topic && task.topic !== "other" ? compactTopicLabel(task.topic) : null;
  if (!topic) {
    if (subject && !task.title.toLowerCase().includes(subject.toLowerCase())) {
      return `${task.title} — ${subject}`;
    }
    return task.title;
  }
  const who = subject ?? "—";
  const where = carrierName ? ` · ${carrierName}` : "";
  return `${topic} — ${who}${where}`;
}

// Maps an AssetType to "Personal lines" / "Commercial lines"
// for the routing pills. All current asset types are personal-
// lines categories in the seeded private-client book; the function
// stays defensive for future commercial-lines AssetTypes.
function prospectLineLabel(t: import("@/types").AssetType): "Personal lines" | "Commercial lines" {
  const commercial: import("@/types").AssetType[] = []; // placeholder for future commercial types
  return commercial.includes(t) ? "Commercial lines" : "Personal lines";
}

function compactTopicLabel(t: NonNullable<Task["topic"]>): string {
  const map: Record<string, string> = {
    policy_edit_request: "Policy edit request",
    coverage_change: "Coverage change",
    cancellation_request: "Cancellation request",
    claim_status: "Claim status update",
    claim_filed: "Claim filed",
    renewal_approaching: "Renewal approaching",
    payment_issue: "Payment issue",
    document_upload: "Document upload",
    endorsement_request: "Endorsement request",
    coverage_gap: "Coverage gap",
    other: "Activity",
  };
  return map[t] ?? "Activity";
}

// "Handle time" — duration between Started and Resolved. Renders
// compactly as "1h 12m", "3m", "2d 4h" etc.
function durationLabel(fromIso: string, toIso: string): string {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (hours < 24) return m ? `${hours}h ${m}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days}d ${h}h` : `${days}d`;
}

function SeverityBar({ severity }: { severity: "urgent" | "warning" | "info" }) {
  const color =
    severity === "urgent"
      ? "bg-alert"
      : severity === "warning"
      ? "bg-amber-500"
      : "bg-yellow-300";
  return <div className={`w-1 ${color} shrink-0`} />;
}

function SeverityIcon({ severity }: { severity: "urgent" | "warning" | "info" }) {
  if (severity === "urgent") return <AlertCircle className="h-4 w-4 text-alert shrink-0 mt-0.5" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />;
  return <Info className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />;
}

function StatusChip({ status }: { status: TaskStatus }) {
  const tone =
    status === "in_progress" ? "info"
    : status === "snoozed" ? "warn"
    : status === "resolved" ? "success"
    : "neutral";
  const label =
    status === "in_progress" ? "In progress"
    : status === "snoozed" ? "Snoozed"
    : status === "resolved" ? "Resolved"
    : "Open";
  return <Badge tone={tone}>{label}</Badge>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right truncate min-w-0">{value}</dd>
    </div>
  );
}

function CarrierLogo({
  carrier,
  AssetIcon,
}: {
  carrier?: { name: string; logoUrl?: string } | undefined;
  AssetIcon: React.ComponentType<{ className?: string }>;
}) {
  if (carrier?.logoUrl) {
    return (
      <div className="h-10 w-10 shrink-0 rounded-md bg-white border border-ink-100 flex items-center justify-center overflow-hidden">
        <img src={carrier.logoUrl} alt={carrier.name} className="max-h-9 max-w-9 object-contain" />
      </div>
    );
  }
  const initials =
    carrier?.name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() ?? "—";
  return (
    <div className="h-10 w-10 shrink-0 rounded-md bg-gold-50 border border-gold-200 flex flex-col items-center justify-center text-gold-700">
      <AssetIcon className="h-3.5 w-3.5" />
      <span className="text-[9px] font-semibold mt-0.5 tracking-wider">{initials}</span>
    </div>
  );
}

function CarrierPortalLink({
  carrier,
  viewerIsManager,
  onAdded,
}: {
  carrier: { id: string; name: string; agentPortalUrl?: string };
  viewerIsManager: boolean;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  if (carrier.agentPortalUrl) {
    return (
      <a
        href={carrier.agentPortalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-gold text-xs inline-flex"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Go to {carrier.name} Agent Portal
        <Building2 className="h-3.5 w-3.5 opacity-50" />
      </a>
    );
  }
  if (!viewerIsManager) {
    return (
      <div className="text-[11px] text-ink-400 italic">
        No agent portal URL configured for {carrier.name}. Ask a manager to add one under Master → Carriers.
      </div>
    );
  }
  if (!adding) {
    return (
      <button
        type="button"
        className="btn-outline text-xs"
        onClick={() => setAdding(true)}
        title="Add the carrier's agent-login URL (manager only)"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Add carrier portal link for {carrier.name}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input
        type="url"
        autoFocus
        placeholder="https://..."
        className="input text-xs max-w-md"
        value={draftUrl}
        onChange={(e) => setDraftUrl(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={!draftUrl.trim()}
        onClick={() => {
          api.carriers.update(carrier.id, { agentPortalUrl: draftUrl.trim() });
          setAdding(false);
          setDraftUrl("");
          onAdded();
        }}
      >
        Save
      </button>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          setAdding(false);
          setDraftUrl("");
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="label text-[11px]">{label}</label>
      <select
        className="input !py-1.5 !text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}