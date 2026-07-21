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
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Gem,
  GripVertical,
  Hand,
  Home,
  Info,
  ListTodo,
  Package,
  Plus,
  RotateCcw,
  Sparkles,
  Umbrella,
  User,
  UserCog,
  UserSearch,
  Workflow,
  X,
} from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CountBadge } from "@/components/ui/CountBadge";
import { Modal } from "@/components/ui/Modal";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { CustomMessageComposer } from "@/components/marketing/CustomMessageComposer";
import { SetReminderModal } from "@/components/tasks/SetReminderModal";
import { ReassignModal } from "@/components/tasks/ReassignModal";
import { RequestReassignModal } from "@/components/tasks/RequestReassignModal";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useIntegrationNotice } from "@/lib/integrationNotice";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { fmt } from "@/lib/format";
import {
  isRoutingManagerRole,
  routableStaff,
  staffRoleLabel,
} from "@/lib/roles";
import { subscribeToDbChanges } from "@/lib/db";
import {
  newestOpenQuotingSessionsPerContact,
  summarizeQuotingWorkflow,
} from "@/lib/quotingWorkflows";
import { isRoutingAssignmentTask } from "@/lib/taskFilters";
import type {
  AssetType,
  CustomerProfile,
  Prospect,
  QuoteRequest,
  Task,
  TaskStatus,
  User as UserType,
} from "@/types";
import type { QuotingWorkflowSummary } from "@/lib/quotingWorkflows";

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
type DropEdge = "before" | "after";

interface QuotingWorkflowRow {
  id: string;
  contactKey: string;
  kind: "ai_session" | "incomplete_customer_quote";
  summary: QuotingWorkflowSummary;
  contactName: string;
  contactKind: "Client" | "Prospect" | "Contact";
  href: string;
  ownerLabel: string;
  assetLabel: string;
  lineLabel: "Personal" | "Commercial";
  updatedAt: string;
  completedAt?: string;
  task?: Task;
  quote?: QuoteRequest;
}

function quoteWorkspaceDeepLink(path: string): string {
  return `${path.replace(/\/$/, "")}/quote-flow`;
}

export function TasksPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const showIntegrationNotice = useIntegrationNotice();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  useEffect(() => subscribeToDbChanges(refresh), []);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [carrierFilter, setCarrierFilter] = useState<string>("all");
  // Manager-only "whose queue am I viewing?" picker. Defaults to
  // "me" so a manager lands on their own work first; they can
  // switch to a specific agent's service queue or "all" for broad oversight.
  // For agents this is forced to "me" via the visibleIds gate.
  const [managerView, setManagerView] = useState<string>("me");
  // Composer state for the Reply-to-Customer flow.
  const [replyTask, setReplyTask] = useState<Task | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [createActivityOpen, setCreateActivityOpen] = useState(false);
  const [createQuoteFlowOpen, setCreateQuoteFlowOpen] = useState(false);
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
    if (!focusedTaskId || !agency || !user || !isRoutingManagerRole(user.role)) return;
    const t = api.tasks.listByTenant(agency.id).find((x) => x.id === focusedTaskId);
    if (!t) return;
    const owner =
      t.assignedToId && t.assignedToId !== user.id
        ? t.assignedToId
        : t.additionalAssignedToIds?.find((id) => id !== user.id) ?? t.assignedToId ?? "";
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
    // AI triage of inbound messages opens activities only for owned work.
    api.communications.sweepInboundForActivities(agency.id, user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id, user?.id]);

  if (!agency || !user) return null;

  const viewer = { id: user.id, role: user.role };
  const visibleIds = new Set(
    api.customers.listVisible(agency.id, viewer).map((c) => c.id)
  );
  const isManager = isRoutingManagerRole(user.role);
  const agents = routableStaff(api.users.list(agency.id), agency.id);
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
  // A row's effective owners. Explicit task assignees win; otherwise an
  // activity tied to a client that already has an assigned agent
  // belongs to that agent (so the manager never sees assigned-clients'
  // work as unrouted in their own queue). Falls back to "" (unowned).
  function isRoutingFollowUpTask(t: Task): boolean {
    return isRoutingAssignmentTask(t);
  }

  function uniqueIds(ids: Array<string | undefined>): string[] {
    return Array.from(new Set(ids.filter((id): id is string => !!id)));
  }

  function contactOwnerIds(row: { customerId?: string; prospectId?: string }): string[] {
    if (row.customerId) {
      const c = api.customers.get(row.customerId);
      if (c) return uniqueIds([
        c.assignedAgentId,
        ...(c.additionalAgentIds ?? []),
        c.assignedCsrId,
      ]);
    }
    if (row.prospectId) {
      const p = api.prospects.get(row.prospectId);
      if (p) return uniqueIds([
        p.assignedAgentId,
        ...(p.additionalAgentIds ?? []),
        p.assignedCsrId,
      ]);
    }
    return [];
  }

  function effectiveOwnerIds(row: {
    assignedToId?: string;
    additionalAssignedToIds?: string[];
    customerId?: string;
    prospectId?: string;
    title?: string;
  }): string[] {
    if (row.title && isRoutingFollowUpTask(row as Task)) {
      const contactOwners = contactOwnerIds(row);
      return contactOwners.length > 0
        ? contactOwners
        : uniqueIds([row.assignedToId, ...(row.additionalAssignedToIds ?? [])]);
    }
    const taskOwners = uniqueIds([row.assignedToId, ...(row.additionalAssignedToIds ?? [])]);
    return taskOwners.length > 0 ? taskOwners : contactOwnerIds(row);
  }

  function inSelectedQueue<
    T extends {
      assignedToId?: string;
      additionalAssignedToIds?: string[];
      customerId?: string;
      prospectId?: string;
      title?: string;
    }
  >(
    rows: T[]
  ): T[] {
    if (queueAgentId == null) return rows;
    return rows.filter((r) => effectiveOwnerIds(r).includes(queueAgentId));
  }

  function visibleOnManagerBoard(t: Task): boolean {
    if (!isManager || !isRoutingFollowUpTask(t)) return true;
    // Assignment follow-ups belong to the assignee. They should not
    // land in the manager's own queue; managers can still inspect them
    // through "All" or a specific agent queue.
    if (queueAgentId === viewer.id) return false;
    return true;
  }

  // Active = open + in_progress + snoozed (we still surface
  // snoozed ones in a collapsible band below). Resolved tasks go
  // to the bottom card.
  const openTasks = inSelectedQueue(
    api.tasks
      .listOpen(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
      .filter(visibleOnManagerBoard)
      // Activities an agent punted to a manager live in the Routing
      // card (below), not the To-do board.
      .filter((t) => !t.awaitingManagerAssignment)
  );
  const snoozedTasks = inSelectedQueue(
    api.tasks
      .listSnoozed(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
      .filter(visibleOnManagerBoard)
  );
  const completedTasks = inSelectedQueue(
    api.tasks
      .listCompleted(agency.id)
      .filter((t) => !t.customerId || visibleIds.has(t.customerId))
      .filter(visibleOnManagerBoard)
  );

  // Manager-only routing surface: prospects + clients in the
  // tenant with no assigned agent. The manager can assign each
  // one to a specific agent (or themselves) inline.
  const unroutedProspects = isManager
    ? api.prospects
        .listByTenant(agency.id)
        .filter((p) => !p.assignedAgentId)
    : [];
  const unroutedClients = isManager
    ? api.customers
        .list(agency.id)
        .filter((c) => !c.assignedAgentId)
    : [];
  // Activities an agent handed to a manager to assign — surfaced
  // tenant-wide in the Routing card so any manager can pick them up.
  const awaitingActivities = isManager
    ? api.tasks.listOpen(agency.id).filter((t) => t.awaitingManagerAssignment)
    : [];

  const tenantQuotingSessions = api.quoting.listByTenant(agency.id);
  const visibleOpenSessionIds = new Set(
    newestOpenQuotingSessionsPerContact(tenantQuotingSessions).map((session) => session.id)
  );
  const aiWorkflowRows = tenantQuotingSessions
    .map((session): QuotingWorkflowRow | null => {
      const summary = summarizeQuotingWorkflow(session);
      const customer = session.customerId ? api.customers.get(session.customerId) : undefined;
      const prospect = session.prospectId ? api.prospects.get(session.prospectId) : undefined;
      if (session.customerId && !api.customers.canSee(customer, viewer)) return null;
      if (session.prospectId && !prospect) return null;
      if (session.prospectId && !api.prospects.canSee(prospect, viewer)) return null;
      const ownerIds = effectiveOwnerIds({
        assignedToId: session.createdById,
        customerId: session.customerId,
        prospectId: session.prospectId,
      });
      const ownerLabel =
        ownerIds
          .map((id) => api.users.get(id)?.name)
          .filter((name): name is string => !!name)
          .join(", ") || "Unassigned";
      const asset = session.assetId ? api.assets.get(session.assetId) : undefined;
      const contactName = customer?.name ?? prospect?.name ?? "Unknown contact";
      const contactKind = customer ? "Client" : prospect ? "Prospect" : "Contact";
      const href = customer
        ? quoteWorkspaceDeepLink(`/employee/clients/${customer.id}`)
        : prospect
        ? quoteWorkspaceDeepLink(`/employee/prospects/${prospect.id}`)
        : "/employee/tasks";
      const implementedAt = session.quotes.find((quote) => quote.implementation?.implementedAt)?.implementation
        ?.implementedAt;
      return {
        id: session.id,
        contactKey: customer
          ? `customer:${customer.id}`
          : prospect
          ? `prospect:${prospect.id}`
          : `session:${session.id}`,
        kind: "ai_session",
        summary,
        contactName,
        contactKind,
        href,
        ownerLabel,
        assetLabel: asset ? assetDisplayName(asset) : api.helpers.assetTypeLabel(session.assetType),
        lineLabel: session.lineOfBusiness === "commercial" ? "Commercial" : "Personal",
        updatedAt: session.updatedAt,
        completedAt: implementedAt,
      };
    })
    .filter((row): row is QuotingWorkflowRow => !!row);

  const activeAiWorkflowRows = aiWorkflowRows.filter(
    (row) => !row.summary.isClosed && visibleOpenSessionIds.has(row.id)
  );
  const completedWorkflowRows = aiWorkflowRows
    .filter((row) => row.summary.isClosed)
    .sort((a, b) => {
      const at = a.completedAt ?? a.updatedAt;
      const bt = b.completedAt ?? b.updatedAt;
      return at < bt ? 1 : -1;
    });

  const incompleteWorkflowRows = api.quotes
    .listIncompleteWorkflows(agency.id)
    .filter((quote) => !visibleOpenSessionIds.has(quote.quoteSessionId ?? ""))
    .filter((quote) => {
      const contactHasOpenSession = tenantQuotingSessions.some(
        (session) =>
          visibleOpenSessionIds.has(session.id) && session.customerId === quote.customerId
      );
      return !contactHasOpenSession;
    })
    .map((quote): QuotingWorkflowRow | null => {
      const customer = api.customers.get(quote.customerId);
      if (!api.customers.canSee(customer, viewer)) return null;
      const ownerIds = effectiveOwnerIds({
        assignedToId: quote.assignedAgentId ?? customer?.assignedAgentId,
        customerId: quote.customerId,
      });
      const ownerLabel =
        ownerIds
          .map((id) => api.users.get(id)?.name)
          .filter((name): name is string => !!name)
          .join(", ") || "Unassigned";
      const categoryLabel = quote.categoryLabel ?? api.helpers.assetTypeLabel(quote.assetType);
      const stoppedAt = quote.currentStep ?? "quote intake";
      return {
        id: quote.id,
        contactKey: `customer:${quote.customerId}`,
        kind: "incomplete_customer_quote",
        quote,
        task: quote.recoveryTaskId ? api.tasks.get(quote.recoveryTaskId) : undefined,
        summary: {
          stage: "Needs follow-up",
          tone: "warn",
          detail: `${customer?.name ?? "Customer"} started a ${categoryLabel} quote and stopped at ${stoppedAt}.`,
          blocker: "AI follow-up draft ready.",
          progress: quote.completionPercent ?? 40,
          acceptedCount: 0,
          waitingCount: 1,
          quoteCount: 0,
          implemented: false,
          isClosed: false,
          sortPriority: 5,
        },
        contactName: customer?.name ?? "Unknown customer",
        contactKind: "Client",
        href: customer
          ? quoteWorkspaceDeepLink(`/employee/clients/${customer.id}`)
          : "/employee/tasks",
        ownerLabel,
        assetLabel: categoryLabel,
        lineLabel: quote.lineOfBusiness === "commercial" ? "Commercial" : "Personal",
        updatedAt: quote.lastTouchedAt ?? quote.createdAt,
      };
    })
    .filter((row): row is QuotingWorkflowRow => !!row);

  const seenWorkflowContacts = new Set<string>();
  const workflowRows = [...incompleteWorkflowRows, ...activeAiWorkflowRows]
    .sort((a, b) => {
      if (a.summary.sortPriority !== b.summary.sortPriority) {
        return a.summary.sortPriority - b.summary.sortPriority;
      }
      return a.updatedAt < b.updatedAt ? 1 : -1;
    })
    .filter((row) => {
      if (seenWorkflowContacts.has(row.contactKey)) return false;
      seenWorkflowContacts.add(row.contactKey);
      return true;
    });

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
      const qa = a.queuePosition;
      const qb = b.queuePosition;
      if (qa != null || qb != null) {
        const va = qa ?? Number.MAX_SAFE_INTEGER;
        const vb = qb ?? Number.MAX_SAFE_INTEGER;
        if (va !== vb) return va - vb;
      }
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
      {focusedTaskId ? (
        <button
          type="button"
          className="btn-ghost -ml-2"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : (
        <EmployeeBackButton />
      )}
      <div>
        <div>
          <h1 className="font-display text-3xl">Activity Center</h1>
          <p className="text-ink-500 text-sm mt-1">
            {isManager
              ? "Route unrouted prospects + clients, inspect service activities, or work your own queue. Assignment follow-ups belong to the assignee; managers can inspect them by switching queues."
              : "AI actions taken on your behalf, plus the follow-ups you still owe. Each entry shows the customer's request, the policy in play, and a one-click link to the carrier's agent portal so you can service the change end-to-end."}
          </p>
        </div>
      </div>

      <CreateActivityModal
        open={createActivityOpen}
        onClose={() => setCreateActivityOpen(false)}
        tenantId={agency.id}
        viewer={{ id: user.id, role: user.role }}
        onCreated={refresh}
      />
      <CreateQuoteFlowModal
        open={createQuoteFlowOpen}
        onClose={() => setCreateQuoteFlowOpen(false)}
        tenantId={agency.id}
        viewer={viewer}
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
      <div className="flex items-end gap-3 flex-wrap">
          {(openTasks.length > 0 || snoozedTasks.length > 0 || isManager) && (
            <>
              {isManager && (
                <FilterSelect
                  label="Viewing queue"
                  value={managerView}
                  onChange={setManagerView}
                  options={[
                    { value: "me", label: `Me — ${user.name}` },
                    { value: "all", label: "All service activities" },
                    ...agents
                      .filter((a) => a.id !== user.id)
                      .map((a) => ({ value: a.id, label: `${a.name} (${staffRoleLabel(a.role)})` })),
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
            </>
          )}
          <button
            type="button"
            className="btn-gold text-sm shrink-0 ml-auto"
            onClick={() => setCreateActivityOpen(true)}
          >
            <Plus className="h-4 w-4" /> Create new activity
          </button>
      </div>

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
      <QuotingWorkflowsPanel
        rows={workflowRows}
        onStartReply={startReply}
        onCreateQuoteFlow={() => setCreateQuoteFlowOpen(true)}
      />

      <CompletedSection
        tasks={completedTasks}
        workflows={completedWorkflowRows}
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

      {/* Reminder for the "add carrier portal" inline path */}
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
    workflows,
    onReopen,
    canSee: _canSee,
    customerLink: linkFor,
  }: {
    tasks: Task[];
    workflows: QuotingWorkflowRow[];
    onReopen: (id: string) => void;
    canSee: (id?: string) => boolean;
    customerLink: (id?: string) => React.ReactNode;
  }) {
    const [open, setOpen] = useState(false);
    const total = tasks.length + workflows.length;
    return (
      <Card>
        <CardHeader
          title={`Resolved (${total})`}
          subtitle="Closed activities and completed quote flows. Reopen an activity if you need to revisit one."
          action={
            <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show"}
            </button>
          }
        />
        {open && (
          total === 0 ? (
            <div className="text-sm text-ink-400">No resolved activities or completed quote flows yet.</div>
          ) : (
            <div className="space-y-5">
            {tasks.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Completed activities
              </div>
              <ul className="divide-y divide-ink-100 rounded-md border border-ink-100 bg-white">
              {tasks.map((t) => (
                <li key={t.id} className="px-3 py-3 flex items-start justify-between gap-3">
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
            </div>
            )}
            {workflows.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Completed quote flows
                </div>
                <ul className="divide-y divide-ink-100 rounded-md border border-ink-100 bg-white">
                  {workflows.map((row) => (
                    <li
                      key={row.id}
                      className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-ink-800">
                            {row.contactName}
                          </span>
                          <Badge tone="success">{row.summary.stage}</Badge>
                          <Badge tone={row.lineLabel === "Commercial" ? "gold" : "info"}>
                            {row.lineLabel}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-ink-500">
                          {row.assetLabel} · Owner: {row.ownerLabel}
                        </div>
                      </div>
                      <div className="min-w-0 text-xs text-ink-600">
                        <div>{row.summary.detail}</div>
                        <div className="mt-1 text-[11px] text-ink-400">
                          Completed {fmt.dateTime(row.completedAt ?? row.updatedAt)}
                          {row.summary.quoteCount > 0 && <> · {row.summary.quoteCount} ranked</>}
                        </div>
                      </div>
                      <Link to={row.href} className="btn-outline text-xs justify-center">
                        <ExternalLink className="h-3.5 w-3.5" /> Open
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </div>
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

function QuotingWorkflowsPanel({
  rows,
  onStartReply,
  onCreateQuoteFlow,
}: {
  rows: QuotingWorkflowRow[];
  onStartReply: (t: Task) => void;
  onCreateQuoteFlow: () => void;
}) {
  const readyCount = rows.filter(
    (row) => row.summary.stage === "Ranking ready" || row.summary.stage === "Accepted ranking live"
  ).length;
  const incompleteCount = rows.filter((row) => row.kind === "incomplete_customer_quote").length;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Workflow className="h-5 w-5 text-gold-700" />
            Quote flows
            <CountBadge
              value={rows.length}
              tone={rows.length > 0 ? "gold" : "neutral"}
              title={`${rows.length} active quote flow${rows.length === 1 ? "" : "s"}`}
            />
          </span>
        }
        subtitle="Live AI quoting sessions. Accepted commercial markets can rank here while supplemental questions are still out."
        action={
          <button
            type="button"
            className="btn-gold text-sm"
            onClick={onCreateQuoteFlow}
          >
            <Plus className="h-4 w-4" /> Create new quote flow
          </button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No active quote flows"
          description="When an agent starts an AI quote, it will appear here until the ranking is reviewed."
          icon={<Workflow className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <WorkflowMetric label="In session" value={rows.length} />
            <WorkflowMetric label="Incomplete customer quotes" value={incompleteCount} tone="warn" />
            <WorkflowMetric label="Ranking visible" value={readyCount} tone="success" />
          </div>

          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(12rem,0.9fr)_minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-ink-900 truncate">
                      {row.contactName}
                    </span>
                    <Badge tone="neutral">{row.contactKind}</Badge>
                    <Badge tone={row.lineLabel === "Commercial" ? "gold" : "info"}>
                      {row.lineLabel}
                    </Badge>
                    {row.kind === "incomplete_customer_quote" && (
                      <Badge tone="warn">Customer stopped</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-ink-500 truncate">
                    {row.assetLabel} · Owner: {row.ownerLabel}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={row.summary.tone}>{row.summary.stage}</Badge>
                    <span className="text-[11px] text-ink-400">
                      {fmt.relative(row.updatedAt)} ago
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={`h-full rounded-full ${
                        row.summary.tone === "success" ? "bg-emerald-500" : "bg-gold-500"
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, row.summary.progress))}%` }}
                    />
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-xs text-ink-700">{row.summary.detail}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    <span>{row.summary.blocker}</span>
                    {row.summary.acceptedCount > 0 && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                        {row.summary.acceptedCount} accepted
                      </span>
                    )}
                    {row.summary.waitingCount > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                        {row.summary.waitingCount} waiting
                      </span>
                    )}
                    {row.summary.quoteCount > 0 && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {row.summary.quoteCount} ranked
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {row.task && (
                    <button
                      type="button"
                      className="btn-gold text-xs"
                      onClick={() => onStartReply(row.task!)}
                    >
                      Send to client
                    </button>
                  )}
                  <Link to={row.href} className="btn-primary text-xs inline-flex justify-center">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

type QuoteFlowTarget = {
  id: string;
  name: string;
  kind: "Client" | "Prospect";
  email?: string;
  lineLabel: "Personal" | "Commercial";
  detail: string;
  href: string;
};

function CreateQuoteFlowModal({
  open,
  onClose,
  tenantId,
  viewer,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  viewer: { id: string; role: UserType["role"] };
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const targets = useMemo<QuoteFlowTarget[]>(() => {
    const clientRows = api.customers.listVisible(tenantId, viewer).map((client) =>
      quoteFlowClientTarget(client)
    );
    const prospectRows = api.prospects.listVisible(tenantId, viewer).map((prospect) =>
      quoteFlowProspectTarget(prospect)
    );
    return [...clientRows, ...prospectRows].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [tenantId, viewer.id, viewer.role, open]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTargets = normalizedQuery
    ? targets.filter((target) =>
        [
          target.name,
          target.kind,
          target.email ?? "",
          target.lineLabel,
          target.detail,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : targets;

  return (
    <Modal open={open} onClose={onClose} title="Create new quote flow" size="lg">
      <div className="space-y-4">
        <div>
          <label className="label">Choose a client or prospect</label>
          <div className="relative">
            <UserSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, line, asset, or business..."
              autoFocus
            />
          </div>
        </div>

        {visibleTargets.length === 0 ? (
          <EmptyState
            title="No matching records"
            description="A quote flow needs to start from a client or prospect profile."
            icon={<Workflow className="h-8 w-8" />}
          />
        ) : (
          <ul className="max-h-[440px] divide-y divide-ink-100 overflow-y-auto rounded-lg border border-ink-100 bg-white">
            {visibleTargets.map((target) => (
              <li key={`${target.kind}-${target.id}`}>
                <Link
                  to={target.href}
                  onClick={onClose}
                  className="grid gap-3 px-4 py-3 transition hover:bg-gold-50/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink-900">
                        {target.name}
                      </span>
                      <Badge tone="neutral">{target.kind}</Badge>
                      <Badge tone={target.lineLabel === "Commercial" ? "gold" : "info"}>
                        {target.lineLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {target.email ? `${target.email} · ` : ""}
                      {target.detail}
                    </div>
                  </div>
                  <span className="btn-primary text-xs justify-center">
                    <Sparkles className="h-3.5 w-3.5" /> Open AI workspace
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function quoteFlowClientTarget(client: CustomerProfile): QuoteFlowTarget {
  const assets = api.assets.listByCustomer(client.id);
  const lineLabel = client.lineOfBusiness === "commercial" ? "Commercial" : "Personal";
  const displayName =
    client.lineOfBusiness === "commercial" && client.businessName
      ? `${client.businessName} — ${client.name}`
      : client.name;
  const detail =
    assets.length > 0
      ? `${assets.length} asset${assets.length === 1 ? "" : "s"} on file`
      : "No assets on file yet";
  return {
    id: client.id,
    name: displayName,
    kind: "Client",
    email: client.email,
    lineLabel,
    detail,
    href: quoteWorkspaceDeepLink(`/employee/clients/${client.id}`),
  };
}

function quoteFlowProspectTarget(prospect: Prospect): QuoteFlowTarget {
  return {
    id: prospect.id,
    name: prospect.name,
    kind: "Prospect",
    email: prospect.email,
    lineLabel: prospect.lineOfBusiness === "commercial" ? "Commercial" : "Personal",
    detail: api.helpers.assetTypeLabel(prospect.assetType),
    href: quoteWorkspaceDeepLink(`/employee/prospects/${prospect.id}`),
  };
}

function WorkflowMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warn" | "success";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-ink-100 bg-ink-50 text-ink-800";
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

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
  contactKind?: "prospect" | "client";
  // Pre-checked agents when the modal opens. The manager can
  // add or remove agents before confirming. For prospects the
  // modal collapses to single-select (radio); for clients it's
  // multi-select (checkbox).
  preselected: string[];
  csrId?: string;
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
  // lets the manager add or remove co-owners before confirming.
  const [confirming, setConfirming] = useState<AssignIntent | null>(null);
  const routeRequests = activities.filter((task) => !!task.routeRequestKind);
  const activityHandoffs = activities.filter((task) => !task.routeRequestKind);
  const prospectRouteRequests = routeRequests.filter(
    (task) => task.routeRequestKind === "prospect" && !!task.prospectId
  );
  const clientRouteRequests = routeRequests.filter(
    (task) => task.routeRequestKind === "client" && !!task.customerId
  );

  function requestedAgentNames(t: Task): string[] {
    return (t.routeRequestToAgentIds ?? [])
      .map((id) => api.users.get(id)?.name)
      .filter((name): name is string => !!name);
  }

  function routeRequestLabel(t: Task): string {
    return t.routeRequestMode === "reroute" ? "Reroute request" : "Route request";
  }

  function routeRequestTags(t: Task): NonNullable<RoutingRow["tags"]> {
    const requestedAgents = requestedAgentNames(t);
    return [
      { label: routeRequestLabel(t), tone: t.routeRequestMode === "reroute" ? "amber" : "gold" },
      ...(requestedAgents.length > 0
        ? [
            {
              label: `Requested: ${requestedAgents.slice(0, 2).join(", ")}${
                requestedAgents.length > 2 ? ` +${requestedAgents.length - 2}` : ""
              }`,
              tone: "gold" as const,
            },
          ]
        : []),
    ];
  }

  function requestHint(t: Task, fallback?: string): string {
    const sender = t.createdById ? api.users.get(t.createdById)?.name : undefined;
    const requestedAgents = requestedAgentNames(t);
    if (sender && requestedAgents.length > 0) {
      return `Requested by ${sender} for ${requestedAgents.join(", ")}`;
    }
    if (sender) return `${routeRequestLabel(t)} from ${sender}`;
    return fallback ?? routeRequestLabel(t);
  }

  function taskRoutingRow(t: Task): RoutingRow {
    const sender = t.createdById ? api.users.get(t.createdById)?.name : undefined;
    const client = t.customerId ? api.customers.get(t.customerId) : undefined;
    const prospect = t.prospectId ? api.prospects.get(t.prospectId) : undefined;
    const contactName = client?.name ?? prospect?.name;
    const requestedAgents = requestedAgentNames(t);
    const tags: NonNullable<RoutingRow["tags"]> = t.routeRequestKind ? routeRequestTags(t) : [];
    if (t.severity)
      tags.push({
        label: t.severity === "urgent" ? "High" : t.severity === "warning" ? "Medium" : "Low",
        tone: t.severity === "urgent" ? "amber" : "neutral",
      });
    if (contactName) tags.push({ label: contactName, tone: "neutral" });
    const contactLink =
      t.routeRequestKind === "client" && t.customerId
        ? `/employee/clients/${t.customerId}`
        : t.routeRequestKind === "prospect" && t.prospectId
        ? `/employee/prospects/${t.prospectId}`
        : `/employee/tasks?focus=${t.id}`;
    return {
      id: t.id,
      name: t.routeRequestKind ? contactName ?? t.title : t.title,
      hint:
        sender && requestedAgents.length > 0
          ? `Requested by ${sender} for ${requestedAgents.join(", ")}`
          : sender
          ? `Handed off by ${sender}`
          : "Handed off for assignment",
      link: contactLink,
      tags,
      assignKind: "activity",
      assignId: t.id,
      contactKind: t.routeRequestKind,
      preselected: t.routeRequestToAgentIds ?? [],
      csrId: client?.assignedCsrId ?? prospect?.assignedCsrId,
    };
  }

  const prospectRows: RoutingRow[] = [
    ...prospects.map((p) => {
      const request = prospectRouteRequests.find((t) => t.prospectId === p.id);
      // Personal vs commercial isn't an explicit field on
      // Prospect - derive from the asset type. All current
      // asset types are personal lines for this private-
      // client record set; the helper returns a friendly
      // label either way.
      const line = prospectLineLabel(p.assetType);
      const tags: NonNullable<RoutingRow["tags"]> = [
        ...(request ? routeRequestTags(request) : [{ label: "Needs route", tone: "neutral" as const }]),
        { label: line, tone: line === "Personal lines" ? "gold" : "indigo" },
        { label: api.helpers.assetTypeLabel(p.assetType), tone: "neutral" },
      ];
      if (p.estimatedValue) {
        tags.push({ label: `~${fmt.money(p.estimatedValue)}`, tone: "neutral" });
      }
      return {
        id: p.id,
        name: p.name,
        hint: request ? requestHint(request, p.email) : p.email,
        link: `/employee/prospects/${p.id}`,
        tags,
        assignKind: request ? ("activity" as const) : undefined,
        assignId: request?.id,
        contactKind: request?.routeRequestKind,
        preselected: request?.routeRequestToAgentIds ?? [],
        csrId: p.assignedCsrId,
      };
    }),
    ...prospectRouteRequests
      .filter((t) => t.prospectId && !prospects.some((p) => p.id === t.prospectId))
      .map(taskRoutingRow),
  ];

  const clientRows: RoutingRow[] = [
    ...clients.map((c) => {
      const request = clientRouteRequests.find((t) => t.customerId === c.id);
      const policies = api.policies.listByCustomer(c.id);
      const tags: NonNullable<RoutingRow["tags"]> = [
        ...(request ? routeRequestTags(request) : [{ label: "Needs route", tone: "neutral" as const }]),
      ];
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
        hint: request ? requestHint(request, c.email) : c.email,
        link: `/employee/clients/${c.id}`,
        tags,
        assignKind: request ? ("activity" as const) : undefined,
        assignId: request?.id,
        contactKind: request?.routeRequestKind,
        preselected: request?.routeRequestToAgentIds ?? [],
        csrId: c.assignedCsrId,
      };
    }),
    ...clientRouteRequests
      .filter((t) => t.customerId && !clients.some((c) => c.id === t.customerId))
      .map(taskRoutingRow),
  ];

  const total = prospectRows.length + clientRows.length + activityHandoffs.length;
  const routingSummary =
    total === 0
      ? "No routing needed"
      : [
          `${prospectRows.length} ${prospectRows.length === 1 ? "prospect" : "prospects"}`,
          `${clientRows.length} ${clientRows.length === 1 ? "client" : "clients"}`,
          ...(activityHandoffs.length > 0
            ? [
                `${activityHandoffs.length} ${
                  activityHandoffs.length === 1 ? "activity" : "activities"
                }`,
              ]
            : []),
        ].join(" / ") + " to route";

  function performAssign(selectedIds: string[], csrIds?: string[]) {
    if (!confirming || selectedIds.length === 0) return;
    if (confirming.kind === "prospect") {
      api.prospects.assignAgents(confirming.id, selectedIds, currentUserId, { csrIds });
    } else if (confirming.kind === "client") {
      api.customers.assignAgents(confirming.id, selectedIds, currentUserId, { csrIds });
    } else {
      // Activities take a single owner — the manager's pick.
      const completedRoute = api.routing.completeContactRouteRequest(
        confirming.id,
        selectedIds,
        currentUserId,
        confirming.contactKind ? { csrIds } : undefined
      );
      if (!completedRoute) api.tasks.assign(confirming.id, selectedIds, currentUserId);
    }
    setConfirming(null);
  }

  return (
    <div className="rounded-lg border border-gold-200 bg-gold-50/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg flex items-center gap-2">
              <UserCog className="h-4 w-4 text-gold-700" /> Routing
              {total > 0 && (
                <CountBadge
                  value={total}
                  tone="gold"
                  title={`${total} ${total === 1 ? "routing item" : "routing items"}`}
                />
              )}
            </h3>
            <span className="rounded-full border border-gold-200 bg-white px-2.5 py-1 text-[11px] font-semibold leading-none text-gold-800">
              {routingSummary}
            </span>
          </div>
          <p className="text-xs text-ink-500 mt-0.5">
            Route unassigned prospects and clients to agency staff - and pick up activities an
            employee has handed off for you to assign. Each assignment is confirmed in a second
            step so you don't misroute.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <RoutingList
          label="Activities to assign"
          emptyHint="No handed-off activities."
          rows={activityHandoffs.map(taskRoutingRow)}
          kind="activity"
          agents={agents}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onAssign={(intent) => setConfirming(intent)}
        />
        <div className="grid lg:grid-cols-2 gap-4">
          <RoutingList
            label="Prospects"
            emptyHint="No unrouted prospects."
            rows={prospectRows}
            kind="prospect"
            agents={agents}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAssign={(intent) => setConfirming(intent)}
          />
          <RoutingList
            label="Clients"
            emptyHint="No unrouted clients."
            rows={clientRows}
            kind="client"
            agents={agents}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            onAssign={(intent) => setConfirming(intent)}
          />
        </div>
      </div>

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
  onConfirm: (agentIds: string[], csrIds?: string[]) => void;
  agents: { id: string; name: string; role: string }[];
  currentUserId: string;
}) {
  // Local selection state — initialized from the preselected
  // list on the intent (e.g. "Assign to me" pre-checks the
  // current user). Multi-select for both clients and prospects.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCsrIds, setSelectedCsrIds] = useState<Set<string>>(new Set());
  const isContactAssignment =
    !!intent && (intent.kind === "client" || intent.kind === "prospect" || !!intent.contactKind);
  const ownerOptions = isContactAssignment
    ? agents.filter((a) => a.role === "agent" || a.role === "manager")
    : agents;
  const csrOptions = agents.filter((a) => a.role === "csr");
  const ownerOptionKey = ownerOptions.map((a) => a.id).join("|");
  useEffect(() => {
    if (!intent) return;
    const preselectedOwners = intent.preselected.filter((id) =>
      ownerOptions.some((a) => a.id === id)
    );
    const preselectedCsrs = [
      intent.csrId,
      ...intent.preselected.filter((id) => agents.some((a) => a.role === "csr" && a.id === id)),
    ].filter((id): id is string => !!id);
    setSelected(new Set(preselectedOwners));
    setSelectedCsrIds(new Set(preselectedCsrs));
  }, [agents, intent?.csrId, intent?.id, intent?.preselected.join(","), ownerOptionKey]);
  if (!intent) return null;
  const contactKind =
    intent.contactKind ??
    (intent.kind === "client" || intent.kind === "prospect" ? intent.kind : undefined);
  const kindLabel =
    contactKind === "client"
      ? "client"
      : contactKind === "prospect"
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

  function toggleCsr(id: string) {
    setSelectedCsrIds((s) => {
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
        {!isContactAssignment
          ? "Pick the staff member who should own this activity."
          : `Pick the assigned owner for this ${kindLabel}, then choose whether a CSR should also be assigned.`}
      </p>
      <p className="text-xs text-ink-500 mt-1">
        {!isContactAssignment
          ? "The first selected teammate becomes the primary owner; the rest co-own and see it in their queues."
          : "Agent/manager ownership is required. CSR support is optional and kept separate from the primary assignment."}
      </p>

      <ul className="mt-4 divide-y divide-ink-100 rounded-md border border-ink-100 max-h-[280px] overflow-y-auto">
        {ownerOptions.map((a) => {
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
                  {staffRoleLabel(a.role)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {isContactAssignment && (
        <div className="mt-4 rounded-md border border-ink-100 bg-ink-50 p-3">
          <label className="label">Assigned CSRs</label>
          {csrOptions.length === 0 ? (
            <p className="text-xs text-ink-500">No CSRs are active for this agency.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-md border border-ink-100 bg-white divide-y divide-ink-100">
              {csrOptions.map((csr) => (
                <label key={csr.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedCsrIds.has(csr.id)}
                    onChange={() => toggleCsr(csr.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{csr.name}</span>
                  <span className="text-[11px] text-ink-400 uppercase tracking-wider">
                    {staffRoleLabel(csr.role)}
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-[11px] text-ink-500">
            It is okay to leave this as no CSR assigned. Select every CSR who should see and work this file.
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <div className="text-[11px] text-ink-500">
          {selected.size === 0
            ? "Pick at least one staff member."
            : selected.size === 1
            ? "1 staff member selected."
            : `${selected.size} staff selected - primary owner: ${
                ownerOptions.find((a) => a.id === orderedIds[0])?.name ?? "-"
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
            onClick={() =>
              onConfirm(
                orderedIds,
                isContactAssignment
                  ? csrOptions.filter((csr) => selectedCsrIds.has(csr.id)).map((csr) => csr.id)
                  : undefined
              )
            }
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
  preselected?: string[];
  assignKind?: "prospect" | "client" | "activity";
  assignId?: string;
  contactKind?: "prospect" | "client";
  csrId?: string;
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
                      kind: r.assignKind ?? kind,
                      id: r.assignId ?? r.id,
                      name: r.name,
                      contactKind: r.contactKind,
                      preselected: r.preselected ?? [],
                      csrId: r.csrId,
                    })
                  }
                  title={`Pick one or more staff members to route this ${kind}`}
                >
                  Assign to staff
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
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

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
        draggingTaskId={draggingTaskId}
        onDragStart={setDraggingTaskId}
        onDragEnd={() => setDraggingTaskId(null)}
      />
      <BoardColumn
        title="In progress"
        tasks={inProgress}
        emptyHint="No items in flight. Click 'Start activity' on a To-do card to move it here."
        viewerIsManager={viewerIsManager}
        onStartReply={onStartReply}
        tone="info"
        focusedTaskId={focusedTaskId}
        draggingTaskId={draggingTaskId}
        onDragStart={setDraggingTaskId}
        onDragEnd={() => setDraggingTaskId(null)}
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
  draggingTaskId,
  onDragStart,
  onDragEnd,
}: {
  title: string;
  tasks: Task[];
  emptyHint: string;
  viewerIsManager: boolean;
  onStartReply: (t: Task) => void;
  tone: "alert" | "info";
  focusedTaskId?: string | null;
  draggingTaskId: string | null;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}) {
  const { user } = useAuth();
  const [dropTarget, setDropTarget] = useState<{ taskId: string; edge: DropEdge } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const taskIds = tasks.map((t) => t.id);
  const acceptsCurrentDrag = !!draggingTaskId && taskIds.includes(draggingTaskId);

  function dropEdgeFor(event: React.DragEvent<HTMLElement>): DropEdge {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function nearestDropTargetFor(event: React.DragEvent<HTMLElement>) {
    const list = listRef.current;
    if (!list || !draggingTaskId) return null;
    const cards = Array.from(
      list.querySelectorAll<HTMLElement>("[data-activity-card-id]")
    ).filter((card) => card.dataset.activityCardId !== draggingTaskId);
    if (cards.length === 0) return null;

    let bestTaskId: string | null = null;
    let bestEdge: DropEdge = "after";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const taskId = card.dataset.activityCardId;
      if (!taskId) continue;
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const edge: DropEdge = event.clientY < midpoint ? "before" : "after";
      const centerDistance = Math.abs(event.clientY - midpoint);
      const gapDistance =
        event.clientY < rect.top
          ? rect.top - event.clientY
          : event.clientY > rect.bottom
          ? event.clientY - rect.bottom
          : 0;
      const distance = gapDistance * 0.7 + centerDistance * 0.3;
      if (distance < bestDistance) {
        bestTaskId = taskId;
        bestEdge = edge;
        bestDistance = distance;
      }
    }
    return bestTaskId ? { taskId: bestTaskId, edge: bestEdge } : null;
  }

  function reorderedIds(targetTaskId: string, edge: DropEdge): string[] {
    if (!draggingTaskId || draggingTaskId === targetTaskId) return taskIds;
    const withoutDragged = taskIds.filter((id) => id !== draggingTaskId);
    const targetIndex = withoutDragged.indexOf(targetTaskId);
    if (targetIndex === -1) return taskIds;
    const insertAt = edge === "after" ? targetIndex + 1 : targetIndex;
    const next = [...withoutDragged];
    next.splice(insertAt, 0, draggingTaskId);
    return next;
  }

  function handleDrop(targetTaskId: string, edge: DropEdge) {
    if (!acceptsCurrentDrag || !draggingTaskId) return;
    const nextIds = reorderedIds(targetTaskId, edge);
    if (nextIds.join("|") !== taskIds.join("|")) {
      api.tasks.reorderQueue(nextIds, draggingTaskId, user?.id);
    }
    setDropTarget(null);
    onDragEnd();
  }

  function handleColumnDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!acceptsCurrentDrag) return;
    const target = nearestDropTargetFor(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  }

  function handleColumnDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!acceptsCurrentDrag) return;
    event.preventDefault();
    const draggedId =
      event.dataTransfer.getData("application/x-quotex-task-id") ||
      event.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== draggingTaskId) onDragStart(draggedId);
    const target = dropTarget ?? nearestDropTargetFor(event);
    if (target) {
      handleDrop(target.taskId, target.edge);
    } else {
      setDropTarget(null);
      onDragEnd();
    }
  }

  return (
    <div
      ref={columnRef}
      className={`rounded-lg border border-ink-100 bg-ink-50/40 p-3 min-w-0 min-h-[274px] transition ${
        draggingTaskId && acceptsCurrentDrag ? "ring-2 ring-gold-100" : ""
      }`}
      onDragOver={handleColumnDragOver}
      onDrop={handleColumnDrop}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        if (!next) return;
        setDropTarget(null);
      }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg">{title}</h3>
          <CountBadge
            value={tasks.length}
            tone={tone === "alert" ? "alert" : "neutral"}
            title={`${tasks.length} ${tasks.length === 1 ? "activity" : "activities"}`}
          />
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-white px-4 py-6 text-xs text-ink-400 text-center">
          {emptyHint}
        </div>
      ) : (
        <div
          ref={listRef}
          className="space-y-4 py-5 -my-3"
        >
          {tasks.map((t) => (
            <ActivityCard
              key={t.id}
              task={t}
              viewerIsManager={viewerIsManager}
              onStartReply={onStartReply}
              isFocused={focusedTaskId === t.id}
              isDragging={draggingTaskId === t.id}
              dropEdge={dropTarget?.taskId === t.id ? dropTarget.edge : null}
              onCollapsedDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-quotex-task-id", t.id);
                event.dataTransfer.setData("text/plain", t.id);
                onDragStart(t.id);
              }}
              onCollapsedDragOver={(event) => {
                if (!acceptsCurrentDrag || draggingTaskId === t.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(nearestDropTargetFor(event) ?? { taskId: t.id, edge: dropEdgeFor(event) });
              }}
              onCollapsedDragLeave={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && columnRef.current?.contains(next)) return;
                if (!next) return;
                setDropTarget((current) => (current?.taskId === t.id ? null : current));
              }}
              onCollapsedDrop={(event) => {
                event.preventDefault();
                const draggedId =
                  event.dataTransfer.getData("application/x-quotex-task-id") ||
                  event.dataTransfer.getData("text/plain");
                if (draggedId && draggedId !== draggingTaskId) onDragStart(draggedId);
                const target = nearestDropTargetFor(event) ?? { taskId: t.id, edge: dropEdgeFor(event) };
                handleDrop(target.taskId, target.edge);
              }}
              onCollapsedDragEnd={() => {
                setDropTarget(null);
                onDragEnd();
              }}
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
  isDragging,
  dropEdge,
  onCollapsedDragStart,
  onCollapsedDragOver,
  onCollapsedDragLeave,
  onCollapsedDrop,
  onCollapsedDragEnd,
}: {
  task: Task;
  viewerIsManager: boolean;
  onStartReply: (t: Task) => void;
  isFocused?: boolean;
  isDragging?: boolean;
  dropEdge?: DropEdge | null;
  onCollapsedDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onCollapsedDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onCollapsedDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onCollapsedDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onCollapsedDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  const { user } = useAuth();
  const { agency } = useTenant();
  const showIntegrationNotice = useIntegrationNotice();
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
  const [dueDraft, setDueDraft] = useState(toDateTimeLocalValue(task.dueAt));

  useEffect(() => {
    setDueDraft(toDateTimeLocalValue(task.dueAt));
  }, [task.dueAt]);

  const customer = task.customerId ? api.customers.get(task.customerId) : undefined;
  // For routing-driven activities the work is tied to a prospect
  // (not yet a client). Look that name up so the collapsed bar
  // can show "New prospect assigned: <name>" instead of "—".
  const prospect = task.prospectId ? api.prospects.get(task.prospectId) : undefined;
  const questionnaireSent = api.tasks.hasSentQuestionnaire(task);
  const pendingEsignCount = api.tasks.pendingEsignDocs(task).length;
  const esignAuditSent = api.tasks
    .history(task.id)
    .some((h) => h.action === "task.esign_docs_sent");
  const esignDocsSent = api.tasks.hasSentEsignDocs(task);
  // Personal reminders the viewer has set against this task.
  const myReminders = user ? api.reminders.listForTask(task.id, user.id) : [];
  const [resolveNoteOpen, setResolveNoteOpen] = useState(false);
  const policy = task.policyId ? api.policies.get(task.policyId) : undefined;
  const asset = task.assetId
    ? api.assets.get(task.assetId)
    : policy
    ? api.assets.get(policy.assetId)
    : undefined;
  const carrier = policy ? api.carriers.get(policy.carrierId) : undefined;
  const agents = routableStaff(api.users.list(task.tenantId), task.tenantId);
  const assignedAgents = [task.assignedToId, ...(task.additionalAssignedToIds ?? [])]
    .filter((id): id is string => !!id)
    .map((id) => agents.find((u) => u.id === id))
    .filter((u): u is UserType => !!u);
  const assignedAgent = assignedAgents[0];
  const assignedAgentLabel = assignedAgents.map((a) => a.name).join(", ");
  const status = api.tasks.statusOf(task);
  const severity = task.severity ?? "info";
  const AssetIcon = ASSET_ICON[asset?.type ?? "other"];

  useEffect(() => {
    if (status !== "in_progress" || !task.customerId) return;
    api.tasks.ensureAutopilot(task.id, user?.id);
  }, [status, task.id, task.customerId, questionnaireSent, pendingEsignCount, user?.id]);

  // Compact collapsed bar — two-row layout. Row 1: severity
  // icon + summary + status chip. Row 2: metadata strip showing
  // policy ref, opened-when, assigned agent (when viewer is
  // looking at someone else's queue), and due state. Designed so the agent
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
    if (task.dueAt) {
      metaParts.push(
        <span key="due" className={`inline-flex items-center gap-1 ${isPastDue(task.dueAt) ? "text-alert" : "text-gold-700"}`}>
          <CalendarDays className="h-3 w-3" /> Due {fmt.dateTime(task.dueAt)}
        </span>
      );
    }
    if (assignedAgents.some((a) => a.id !== user?.id)) {
      metaParts.push(
        <span key="agent" className="inline-flex items-center gap-1">
          <UserCog className="h-3 w-3" /> {assignedAgentLabel}
        </span>
      );
    }
    return (
      <div
        data-activity-card-id={task.id}
        draggable
        onDragStart={onCollapsedDragStart}
        onDragOver={onCollapsedDragOver}
        onDragLeave={onCollapsedDragLeave}
        onDrop={onCollapsedDrop}
        onDragEnd={onCollapsedDragEnd}
        className={`relative rounded-lg border border-ink-100 bg-white shadow-luxe overflow-hidden flex items-stretch transition ${
          isDragging ? "opacity-55 ring-2 ring-gold-200" : ""
        } ${dropEdge ? "ring-2 ring-gold-300" : ""}`}
        title="Drag to reorder this activity"
      >
        {dropEdge === "before" && (
          <div className="pointer-events-none absolute -top-2 left-2 right-2 z-20 h-3 rounded-md border border-gold-300 bg-gold-100/90 shadow-sm" />
        )}
        {dropEdge === "after" && (
          <div className="pointer-events-none absolute -bottom-2 left-2 right-2 z-20 h-3 rounded-md border border-gold-300 bg-gold-100/90 shadow-sm" />
        )}
        <SeverityBar severity={severity} />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex-1 flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left min-w-0 hover:bg-ink-50/60 cursor-grab active:cursor-grabbing"
          aria-expanded={false}
          title="Expand activity"
        >
          <GripVertical className="h-4 w-4 text-ink-300 shrink-0" aria-hidden="true" />
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
              {task.dueAt && (
                <span
                  className={`inline-flex items-center gap-1 ${
                    isPastDue(task.dueAt) && status !== "resolved" ? "text-alert" : "text-gold-700"
                  }`}
                >
                  <CalendarDays className="h-3 w-3" />
                  Due {fmt.dateTime(task.dueAt)}
                </span>
              )}
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
              <Row label="Asset" value={asset ? assetDisplayName(asset) : "—"} />
              <Row
                label={assignedAgents.length > 1 ? "Assigned agents" : "Assigned agent"}
                value={
                  assignedAgents.length > 0 ? (
                    <span className="space-y-1">
                      {assignedAgents.map((a, i) => (
                        <span key={a.id} className="block">
                          {a.name}
                          {i === 0 && assignedAgents.length > 1 && (
                            <span className="ml-1 text-[10px] uppercase tracking-wider text-ink-400">
                              primary
                            </span>
                          )}
                          {a.email && (
                            <a className="text-ink-500 ml-1" href={`mailto:${a.email}`}>
                              ({a.email})
                            </a>
                          )}
                        </span>
                      ))}
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

        {/* Activity workbench */}
        <div className="pt-3 border-t border-ink-100 space-y-3">
          <div className="rounded-lg border border-ink-100 bg-ink-50/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                  Next steps
                </div>
                <div className="text-xs text-ink-500 mt-0.5">
                  Work the customer, add an optional close note, then resolve.
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 [&>*]:min-h-9 [&>*]:justify-center [&>*]:text-center">
          {status !== "in_progress" && (
            <button
              type="button"
              className="btn bg-blue-600 text-white hover:bg-blue-700 text-xs"
              onClick={() => api.tasks.markInProgress(task.id, user?.id)}
              title="Start working this activity. The customer is auto-texted, and AI sends the questionnaire/e-sign requests when needed."
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
                const profileHref =
                  task.quoteSessionId || task.quoteRequestId || task.expressQuoteFollowUp
                    ? quoteWorkspaceDeepLink(`/employee/clients/${task.customerId}`)
                    : `/employee/clients/${task.customerId}`;
                return (
                  <Link to={profileHref} className="btn-primary text-xs inline-flex">
                    <User className="h-3.5 w-3.5" /> Go to client profile
                  </Link>
                );
              }
              return null;
            }
            if (task.prospectId) {
              const profileHref =
                task.quoteSessionId || task.quoteRequestId || task.expressQuoteFollowUp
                  ? quoteWorkspaceDeepLink(`/employee/prospects/${task.prospectId}`)
                  : `/employee/prospects/${task.prospectId}`;
              return (
                <Link to={profileHref} className="btn-primary text-xs inline-flex">
                  <UserSearch className="h-3.5 w-3.5" /> Go to prospect profile
                </Link>
              );
            }
            return null;
          })()}
          {/* Autopilot outbound actions. These chips stay as helpful
              context; resolving the activity remains a staff decision. */}
          {task.customerId && (
            <>
              <div
                className={`text-xs ${
                  questionnaireSent
                    ? "btn-outline !border-emerald-300 !bg-emerald-50 !text-emerald-700"
                    : "btn-outline !border-blue-200 !bg-blue-50 !text-blue-700"
                }`}
                title={
                  questionnaireSent
                    ? "AI sent the questionnaire automatically and recorded it in the activity audit."
                    : "AI will send the questionnaire automatically when this activity starts."
                }
              >
                {questionnaireSent ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {questionnaireSent ? "AI sent questionnaire" : "AI questionnaire queued"}
              </div>
              <div
                className={`text-xs ${
                  esignAuditSent
                    ? "btn-outline !border-emerald-300 !bg-emerald-50 !text-emerald-700"
                    : pendingEsignCount > 0
                    ? "btn-outline !border-blue-200 !bg-blue-50 !text-blue-700"
                    : "btn-outline !border-ink-200 !bg-ink-50 !text-ink-600"
                }`}
                title={
                  esignAuditSent
                    ? "AI sent the customer e-signature request and marked the documents sent."
                    : "Email the customer the documents that need their e-signature — signed copies file themselves"
                }
              >
                {esignAuditSent || esignDocsSent ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {esignAuditSent
                  ? "AI sent e-sign docs"
                  : pendingEsignCount > 0
                  ? "E-sign docs queued"
                  : "No e-sign docs needed"}
              </div>
            </>
          )}
          {status === "in_progress" && (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setResolveNoteOpen(true)}
              title="Mark this activity resolved"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark resolved
            </button>
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
            </div>
          </div>

          <div className="rounded-lg border border-ink-100 bg-white p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                Manage activity
              </div>
              <div className="text-xs text-ink-500 mt-0.5">
                Reminder, priority, queue position, and ownership.
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 [&>button]:min-h-9 [&>button]:justify-center [&>a]:min-h-9 [&>a]:justify-center">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setReminderOpen(true)}
            title="Schedule a private reminder. The activity stays open in everyone's queue — only you get pinged."
          >
            <Bell className="h-3.5 w-3.5" /> Set personal reminder
          </button>
          <div className="inline-flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs shadow-sm">
            <CalendarDays className="h-3.5 w-3.5 text-gold-600" />
            <span className="font-medium text-ink-700">Due</span>
            <input
              type="datetime-local"
              className="h-7 min-w-[12.5rem] rounded border border-ink-200 bg-white px-2 text-xs text-ink-800 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300"
              value={dueDraft}
              onChange={(event) => setDueDraft(event.target.value)}
              title="Activity due date and time"
            />
            <button
              type="button"
              className="rounded bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
              onClick={() => api.tasks.setDueAt(task.id, fromDateTimeLocalValue(dueDraft), user?.id)}
              disabled={!dueDraft}
              title="Save activity due date"
            >
              Save
            </button>
            {task.dueAt && (
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] font-semibold text-ink-500 hover:bg-ink-50 hover:text-alert"
                onClick={() => {
                  setDueDraft("");
                  api.tasks.setDueAt(task.id, undefined, user?.id);
                }}
                title="Clear due date"
              >
                Clear
              </button>
            )}
          </div>
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
          </div>
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

      <ResolveActivityModal
        open={resolveNoteOpen}
        onClose={() => setResolveNoteOpen(false)}
        task={task}
        currentUserId={user?.id ?? null}
      />
    </div>
  );
}

// =====================================================================
// Resolve activity modal.
//
// Closing is never checklist-blocked, but staff must leave a
// resolution note. api.tasks.markComplete writes that note to the task
// and to the client/prospect remarks feed.
// =====================================================================

function ResolveActivityModal({
  open,
  onClose,
  task,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
  currentUserId: string | null;
}) {
  const [note, setNote] = useState("");
  const canResolve = note.trim().length > 0;

  useEffect(() => {
    if (open) setNote("");
  }, [open, task.id]);

  function resolveActivity() {
    if (!canResolve) return;
    api.tasks.markComplete(task.id, currentUserId ?? undefined, {
      resolutionNote: note.trim(),
    });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Close activity" size="md">
      <p className="text-sm text-ink-700">
        Mark <span className="font-medium text-ink-900">"{task.title}"</span> resolved.
        Add a resolution note for the client file before closing it.
      </p>
      <label className="label mt-4">Resolution note</label>
      <textarea
        required
        className="input min-h-[110px] text-sm"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Example: Called Alexandra, confirmed renewal documents were reviewed, and no further action is needed."
      />
      <p className="mt-2 text-xs text-ink-500">
        This note appears in the related client or prospect remarks as an internal
        time-stamped remark attached to this closed activity.
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button type="button" className="btn-outline text-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          onClick={resolveActivity}
          disabled={!canResolve}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve activity
        </button>
      </div>
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
    claim_status: "Claim remark",
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

function toDateTimeLocalValue(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isPastDue(iso?: string): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
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
