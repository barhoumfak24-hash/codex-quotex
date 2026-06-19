import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Medal,
  PartyPopper,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { Confetti } from "@/components/ui/Confetti";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { DocumentViewerModal, downloadDocumentStub } from "@/components/ui/DocumentViewerModal";
import {
  ClientList,
  DetailGrid,
  EmptyList,
  ExpandableRow,
  PolicyList,
  RenewalList,
} from "@/components/analytics/MetricLists";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import type {
  PerformanceGoal,
  PerformanceGoalMetric,
  PerformanceGoalPeriod,
  PerformanceGoalRequest,
  PerformanceGoalScope,
  Agency,
  User,
} from "@/types";
import {
  GOAL_METRICS,
  actualForMetric,
  coerceGoals,
  goalActual,
  goalMetricMeta,
  goalProgressPercent,
  goalScopeLabel,
  inferCustomGoalMetric,
  periodLabel,
} from "@/lib/performanceGoals";

// =====================================================================
// Employee analytics surface. Managers keep the full team view; agents
// get a self-only view with company goals and a manager-routed goal
// request workflow.
//
// Manager view has two modes in one route:
//
//   1. Overview — grid of agent cards with at-a-glance stats
//      (clients, bound policies, premium under management, open
//      activities, resolved this month) so the manager can scan
//      the whole team in one screen.
//
//   2. Drill-down — click an agent to see detailed metrics
//      (Activity Center performance, response times, document
//      activity, marketing throughput, renewals coming up, claim
//      load). Computed on the fly from the platform's existing
//      audit + status trail — no separate metrics store.
//
// Every metric is computed live from `api.*` so the demo can
// rehearse the analytics surface against the seeded data without
// a separate metrics pipeline.
// =====================================================================

export function AnalyticsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  useEffect(() => subscribeToDbChanges(refresh), []);
  // Deep-link from the dashboard "Manage" button (#performance-goals)
  // scrolls the goals card into view once the page settles.
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== "#performance-goals") return;
    const t = window.setTimeout(() => {
      document
        .getElementById("performance-goals")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [location.hash]);
  // Drill-down is URL-driven (?agent=<id>) so navigating away (e.g.
  // into the Activity Center via a View link) and pressing Back lands
  // the manager back on the exact agent's drill-down — and the browser
  // restores the prior scroll position on the POP navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const drilldownId = searchParams.get("agent");
  const setDrilldownId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("agent", id);
    else next.delete("agent");
    setSearchParams(next);
  };

  if (!agency || !user) return null;
  if (user.role === "agent") {
    return <AgentPersonalAnalytics agency={agency} user={user} />;
  }

  if (user.role !== "manager") {
    return (
      <EmptyState
        title="Analytics is for agency staff"
        description="Sign in as an agent or manager to view agency analytics."
        icon={<BarChart3 className="h-8 w-8" />}
      />
    );
  }

  const agents = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager");

  const drilldownAgent = drilldownId
    ? agents.find((a) => a.id === drilldownId)
    : undefined;
  if (drilldownAgent) {
    return (
      <AgentDrilldown
        agent={drilldownAgent}
        agencyId={agency.id}
        onBack={() => setDrilldownId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Analytics</h1>
          <p className="text-ink-500 text-sm mt-1">
            Team performance at a glance. Click an agent for the full per-metric drill-down.
          </p>
        </div>
        <div className="text-xs text-ink-400">
          {agents.length} agent{agents.length === 1 ? "" : "s"} on the team
        </div>
      </div>

      {/* Agency-wide headline */}
      <AgencyOverview agencyId={agency.id} />

      {/* Retention */}
      <RetentionCard agencyId={agency.id} />

      {/* Trends over a selectable timeframe */}
      <AgencyTrends agencyId={agency.id} />

      {/* Manager-set performance goals + actual-vs-target chart */}
      <PerformanceGoalsCard agencyId={agency.id} />

      {/* Cross-team leaderboard — rank agents on any analytics metric */}
      <PerformanceLeaderboard agencyId={agency.id} onOpenAgent={setDrilldownId} />

      {/* Per-agent cards */}
      <Card>
        <CardHeader
          title="Team"
          subtitle="Click an agent to open the full drill-down."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              agencyId={agency.id}
              agent={a}
              onOpen={() => setDrilldownId(a.id)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// Trends panel — bar charts over a selectable timeframe
// ---------------------------------------------------------------------

type Timeframe = "7d" | "30d" | "90d" | "1y";

// ---------------------------------------------------------------------
// Retention — what % of clients / policies stuck around across a
// selectable look-back window. Selectable timeframe matches the
// trend card below so a manager can correlate.
// ---------------------------------------------------------------------

type RetentionWindow = "30d" | "90d" | "1y" | "2y";

function RetentionCard({ agencyId }: { agencyId: string }) {
  const [tf, setTf] = useState<RetentionWindow>("1y");
  const r = useMemo(() => computeRetention(agencyId, tf), [agencyId, tf]);

  return (
    <Card>
      <CardHeader
        title="Retention"
        subtitle="Clients and policies that stuck around vs the cohort active at the start of the period."
        action={
          <div className="flex items-center gap-1 text-xs">
            {(["30d", "90d", "1y", "2y"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTf(t)}
                className={`px-2.5 py-1 rounded ${
                  tf === t
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {t === "30d"
                  ? "30 days"
                  : t === "90d"
                  ? "90 days"
                  : t === "1y"
                  ? "1 year"
                  : "2 years"}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <RetentionTile
          label="Client retention"
          rate={r.client.rate}
          retained={r.client.retained}
          cohort={r.client.cohort}
        />
        <RetentionTile
          label="Policy retention"
          rate={r.policy.rate}
          retained={r.policy.retained}
          cohort={r.policy.cohort}
        />
        <RetentionTile
          label="Personal lines retention"
          rate={r.personal.rate}
          retained={r.personal.retained}
          cohort={r.personal.cohort}
        />
        <RetentionTile
          label="Commercial lines retention"
          rate={r.commercial.rate}
          retained={r.commercial.retained}
          cohort={r.commercial.cohort}
        />
      </div>
    </Card>
  );
}

function RetentionTile({
  label,
  rate,
  retained,
  cohort,
}: {
  label: string;
  rate: number | null;
  retained: number;
  cohort: number;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {rate == null ? "—" : `${Math.round(rate * 100)}%`}
      </div>
      <div className="text-[11px] text-ink-500 mt-0.5">
        {retained}/{cohort} {cohort === 1 ? "retained" : "retained"} from cohort
      </div>
    </div>
  );
}

function computeRetention(agencyId: string, window: RetentionWindow) {
  const now = Date.now();
  const daysBack =
    window === "30d" ? 30 : window === "90d" ? 90 : window === "1y" ? 365 : 730;
  const startMs = now - daysBack * 24 * 60 * 60 * 1000;

  const customers = api.customers.list(agencyId);
  const policies = api.policies.listByTenant(agencyId);

  // Cohort = entities that existed at the start of the window
  // (createdAt < startMs). Retained = same set that's still
  // active today (not archived / not in a lost-status state).
  function ratio(retained: number, cohort: number): number | null {
    if (cohort === 0) return null;
    return retained / cohort;
  }

  const customerCohort = customers.filter(
    (c) => new Date(c.createdAt).getTime() < startMs
  );
  const customerRetained = customerCohort.filter(
    (c) =>
      !c.archived ||
      (c.archivedAt && new Date(c.archivedAt).getTime() < startMs)
        ? !c.archived
        : false
  );

  const policyCohort = policies.filter(
    (p) => new Date(p.createdAt).getTime() < startMs
  );
  const policyRetained = policyCohort.filter(
    (p) => p.status === "bound" || p.status === "renewed"
  );

  function deptRetention(dept: "personal" | "commercial") {
    const cohort = policyCohort.filter(
      (p) => (p.department ?? "personal") === dept
    );
    const retained = cohort.filter(
      (p) => p.status === "bound" || p.status === "renewed"
    );
    return {
      cohort: cohort.length,
      retained: retained.length,
      rate: ratio(retained.length, cohort.length),
    };
  }

  return {
    client: {
      cohort: customerCohort.length,
      retained: customerRetained.length,
      rate: ratio(customerRetained.length, customerCohort.length),
    },
    policy: {
      cohort: policyCohort.length,
      retained: policyRetained.length,
      rate: ratio(policyRetained.length, policyCohort.length),
    },
    personal: deptRetention("personal"),
    commercial: deptRetention("commercial"),
  };
}

function AgencyTrends({ agencyId }: { agencyId: string }) {
  const [tf, setTf] = useState<Timeframe>("30d");
  const series = useMemo(() => buildTrendSeries(agencyId, tf), [agencyId, tf]);

  return (
    <Card>
      <CardHeader
        title="Agency performance trends"
        subtitle="Activity, outreach, and book-growth over time."
        action={
          <div className="flex items-center gap-1 text-xs">
            {(["7d", "30d", "90d", "1y"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTf(t)}
                className={`px-2.5 py-1 rounded ${
                  tf === t
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {t === "7d"
                  ? "7 days"
                  : t === "30d"
                  ? "30 days"
                  : t === "90d"
                  ? "90 days"
                  : "1 year"}
              </button>
            ))}
          </div>
        }
      />

      {/* Period totals */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <PeriodStat label="Activities resolved" value={series.totals.resolved} />
        <PeriodStat label="Inbound requests" value={series.totals.inbound} />
        <PeriodStat label="Outbound messages" value={series.totals.outbound} />
        <PeriodStat
          label="New customers"
          value={series.totals.newCustomers}
          hint={`Premium written ${fmt.money(series.totals.premiumWritten)}`}
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-5">
        <TrendChart title="Activities resolved" buckets={series.buckets} valueKey="resolved" tone="emerald" />
        <TrendChart title="Inbound customer requests" buckets={series.buckets} valueKey="inbound" tone="indigo" />
        <TrendChart title="Outbound messages" buckets={series.buckets} valueKey="outbound" tone="gold" />
        <TrendChart title="New customers" buckets={series.buckets} valueKey="newCustomers" tone="violet" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Performance goals
//
// Managers set per-metric agency-wide targets (monthly / quarterly /
// annual). The card plots actual vs. target as a bar so the team can
// see how close they are at a glance, with a progress meter for each
// goal underneath. Editing the targets happens inline via a small
// modal — the goals persist on the Agency record.
// ---------------------------------------------------------------------

function PerformanceGoalsCard({ agencyId }: { agencyId: string }) {
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  // Which goal we're editing (by id). null = brand-new goal.
  const [editGoalId, setEditGoalId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // `?celebrate=<goalId>` deep-link from a dashboard achievement
  // banner — highlight the row + fire confetti.
  const [celebrateParams] = useSearchParams();
  const celebrateGoalId = celebrateParams.get("celebrate");
  const requestedGoalId = celebrateParams.get("request");
  const agency = api.agencies.get(agencyId);
  const goals = coerceGoals(agency?.performanceGoals);
  const requestedGoals = (agency?.performanceGoalRequests ?? []).filter(
    (request) => request.status === "pending"
  );
  const history = agency?.performanceGoalHistory ?? [];
  const refresh = () => setRev((r) => r + 1);

  const company = goals.filter((g) => g.scope === "company");
  const personal = goals.filter((g) => g.scope === "personal");
  const met = history.filter((h) => h.met);
  const notMet = history.filter((h) => !h.met);
  const metCompany = met.filter((h) => h.scope === "company");
  const metPersonal = met.filter((h) => h.scope === "personal");
  const missCompany = notMet.filter((h) => h.scope === "company");
  const missPersonal = notMet.filter((h) => h.scope === "personal");
  const editGoal = editGoalId ? goals.find((g) => g.id === editGoalId) : undefined;
  const celebrating = !!celebrateGoalId && goals.some((g) => g.id === celebrateGoalId);

  function openNew() {
    setEditGoalId(null);
    setModalOpen(true);
  }

  return (
    <Card id="performance-goals">
      {celebrating && <Confetti />}
      <CardHeader
        title="Performance goals"
        subtitle="Company-wide and personal targets vs. today's actuals. Company goals track the whole agency; personal goals track the assigned staff member(s)."
        action={
          <button type="button" className="btn-gold text-xs" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Set a goal
          </button>
        }
      />

      {requestedGoals.length > 0 && (
        <RequestedGoalsSection
          agencyId={agencyId}
          requests={requestedGoals}
          highlightedRequestId={requestedGoalId}
          reviewerId={user?.id}
          onChanged={refresh}
        />
      )}

      {goals.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 p-6 text-center">
          <Target className="h-8 w-8 mx-auto text-ink-300" />
          <div className="mt-3 text-sm text-ink-700 font-medium">No goals set yet.</div>
          <div className="mt-1 text-xs text-ink-500">
            Click <span className="font-medium">Set a goal</span> to add a company-wide or
            personal target.
          </div>
        </div>
      ) : (
        <>
          <GoalBarChart agencyId={agencyId} goals={goals} />
          {company.length > 0 && (
            <>
              <div className="mt-5 text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                Company goals
              </div>
              <ul className="mt-2 space-y-3">
                {company.map((g) => (
                  <GoalRow
                    key={g.id}
                    agencyId={agencyId}
                    goal={g}
                    celebrated={g.id === celebrateGoalId}
                    onEdit={() => {
                      setEditGoalId(g.id);
                      setModalOpen(true);
                    }}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            </>
          )}
          {personal.length > 0 && (
            <>
              <div className="mt-5 text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                Personal goals
              </div>
              <ul className="mt-2 space-y-3">
                {personal.map((g) => (
                  <GoalRow
                    key={g.id}
                    agencyId={agencyId}
                    goal={g}
                    celebrated={g.id === celebrateGoalId}
                    onEdit={() => {
                      setEditGoalId(g.id);
                      setModalOpen(true);
                    }}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Previous targets — achieved / not achieved, each split into
          Company + Personal, all timestamped. */}
      {history.length > 0 && (
        <div className="mt-5 pt-4 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between gap-3"
          >
            <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
              Previous targets · {history.length}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500">
              {showHistory ? "Hide" : "Show"}
              {showHistory ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>
          {showHistory && (
            <div className="mt-3 space-y-4">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-[11px] uppercase tracking-wider font-bold text-emerald-700 inline-flex items-center gap-1 mb-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Targets achieved · {met.length}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <ArchivedGoalSection title="Company" tone="met" rows={metCompany} agencyId={agencyId} />
                  <ArchivedGoalSection title="Personal" tone="met" rows={metPersonal} agencyId={agencyId} />
                </div>
              </div>
              <div className="rounded-md border border-rose-200 bg-rose-50/40 p-3">
                <div className="text-[11px] uppercase tracking-wider font-bold text-rose-700 inline-flex items-center gap-1 mb-2">
                  <XCircle className="h-3.5 w-3.5" /> Targets not achieved · {notMet.length}
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <ArchivedGoalSection title="Company" tone="missed" rows={missCompany} agencyId={agencyId} />
                  <ArchivedGoalSection title="Personal" tone="missed" rows={missPersonal} agencyId={agencyId} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <PerformanceGoalModal
        open={modalOpen}
        agencyId={agencyId}
        existing={editGoal}
        onClose={() => {
          setModalOpen(false);
          setEditGoalId(null);
          refresh();
        }}
      />
    </Card>
  );
}

function RequestedGoalsSection({
  agencyId,
  requests,
  highlightedRequestId,
  reviewerId,
  onChanged,
}: {
  agencyId: string;
  requests: PerformanceGoalRequest[];
  highlightedRequestId?: string | null;
  reviewerId?: string;
  onChanged: () => void;
}) {
  return (
    <div className="mb-5 rounded-lg border border-gold-200 bg-gold-50/35 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-gold-800">
            Requested goals
          </div>
          <div className="text-xs text-ink-500 mt-0.5">
            Agent-submitted requests waiting for manager review.
          </div>
        </div>
        <Badge tone="gold">{requests.length} pending</Badge>
      </div>
      <ul className="mt-3 space-y-2">
        {requests.map((request) => (
          <RequestedGoalRow
            key={request.id}
            agencyId={agencyId}
            request={request}
            highlighted={request.id === highlightedRequestId}
            reviewerId={reviewerId}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function RequestedGoalRow({
  agencyId,
  request,
  highlighted,
  reviewerId,
  onChanged,
}: {
  agencyId: string;
  request: PerformanceGoalRequest;
  highlighted?: boolean;
  reviewerId?: string;
  onChanged: () => void;
}) {
  const requester = api.users.get(request.requestedById);
  const def = goalMetricMeta(request);
  const targetLabel =
    def.format === "money" ? fmt.money(request.target) : request.target.toLocaleString();
  const managerId = reviewerId ?? "manager";
  return (
    <li
      className={`rounded-md border bg-white p-3 ${
        highlighted ? "border-gold-500 ring-2 ring-gold-200" : "border-ink-100"
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900">
            {def.label}
            <span className="ml-2 rounded bg-ink-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-ink-600">
              {request.scope === "company" ? "Company-wide" : requester?.name ?? "Personal"}
            </span>
          </div>
          <div className="mt-1 text-xs text-ink-500">
            Requested by {requester?.name ?? "Unknown staff"} · {targetLabel} this{" "}
            {periodLabel(request.period)} · {fmt.dateTime(request.createdAt)}
            {request.dueDate && <> · due {fmt.date(request.dueDate)}</>}
          </div>
          {request.note && (
            <div className="mt-2 rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
              {request.note}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              api.agencies.approvePerformanceGoalRequest(agencyId, request.id, managerId);
              onChanged();
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </button>
          <button
            type="button"
            className="btn-outline text-xs text-rose-600"
            onClick={() => {
              api.agencies.rejectPerformanceGoalRequest(agencyId, request.id, managerId);
              onChanged();
            }}
          >
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      </div>
    </li>
  );
}

function GoalRow({
  agencyId,
  goal,
  celebrated,
  onEdit,
  onChanged,
}: {
  agencyId: string;
  goal: PerformanceGoal;
  celebrated?: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const def = goalMetricMeta(goal);
  const actual = goalActual(agencyId, goal);
  const pct = goalProgressPercent(actual, goal.target);
  const achieved = goal.target > 0 && actual >= goal.target;
  const tone = pct >= 100 ? "emerald" : pct >= 75 ? "gold" : pct >= 40 ? "amber" : "rose";
  const fmtVal = (n: number) =>
    def.format === "money" ? fmt.money(n) : n.toLocaleString();
  const overdue = goal.dueDate != null && new Date(goal.dueDate).getTime() < Date.now();
  const toneText =
    tone === "emerald" ? "text-emerald-700" : tone === "gold" ? "text-gold-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  const toneBar =
    tone === "emerald" ? "bg-emerald-500" : tone === "gold" ? "bg-gold-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <li
      className={`rounded-md border p-3 ${
        achieved ? "border-emerald-300 bg-emerald-50/50" : "border-ink-100 bg-white"
      } ${celebrated ? "ring-2 ring-emerald-300" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-gold-700" />
            {def.label}
            <span className="ml-1 rounded bg-ink-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-ink-600">
              {goalScopeLabel(agencyId, goal)}
            </span>
            {achieved && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-bold text-emerald-700 inline-flex items-center gap-1">
                <PartyPopper className="h-3 w-3" /> Goal achieved
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            {fmtVal(actual)} of {fmtVal(goal.target)} this {periodLabel(goal.period)}
            {goal.dueDate && (
              <>
                {" · "}
                <span className={overdue ? "text-rose-600 font-medium" : ""}>
                  due {fmt.date(goal.dueDate)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold ${achieved ? "text-emerald-700" : toneText}`}>
            {pct}%
          </span>
          {achieved ? (
            <button
              type="button"
              className="btn-primary text-xs"
              title="Archive this completed goal into Previous targets"
              onClick={() => {
                api.agencies.archivePerformanceGoal(agencyId, goal.id, actual);
                onChanged();
              }}
            >
              <Archive className="h-3 w-3" /> Move to previous targets
            </button>
          ) : (
            <button
              type="button"
              className="btn-outline text-xs"
              title="Archive this goal into Previous targets (records met / not-met)"
              onClick={() => {
                api.agencies.archivePerformanceGoal(agencyId, goal.id, actual);
                onChanged();
              }}
            >
              <Archive className="h-3 w-3" /> Archive
            </button>
          )}
          <button type="button" className="btn-outline text-xs" onClick={onEdit}>
            <Pencil className="h-3 w-3" /> Edit
          </button>
          <button
            type="button"
            className="btn-outline text-xs !px-2 text-rose-600"
            title="Delete this goal (no history entry)"
            onClick={() => {
              if (!confirm(`Delete this ${def?.label.toLowerCase() ?? "goal"}?`)) return;
              api.agencies.removePerformanceGoal(agencyId, goal.id);
              onChanged();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full ${toneBar}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function ArchivedGoalSection({
  title,
  tone,
  rows,
  agencyId,
}: {
  title: string;
  tone: "met" | "missed";
  rows: import("@/types").ArchivedPerformanceGoal[];
  agencyId: string;
}) {
  const accent = tone === "met" ? "text-emerald-700" : "text-rose-700";
  return (
    <div className="rounded-md border border-ink-100 p-3">
      <div className={`text-[11px] uppercase tracking-wider font-semibold mb-2 inline-flex items-center gap-1 ${accent}`}>
        {tone === "met" ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
        {title} · {rows.length}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-ink-400">None yet.</div>
      ) : (
        <ul
          className={`space-y-2 ${
            rows.length > 5 ? "max-h-[16rem] dropdown-scroll-y" : ""
          }`}
        >
          {rows.map((h, i) => {
            const def = goalMetricMeta(h);
            const fmtVal = (n: number) =>
              def?.format === "money" ? fmt.money(n) : n.toLocaleString();
            return (
              <li key={i} className="text-xs">
                <div className="font-medium text-ink-800">
                  {def.label}
                  <span className="ml-1.5 text-[10px] text-ink-400">
                    {goalScopeLabel(agencyId, h)}
                  </span>
                </div>
                <div className="text-ink-500">
                  {fmtVal(h.actual)} of {fmtVal(h.target)} ({periodLabel(h.period)})
                  {h.dueDate && ` · due ${fmt.date(h.dueDate)}`}
                </div>
                <div className="text-[10px] text-ink-400">
                  Archived {fmt.dateTime(h.archivedAt)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GoalBarChart({
  agencyId,
  goals,
}: {
  agencyId: string;
  goals: PerformanceGoal[];
}) {
  // Render a horizontal bar per goal. Tone-graded by progress so the
  // bars match the goal rows below (rose → amber → gold → emerald).
  const rows = goals.map((g) => {
    const def = goalMetricMeta(g);
    const actual = goalActual(agencyId, g);
    const pct = goalProgressPercent(actual, g.target);
    return {
      id: g.id,
      label: def.label,
      format: def.format,
      scopeLabel: goalScopeLabel(agencyId, g),
      target: g.target,
      actual,
      pct,
    };
  });
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-3">
        Actual vs. target
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const fmtVal = (n: number) => (r.format === "money" ? fmt.money(n) : n.toLocaleString());
          const toneBar =
            r.pct >= 100 ? "bg-emerald-500" : r.pct >= 75 ? "bg-gold-500" : r.pct >= 40 ? "bg-amber-500" : "bg-rose-500";
          return (
            <li key={r.id}>
              <div className="flex items-center justify-between text-xs text-ink-700 mb-1">
                <span className="font-medium">
                  {r.label}
                  <span className="ml-1.5 text-[10px] text-ink-400">{r.scopeLabel}</span>
                </span>
                <span className="tabular-nums">
                  {fmtVal(r.actual)}{" "}
                  <span className="text-ink-400">/ {fmtVal(r.target)}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className={`h-full ${toneBar}`}
                  style={{ width: `${r.pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PerformanceGoalModal({
  open,
  agencyId,
  existing,
  onClose,
}: {
  open: boolean;
  agencyId: string;
  // undefined = new goal (the modal shows its metric picker).
  existing?: PerformanceGoal;
  onClose: () => void;
}) {
  const isEditing = !!existing;
  const metricPickerOrder: PerformanceGoalMetric[] = [
    "premiumWritten",
    "activitiesResolved",
    "newCustomers",
    "newProspects",
    "policiesBound",
  ];
  const metricPickerChoices = metricPickerOrder
    .map((key) => GOAL_METRICS.find((metric) => metric.key === key))
    .filter((metric): metric is (typeof GOAL_METRICS)[number] => !!metric);
  const [pickedMetric, setPickedMetric] = useState<PerformanceGoalMetric>("premiumWritten");
  const [target, setTarget] = useState<string>("");
  const [period, setPeriod] = useState<PerformanceGoalPeriod>("monthly");
  const [dueDate, setDueDate] = useState<string>("");
  const [scope, setScope] = useState<PerformanceGoalScope>("company");
  const [assignees, setAssignees] = useState<Set<string>>(new Set());
  const [customMetricText, setCustomMetricText] = useState("");
  const [customDraft, setCustomDraft] = useState<ReturnType<typeof inferCustomGoalMetric> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const staff = useMemo(
    () =>
      api.users
        .list(agencyId)
        .filter((u) => u.role === "agent" || u.role === "manager")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agencyId, open]
  );

  useEffect(() => {
    if (!open) return;
    setPickedMetric(existing?.metric ?? "premiumWritten");
    setTarget(existing ? String(existing.target) : "");
    setPeriod(existing?.period ?? "monthly");
    setDueDate(existing?.dueDate ? existing.dueDate.slice(0, 10) : "");
    setScope(existing?.scope ?? "company");
    setAssignees(new Set(existing?.assigneeIds ?? []));
    setCustomMetricText(existing?.customMetricPrompt ?? existing?.customMetricLabel ?? "");
    setCustomDraft(
      existing?.metric === "custom"
        ? {
            prompt: existing.customMetricPrompt ?? existing.customMetricLabel ?? "",
            formula: existing.customMetricFormula ?? "activitiesResolved",
            label: existing.customMetricLabel ?? "Custom metric",
            helper: existing.customMetricHelper ?? "AI-tracked custom operational metric.",
            format: "count",
          }
        : null
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  if (!open) return null;
  const def =
    pickedMetric === "custom"
      ? customDraft ?? {
          label: "Custom AI metric",
          helper: "Describe the operational result you want AI to track.",
          format: "count" as const,
        }
      : GOAL_METRICS.find((m) => m.key === pickedMetric)!;
  const n = Number(target);
  const valid =
    Number.isFinite(n) &&
    n > 0 &&
    (scope === "company" || assignees.size > 0) &&
    (pickedMetric !== "custom" || customDraft != null || customMetricText.trim().length > 0);

  function toggleAssignee(id: string) {
    setAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildCustomMetric() {
    const prompt = customMetricText.trim();
    if (!prompt) {
      setError("Describe the custom metric first.");
      return;
    }
    setCustomDraft(inferCustomGoalMetric(prompt));
    setPickedMetric("custom");
    setError(null);
  }

  function save() {
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive target.");
      return;
    }
    if (scope === "personal" && assignees.size === 0) {
      setError("Pick at least one person for a personal goal.");
      return;
    }
    const resolvedCustom =
      pickedMetric === "custom" ? customDraft ?? inferCustomGoalMetric(customMetricText) : null;
    if (pickedMetric === "custom" && !resolvedCustom?.prompt.trim()) {
      setError("Describe the custom metric you want AI to track.");
      return;
    }
    const payload = {
      target: n,
      customMetricLabel: resolvedCustom?.label,
      customMetricPrompt: resolvedCustom?.prompt,
      customMetricHelper: resolvedCustom?.helper,
      customMetricFormula: resolvedCustom?.formula,
      period,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      scope,
      assigneeIds: scope === "personal" ? Array.from(assignees) : undefined,
    };
    if (isEditing && existing) {
      api.agencies.updatePerformanceGoal(agencyId, existing.id, payload);
    } else {
      api.agencies.addPerformanceGoal(agencyId, { metric: pickedMetric, ...payload });
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit goal" : "Set a goal"} size="md">
      <div className="space-y-4">
        {/* Metric picker — only for a new goal. */}
        {!isEditing && (
          <div>
            <label className="label">Metric</label>
            <div className="grid auto-rows-fr gap-2 sm:grid-cols-2">
              {metricPickerChoices.map((md) => {
                const active = pickedMetric === md.key;
                return (
                  <button
                    key={md.key}
                    type="button"
                    onClick={() => {
                      setPickedMetric(md.key);
                      setError(null);
                    }}
                    className={`flex min-h-[4.75rem] flex-col justify-center rounded-md border px-3 py-2 text-left text-sm ${
                      active
                        ? "border-gold-400 bg-gold-50 text-ink-900"
                        : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                    }`}
                  >
                    <div className="font-medium">{md.label}</div>
                    <div className="text-[11px] text-ink-500">{md.helper}</div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setPickedMetric("custom");
                  setError(null);
                }}
                className={`flex min-h-[4.75rem] flex-col justify-center rounded-md border px-3 py-2 text-left text-sm ${
                  pickedMetric === "custom"
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                }`}
              >
                <div className="font-medium inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-gold-600" /> Custom AI metric
                </div>
                <div className="text-[11px] text-ink-500">
                  Type your own metric and AI maps it to live data.
                </div>
              </button>
            </div>
          </div>
        )}

        {pickedMetric === "custom" && (
          <div className="rounded-md border border-gold-200 bg-gold-50/40 p-3">
            <label className="label">Custom metric</label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="input text-sm"
                placeholder="e.g. policies renewed"
                value={customMetricText}
                onChange={(e) => {
                  setCustomMetricText(e.target.value);
                  setCustomDraft(null);
                }}
              />
              <button
                type="button"
                className="btn-primary text-sm whitespace-nowrap"
                onClick={buildCustomMetric}
              >
                <Sparkles className="h-3.5 w-3.5" /> AI build
              </button>
            </div>
            <div className="mt-2 text-xs text-ink-600">
              {customDraft ? (
                <>
                  AI will track{" "}
                  <span className="font-semibold text-ink-900">{customDraft.label}</span>{" "}
                  using the closest available agency data signal.
                </>
              ) : (
                "Examples: policies renewed, claims closed, approved documents, new leads."
              )}
            </div>
          </div>
        )}

        <p className="text-sm text-ink-600">{def.helper}</p>

        {/* Scope: company-wide vs personal. */}
        <div>
          <label className="label">Goal for</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { v: "company" as const, label: "Company-wide", hint: "Whole agency" },
                { v: "personal" as const, label: "Specific person(s)", hint: "Selected staff" },
              ]
            ).map((opt) => {
              const active = scope === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setScope(opt.v)}
                  className={`text-left rounded-md border px-3 py-2 text-sm ${
                    active
                      ? "border-gold-400 bg-gold-50 text-ink-900"
                      : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[11px] text-ink-500">{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {scope === "personal" && (
          <div>
            <label className="label">Who is this goal for? ({assignees.size} selected)</label>
            <div className="grid sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-md border border-ink-100 p-2 bg-ink-50/30">
              {staff.map((u) => {
                const checked = assignees.has(u.id);
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-sm ${
                      checked ? "bg-gold-50 border border-gold-200" : "border border-transparent hover:bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssignee(u.id)}
                    />
                    <span className="min-w-0 truncate">
                      {u.name}
                      <span className="text-[11px] text-ink-500">
                        {" "}· {u.role === "manager" ? "Manager" : "Agent"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="text-[11px] text-ink-500 mt-1">
              The actual is summed across the selected staff member(s)' book / resolved work.
            </div>
          </div>
        )}

        <div>
          <label className="label">Target ({def.format === "money" ? "$" : "count"})</label>
          <input
            className="input"
            type="number"
            min={0}
            step={def.format === "money" ? 1000 : 1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Period</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["monthly", "quarterly", "annual"] as PerformanceGoalPeriod[]).map((p) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md border px-2 py-1.5 text-sm capitalize ${
                    active
                      ? "border-gold-400 bg-gold-50 text-ink-900"
                      : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Due date (optional)</label>
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div className="text-[11px] text-ink-500 mt-1">
            A custom deadline for this target. Recorded when you archive it into Previous goals.
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={save}
            disabled={!valid}
          >
            <Target className="h-3.5 w-3.5" /> Save goal
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AgentPersonalAnalytics({ agency, user }: { agency: Agency; user: User }) {
  const m = useAgentMetrics(agency.id, user.id);
  const [viewing, setViewing] = useState<MetricKey | null>(null);
  const goals = coerceGoals(agency.performanceGoals);
  const companyGoals = goals.filter((g) => g.scope === "company");
  const myGoals = goals.filter(
    (g) => g.scope === "personal" && (g.assigneeIds ?? []).includes(user.id)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Analytics</h1>
          <p className="text-ink-500 text-sm mt-1">
            Your personal book, activity performance, and company goals.
          </p>
        </div>
        <Badge tone="info">Personal view</Badge>
      </div>

      <Section title="My book">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Assigned clients"
            value={m.assignedClients}
            icon={<Users className="h-5 w-5" />}
            onClick={() => setViewing("assignedClients")}
          />
          <StatCard
            label="Bound policies"
            value={m.boundPolicies}
            icon={<ShieldCheck className="h-5 w-5" />}
            onClick={() => setViewing("boundPolicies")}
          />
          <StatCard
            label="Premium under mgmt"
            value={fmt.money(m.premiumUnderMgmt)}
            icon={<TrendingUp className="h-5 w-5" />}
            onClick={() => setViewing("premiumUnderMgmt")}
          />
          <StatCard
            label="Renewals upcoming"
            value={m.renewalsUpcoming}
            icon={<UserCheck className="h-5 w-5" />}
            onClick={() => setViewing("renewalsUpcoming")}
          />
        </div>
      </Section>

      <Section title="My activity performance">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Open activities"
            value={m.openActivities}
            icon={<BarChart3 className="h-5 w-5" />}
            onClick={() => setViewing("openActivities")}
          />
          <StatCard
            label="In progress"
            value={m.inProgress}
            icon={<Sparkles className="h-5 w-5" />}
            onClick={() => setViewing("inProgress")}
          />
          <StatCard
            label="Resolved (30d)"
            value={m.resolvedLast30}
            icon={<CheckCircle2 className="h-5 w-5" />}
            onClick={() => setViewing("resolvedLast30")}
          />
          <StatCard
            label="Avg handle time"
            value={m.avgHandleMs ? formatDurationMs(m.avgHandleMs) : "-"}
            icon={<Timer className="h-5 w-5" />}
            hint="Started to resolved"
            onClick={() => setViewing("avgHandleMs")}
          />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <StatCard
            label="Response rate"
            value={m.responseRate != null ? `${Math.round(m.responseRate * 100)}%` : "-"}
            hint="Inbound resolved"
            onClick={() => setViewing("responseRate")}
          />
          <StatCard
            label="Outbound messages"
            value={m.outboundMessages}
            onClick={() => setViewing("outboundMessages")}
          />
          <StatCard
            label="Documents uploaded"
            value={m.docsUploaded}
            onClick={() => setViewing("docsUploaded")}
          />
          <StatCard
            label="Open claims"
            value={m.openClaims}
            onClick={() => setViewing("openClaims")}
          />
        </div>
      </Section>

      <div className="grid xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)] gap-4">
        <Card>
          <CardHeader
            title="Company goals"
            subtitle="Management-set targets for the agency, plus any personal goals assigned to you."
          />
          <div className="space-y-5">
            <AgentGoalGroup
              title="Company-wide"
              empty="No company goals are active right now."
              agencyId={agency.id}
              userId={user.id}
              goals={companyGoals}
            />
            {myGoals.length > 0 && (
              <AgentGoalGroup
                title="Assigned to me"
                empty="No personal goals assigned."
                agencyId={agency.id}
                userId={user.id}
                goals={myGoals}
                personal
              />
            )}
          </div>
        </Card>

        <AgentGoalRequestCard agencyId={agency.id} user={user} />
      </div>

      <MetricDetailModal
        metric={viewing}
        agentId={user.id}
        agentName={user.name}
        agencyId={agency.id}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

function AgentGoalGroup({
  title,
  empty,
  agencyId,
  userId,
  goals,
  personal = false,
}: {
  title: string;
  empty: string;
  agencyId: string;
  userId: string;
  goals: PerformanceGoal[];
  personal?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
        {title}
      </div>
      {goals.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-ink-200 p-4 text-sm text-ink-500">
          {empty}
        </div>
      ) : (
        <ul className="mt-2 space-y-3">
          {goals.map((g) => (
            <AgentGoalProgressRow
              key={g.id}
              agencyId={agencyId}
              userId={userId}
              goal={g}
              scopeLabel={personal ? "Your assigned goal" : "Company-wide"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentGoalProgressRow({
  agencyId,
  userId,
  goal,
  scopeLabel,
}: {
  agencyId: string;
  userId: string;
  goal: PerformanceGoal;
  scopeLabel: string;
}) {
  const scopedGoal =
    goal.scope === "personal" ? { ...goal, assigneeIds: [userId] } : goal;
  const def = goalMetricMeta(goal);
  const actual = goalActual(agencyId, scopedGoal);
  const pct = goalProgressPercent(actual, goal.target);
  const achieved = goal.target > 0 && actual >= goal.target;
  const toneBar =
    pct >= 100
      ? "bg-emerald-500"
      : pct >= 75
        ? "bg-gold-500"
        : pct >= 40
          ? "bg-amber-500"
          : "bg-rose-500";
  const fmtGoal = (n: number) =>
    def.format === "money" ? fmt.money(n) : n.toLocaleString();
  return (
    <li className="rounded-md border border-ink-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Flag className="h-3.5 w-3.5 text-gold-700" />
            <span className="text-sm font-semibold text-ink-900">{def.label}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold text-ink-600">
              {scopeLabel}
            </span>
            {achieved && <Badge tone="success">Achieved</Badge>}
          </div>
          <div className="mt-1 text-xs text-ink-500">
            {fmtGoal(actual)} of {fmtGoal(goal.target)} this {periodLabel(goal.period)}
            {goal.dueDate && <> · due {fmt.date(goal.dueDate)}</>}
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold tabular-nums text-ink-800">
          {pct}%
        </div>
      </div>
      <div className="mt-2 h-2 rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full ${toneBar}`} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

function AgentGoalRequestCard({ agencyId, user }: { agencyId: string; user: User }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader
        title="Request a performance goal"
        subtitle="Ask management to add a goal for you or for the agency."
      />
      <div className="rounded-md border border-dashed border-ink-200 bg-ink-50/40 p-4">
        <div className="text-sm font-medium text-ink-900">Use the same goal builder managers use.</div>
        <p className="mt-1 text-xs text-ink-500">
          Pick the metric, target, period, and whether it should be company-wide or for you.
        </p>
        {status && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {status}
          </div>
        )}
        <button
          type="button"
          className="btn-primary mt-4 w-full justify-center"
          onClick={() => setOpen(true)}
        >
          <Target className="h-4 w-4" /> Request a goal
        </button>
      </div>
      <AgentGoalRequestModal
        open={open}
        agencyId={agencyId}
        user={user}
        onClose={() => setOpen(false)}
        onSent={() => {
          setOpen(false);
          setStatus("Request sent to management for review in Analytics.");
        }}
      />
    </Card>
  );
}

function AgentGoalRequestModal({
  open,
  agencyId,
  user,
  onClose,
  onSent,
}: {
  open: boolean;
  agencyId: string;
  user: User;
  onClose: () => void;
  onSent: () => void;
}) {
  const metricPickerOrder: PerformanceGoalMetric[] = [
    "premiumWritten",
    "activitiesResolved",
    "newCustomers",
    "newProspects",
    "policiesBound",
  ];
  const metricPickerChoices = metricPickerOrder
    .map((key) => GOAL_METRICS.find((metric) => metric.key === key))
    .filter((metric): metric is (typeof GOAL_METRICS)[number] => !!metric);
  const [metric, setMetric] = useState<PerformanceGoalMetric>("premiumWritten");
  const [customMetric, setCustomMetric] = useState("");
  const [target, setTarget] = useState("");
  const [period, setPeriod] = useState<PerformanceGoalPeriod>("monthly");
  const [scope, setScope] = useState<PerformanceGoalScope>("personal");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const customDraft =
    metric === "custom" && customMetric.trim() ? inferCustomGoalMetric(customMetric) : null;
  const selectedMeta =
    metric === "custom"
      ? customDraft ?? {
          label: "Custom metric",
          helper: "Describe the performance target you want management to consider.",
          format: "count" as const,
        }
      : GOAL_METRICS.find((g) => g.key === metric)!;

  useEffect(() => {
    if (!open) return;
    setMetric("premiumWritten");
    setCustomMetric("");
    setTarget("");
    setPeriod("monthly");
    setScope("personal");
    setDueDate("");
    setNote("");
    setError(null);
  }, [open]);

  function submitRequest() {
    const targetNumber = Number(target);
    if (!Number.isFinite(targetNumber) || targetNumber <= 0) {
      setError("Enter a positive target.");
      return;
    }
    if (metric === "custom" && !customMetric.trim()) {
      setError("Describe the custom metric you want AI to track.");
      return;
    }
    const resolvedCustom =
      metric === "custom" ? customDraft ?? inferCustomGoalMetric(customMetric) : null;
    api.agencies.addPerformanceGoalRequest(agencyId, {
      requestedById: user.id,
      metric,
      customMetricLabel: resolvedCustom?.label,
      customMetricPrompt: resolvedCustom?.prompt,
      customMetricHelper: resolvedCustom?.helper,
      customMetricFormula: resolvedCustom?.formula,
      target: targetNumber,
      period,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      scope,
      note: note.trim() || undefined,
    });
    setError(null);
    onSent();
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Request a goal" size="md">
      <div className="space-y-4">
        <div>
          <label className="label">Metric</label>
          <div className="grid auto-rows-fr gap-2 sm:grid-cols-2">
            {metricPickerChoices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => {
                  setMetric(choice.key);
                  setError(null);
                }}
                className={`flex min-h-[4.75rem] flex-col justify-center rounded-md border px-3 py-2 text-left text-sm ${
                  metric === choice.key
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                }`}
              >
                <div className="font-medium">{choice.label}</div>
                <div className="text-[11px] text-ink-500">{choice.helper}</div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMetric("custom");
                setError(null);
              }}
              className={`flex min-h-[4.75rem] flex-col justify-center rounded-md border px-3 py-2 text-left text-sm ${
                metric === "custom"
                  ? "border-gold-400 bg-gold-50 text-ink-900"
                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
              }`}
            >
              <div className="font-medium inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-gold-600" /> Custom AI metric
              </div>
              <div className="text-[11px] text-ink-500">
                Request something like policies renewed or approved documents.
              </div>
            </button>
          </div>
        </div>

        {metric === "custom" && (
          <div>
            <label className="label">Custom metric</label>
            <input
              className="input text-sm"
              placeholder="e.g. policies renewed"
              value={customMetric}
              onChange={(e) => setCustomMetric(e.target.value)}
            />
            <div className="mt-1 text-xs text-ink-500">
              {customDraft
                ? `AI will map this request to ${customDraft.label}.`
                : "AI will map your wording to the closest live platform metric."}
            </div>
          </div>
        )}

        <p className="text-sm text-ink-600">{selectedMeta.helper}</p>

        <div>
          <label className="label">Goal for</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { value: "company" as const, label: "Company-wide", helper: "Whole agency" },
              { value: "personal" as const, label: "For me", helper: user.name },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  scope === option.value
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                }`}
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-[11px] text-ink-500">{option.helper}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">
            Target ({selectedMeta.format === "money" ? "$" : "count"})
          </label>
          <input
            className="input"
            type="number"
            min={0}
            step={selectedMeta.format === "money" ? 1000 : 1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Period</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["monthly", "quarterly", "annual"] as PerformanceGoalPeriod[]).map((p) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md border px-2 py-1.5 text-sm capitalize ${
                    active
                      ? "border-gold-400 bg-gold-50 text-ink-900"
                      : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Due date (optional)</label>
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div className="text-[11px] text-ink-500 mt-1">
            A custom deadline for this requested target. If approved, it carries into the goal.
          </div>
        </div>

        <div>
          <label className="label">Note for manager</label>
          <textarea
            className="input min-h-[5.5rem] resize-none text-sm"
            placeholder="Why this goal would help, what you want to be measured on, or timing."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submitRequest}>
            <Target className="h-3.5 w-3.5" /> Send request
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Performance leaderboard
//
// Ranks every agent (and manager — they often write business too) on
// any of the analytics metrics surfaced elsewhere on the page. The
// metric selector chip-row lets a manager flip between dimensions in
// one click; clicking a leaderboard row jumps into that agent's
// full drill-down so the manager can investigate why a number is
// off without leaving Analytics.
// ---------------------------------------------------------------------

type BuiltInLeaderboardMetricKey =
  | "premiumUnderMgmt"
  | "boundPolicies"
  | "resolvedLast30"
  | "resolvedLifetime"
  | "openActivities"
  | "outboundMessages"
  | "responseRate"
  | "avgHandleMs"
  | "avgAckMs"
  | "docsUploaded"
  | "assignedClients";

type CustomLeaderboardMetricKey =
  | "newClients"
  | "newProspects"
  | "policiesRenewed"
  | "claimsOpened"
  | "claimsClosed";

type LeaderboardMetricKey = BuiltInLeaderboardMetricKey | CustomLeaderboardMetricKey;

interface LeaderboardMetricDef {
  key: LeaderboardMetricKey;
  label: string;
  format: "money" | "count" | "percent" | "duration";
  direction: "high" | "low"; // high = bigger is better
  blurb: string;
}

const LEADERBOARD_METRICS: LeaderboardMetricDef[] = [
  {
    key: "premiumUnderMgmt",
    label: "Premium under mgmt",
    format: "money",
    direction: "high",
    blurb: "Sum of bound-policy premium across each agent's book.",
  },
  {
    key: "boundPolicies",
    label: "Bound policies",
    format: "count",
    direction: "high",
    blurb: "Count of bound policies on each agent's clients.",
  },
  {
    key: "resolvedLast30",
    label: "Activities resolved (30d)",
    format: "count",
    direction: "high",
    blurb: "Activity Center tasks resolved in the last 30 days.",
  },
  {
    key: "resolvedLifetime",
    label: "Activities resolved (lifetime)",
    format: "count",
    direction: "high",
    blurb: "All-time activity resolutions.",
  },
  {
    key: "outboundMessages",
    label: "Outbound messages",
    format: "count",
    direction: "high",
    blurb: "AI / marketing messages sent on behalf of each agent's clients.",
  },
  {
    key: "responseRate",
    label: "Response rate",
    format: "percent",
    direction: "high",
    blurb: "Share of inbound client messages this agent has resolved.",
  },
  {
    key: "avgHandleMs",
    label: "Avg handle time",
    format: "duration",
    direction: "low",
    blurb: "Average time from in-progress → resolved on Activity Center cards.",
  },
  {
    key: "avgAckMs",
    label: "Avg ack time",
    format: "duration",
    direction: "low",
    blurb: "How quickly each agent acknowledges new notifications.",
  },
  {
    key: "docsUploaded",
    label: "Documents uploaded",
    format: "count",
    direction: "high",
    blurb: "Files this agent has shared into client files.",
  },
  {
    key: "assignedClients",
    label: "Book size",
    format: "count",
    direction: "high",
    blurb: "Active clients assigned to this agent.",
  },
  {
    key: "openActivities",
    label: "Open activities",
    format: "count",
    direction: "low",
    blurb: "Activity Center cards still on each agent's plate (lower = cleaner queue).",
  },
];

const CUSTOM_LEADERBOARD_METRICS: Record<CustomLeaderboardMetricKey, LeaderboardMetricDef> = {
  newClients: {
    key: "newClients",
    label: "New clients (30d)",
    format: "count",
    direction: "high",
    blurb: "Client profiles created in the last 30 days, ranked by assigned book.",
  },
  newProspects: {
    key: "newProspects",
    label: "New prospects (30d)",
    format: "count",
    direction: "high",
    blurb: "Prospect profiles created in the last 30 days and assigned to each staff member.",
  },
  policiesRenewed: {
    key: "policiesRenewed",
    label: "Policies renewed",
    format: "count",
    direction: "high",
    blurb: "Renewal records marked renewed for policies in each staff member's book.",
  },
  claimsOpened: {
    key: "claimsOpened",
    label: "Claims opened",
    format: "count",
    direction: "low",
    blurb: "Claims opened for each staff member's assigned clients. Lower usually means a cleaner book.",
  },
  claimsClosed: {
    key: "claimsClosed",
    label: "Claims closed",
    format: "count",
    direction: "high",
    blurb: "Closed claim files for each staff member's assigned clients.",
  },
};

function inferLeaderboardMetric(prompt: string): LeaderboardMetricDef {
  const q = prompt.trim().toLowerCase();
  const metric = (key: BuiltInLeaderboardMetricKey) => LEADERBOARD_METRICS.find((m) => m.key === key)!;
  if (/\b(ack|acknowledge|acknowledged|first response|response time|fastest response|quickest response)\b/.test(q)) {
    return metric("avgAckMs");
  }
  if (/\b(handle time|handling time|turnaround|cycle time|resolution time|fastest close|fastest resolve|quickest close)\b/.test(q)) {
    return metric("avgHandleMs");
  }
  if (/\b(response rate|reply rate|inbound rate|client replies|customer replies)\b/.test(q)) return metric("responseRate");
  if (/\b(backlog|open queue|open activities|open activity|open tasks|open task|pending tasks|pending task|unresolved)\b/.test(q)) {
    return metric("openActivities");
  }
  if (/\b(premium|revenue|written premium|book premium|aum|management|mgmt)\b/.test(q)) {
    return metric("premiumUnderMgmt");
  }
  if (/\b(book size|largest book|assigned clients|managed clients|client count|customer count|accounts managed)\b/.test(q)) {
    return metric("assignedClients");
  }
  if (/\b(new clients?|new customers?|new accounts?|client growth|customer growth)\b/.test(q)) {
    return CUSTOM_LEADERBOARD_METRICS.newClients;
  }
  if (/\b(prospect|prospects|lead|leads|quote start|quote starts)\b/.test(q)) {
    return CUSTOM_LEADERBOARD_METRICS.newProspects;
  }
  if (/\b(renew|renewal|renewed|retention)\b/.test(q)) return CUSTOM_LEADERBOARD_METRICS.policiesRenewed;
  if (/\b(closed|close|resolved|settled)\b/.test(q) && /\bclaim/.test(q)) return CUSTOM_LEADERBOARD_METRICS.claimsClosed;
  if (/\bclaim/.test(q)) return CUSTOM_LEADERBOARD_METRICS.claimsOpened;
  if (/\b(document|documents|doc|docs|upload|uploaded)\b/.test(q)) {
    return metric("docsUploaded");
  }
  if (/\b(message|messages|outbound|sms|email)\b/.test(q)) {
    return metric("outboundMessages");
  }
  if (/\b(policy|policies|bound|bind|bindings?)\b/.test(q)) return metric("boundPolicies");
  if (/\b(activity|activities|task|tasks|resolved|closed|completed|done)\b/.test(q)) {
    return metric("resolvedLast30");
  }
  return metric("resolvedLast30");
}

function formatLeaderboardValue(
  v: number | null,
  format: LeaderboardMetricDef["format"]
): string {
  if (v == null) return "—";
  if (format === "money") return fmt.money(v);
  if (format === "percent") return `${Math.round(v * 100)}%`;
  if (format === "duration") return formatDurationMs(v);
  return v.toLocaleString();
}

function PerformanceLeaderboard({
  agencyId,
  onOpenAgent,
}: {
  agencyId: string;
  onOpenAgent: (id: string) => void;
}) {
  const [metricKey, setMetricKey] = useState<BuiltInLeaderboardMetricKey>("premiumUnderMgmt");
  const [customMetricPrompt, setCustomMetricPrompt] = useState("");
  const customMetric = customMetricPrompt.trim()
    ? inferLeaderboardMetric(customMetricPrompt)
    : null;
  const selectedMetricKey = customMetric?.key ?? metricKey;
  const metric = customMetric ?? LEADERBOARD_METRICS.find((m) => m.key === metricKey)!;

  const agents = useMemo(
    () =>
      api.users
        .list(agencyId)
        .filter((u) => u.role === "agent" || u.role === "manager"),
    [agencyId]
  );

  // Pull each agent's full metrics bundle (memoized inside the hook).
  // We can't conditionally call hooks in a loop, so compute the
  // values inline using the same listing the per-agent hook uses.
  const rows = useMemo(() => {
    return agents.map((a) => {
      const customers = api.customers
        .list(agencyId)
        .filter(
          (c) => c.assignedAgentId === a.id || (c.additionalAgentIds ?? []).includes(a.id)
        );
      const customerIds = new Set(customers.map((c) => c.id));
      const prospects = api.prospects
        .listByTenant(agencyId)
        .filter(
          (p) =>
            p.assignedAgentId === a.id ||
            (p.additionalAgentIds ?? []).includes(a.id)
        );
      const policies = api.policies
        .listByTenant(agencyId)
        .filter((p) => customerIds.has(p.customerId));
      const tasks = api.tasks
        .listByTenant(agencyId)
        .filter(
          (t) => t.assignedToId === a.id || (t.additionalAssignedToIds ?? []).includes(a.id)
        );
      const notifications = api.aiNotifications
        .listByTenant(agencyId)
        .filter((n) => n.assignedToId === a.id);
      const claims = api.claims
        .listByTenant(agencyId)
        .filter((claim) => customerIds.has(claim.customerId));
      const renewals = api.renewals
        .listByTenant(agencyId)
        .filter((renewal) => {
          const policy = api.policies.get(renewal.policyId);
          return policy ? customerIds.has(policy.customerId) : false;
        });
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const newClients = customers.filter((c) => new Date(c.createdAt).getTime() >= since).length;
      const newProspects = prospects.filter((p) => new Date(p.createdAt).getTime() >= since).length;
      const resolved30 = tasks.filter(
        (t) => t.completedAt && new Date(t.completedAt).getTime() >= since
      ).length;
      const resolvedLifetime = tasks.filter((t) => !!t.completedAt).length;
      const openActivities = tasks.filter((t) => !t.completedAt).length;
      const handleSamples = tasks
        .filter((t) => t.startedAt && t.completedAt)
        .map(
          (t) =>
            new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()
        )
        .filter((n) => n > 0);
      const ackSamples = notifications
        .filter((n) => n.acknowledgedAt)
        .map(
          (n) =>
            new Date(n.acknowledgedAt!).getTime() -
            new Date(n.createdAt).getTime()
        )
        .filter((n) => n > 0);
      const allInboundForBook = customers.flatMap((c) =>
        api.communications.listByCustomer(c.id).filter((cm) => cm.direction === "inbound")
      );
      const resolvedInbound = allInboundForBook.filter((c) => c.resolvedAt).length;
      const outbound = api.marketing
        .listMessages(agencyId)
        .filter(
          (m) =>
            m.customerId &&
            customerIds.has(m.customerId) &&
            m.deliveryStatus === "sent"
        ).length;
      const docs = api.documents
        .listByTenant(agencyId)
        .filter((d) => d.uploadedById === a.id).length;
      const premium = policies
        .filter((p) => p.status === "bound")
        .reduce((s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0), 0);
      const boundPolicies = policies.filter((p) => p.status === "bound").length;
      const values: Record<LeaderboardMetricKey, number | null> = {
        premiumUnderMgmt: premium,
        boundPolicies,
        resolvedLast30: resolved30,
        resolvedLifetime,
        openActivities,
        outboundMessages: outbound,
        responseRate:
          allInboundForBook.length === 0
            ? null
            : resolvedInbound / allInboundForBook.length,
        avgHandleMs: handleSamples.length ? avg(handleSamples) : null,
        avgAckMs: ackSamples.length ? avg(ackSamples) : null,
        docsUploaded: docs,
        assignedClients: customers.length,
        newClients,
        newProspects,
        policiesRenewed: renewals.filter((r) => r.status === "renewed").length,
        claimsOpened: claims.length,
        claimsClosed: claims.filter((claim) => claim.status === "closed").length,
      };
      return { agent: a, values };
    });
  }, [agentsKey(agents), agencyId]);

  const ranked = useMemo(() => {
    const dir = metric.direction;
    return [...rows].sort((a, b) => {
      const av = a.values[selectedMetricKey];
      const bv = b.values[selectedMetricKey];
      // Null values always rank last regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === "high" ? bv - av : av - bv;
    });
  }, [rows, metric, selectedMetricKey]);

  // Scale bar widths against the best non-null value so #1 always
  // fills the track. For low-is-better metrics we still draw the
  // bar based on relative speed (best → 100%, worst → ~10%).
  const scaleMax = useMemo(() => {
    const values = ranked
      .map((r) => r.values[selectedMetricKey])
      .filter((v): v is number => v != null);
    if (values.length === 0) return 1;
    if (metric.direction === "high") return Math.max(...values, 1);
    return Math.max(...values, 1);
  }, [ranked, metric, selectedMetricKey]);

  function barWidth(v: number | null): number {
    if (v == null || scaleMax === 0) return 0;
    if (metric.direction === "high") return Math.min(100, (v / scaleMax) * 100);
    // Lower = better → invert so the fastest agent gets the widest bar.
    const best =
      Math.min(
        ...ranked
          .map((r) => r.values[selectedMetricKey])
          .filter((x): x is number => x != null)
      ) || v;
    if (v === 0) return 100;
    return Math.max(8, Math.min(100, (best / v) * 100));
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-gold-600" />
            Performance leaderboard
          </span>
        }
        subtitle={metric.blurb}
      />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {LEADERBOARD_METRICS.map((m) => {
          const active = !customMetric && metricKey === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setMetricKey(m.key as BuiltInLeaderboardMetricKey);
                setCustomMetricPrompt("");
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                active
                  ? "bg-ink-900 text-white border-ink-900"
                  : "bg-white text-ink-700 border-ink-200 hover:bg-ink-50"
              }`}
            >
              {m.label}
              {m.direction === "low" && (
                <span className="ml-1 text-[10px] opacity-70">↓ lower</span>
              )}
            </button>
          );
        })}
        <AiCustomFilterChip
          value={customMetricPrompt}
          onChange={setCustomMetricPrompt}
          label="AI Custom"
          placeholder="ex: new prospects, policies renewed, claims closed, response rate"
        />
      </div>
      {customMetric && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50/50 px-3 py-2 text-xs text-gold-900">
          AI mapped this leaderboard to <span className="font-semibold">{customMetric.label}</span>.
        </div>
      )}

      {ranked.length === 0 ? (
        <div className="text-sm text-ink-400">No agents on this team yet.</div>
      ) : (
        <ol className="space-y-2">
          {ranked.map((row, i) => {
            const v = row.values[selectedMetricKey];
            const w = barWidth(v);
            // Rank badge styling — gold / silver / bronze for top 3,
            // muted ink for everyone else.
            const tone =
              i === 0
                ? "bg-gold-100 text-gold-800 border-gold-300"
                : i === 1
                ? "bg-ink-100 text-ink-800 border-ink-300"
                : i === 2
                ? "bg-amber-100 text-amber-800 border-amber-300"
                : "bg-white text-ink-500 border-ink-200";
            return (
              <li key={row.agent.id}>
                <button
                  type="button"
                  onClick={() => onOpenAgent(row.agent.id)}
                  className="w-full text-left rounded-md border border-ink-100 bg-white hover:bg-ink-50/40 px-3 py-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-flex items-center justify-center min-w-[28px] h-7 rounded-md border text-xs font-semibold tabular-nums ${tone}`}
                    >
                      {i < 3 ? (
                        i === 0 ? (
                          <Trophy className="h-3.5 w-3.5" />
                        ) : (
                          <Medal className="h-3.5 w-3.5" />
                        )
                      ) : (
                        i + 1
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-ink-900 truncate">
                          {row.agent.name}
                          <span className="ml-1.5 text-[10px] uppercase tracking-wider text-ink-400">
                            {row.agent.role === "manager" ? "Manager" : "Agent"}
                          </span>
                        </span>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatLeaderboardValue(v, metric.format)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                        <div
                          className={`h-full ${
                            i === 0
                              ? "bg-gold-400"
                              : i === 1
                              ? "bg-ink-400"
                              : i === 2
                              ? "bg-amber-400"
                              : "bg-ink-300"
                          }`}
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// Cheap stable key so the rows useMemo invalidates only when the
// set of agent IDs changes (not on every render).
function agentsKey(agents: { id: string }[]): string {
  return agents.map((a) => a.id).sort().join("|");
}

function PeriodStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-ink-500 mt-0.5">{hint}</div>}
    </div>
  );
}

interface TrendBucket {
  label: string;
  startsAt: string;
  resolved: number;
  inbound: number;
  outbound: number;
  newCustomers: number;
  premiumWritten: number;
}

// Color tokens per chart tone. Hex literals so the SVG (which
// can't read Tailwind classes for stroke/fill) renders exactly
// the same as the legend square next to the title.
const TONE_COLORS: Record<
  "emerald" | "indigo" | "gold" | "violet",
  { stroke: string; fill: string; tint: string }
> = {
  emerald: { stroke: "#059669", fill: "#10B981", tint: "rgba(16,185,129,0.12)" },
  indigo: { stroke: "#4F46E5", fill: "#6366F1", tint: "rgba(99,102,241,0.12)" },
  gold: { stroke: "#876826", fill: "#a98532", tint: "rgba(169,133,50,0.12)" },
  violet: { stroke: "#7C3AED", fill: "#8B5CF6", tint: "rgba(139,92,246,0.12)" },
};

function TrendChart({
  title,
  buckets,
  valueKey,
  tone,
}: {
  title: string;
  buckets: TrendBucket[];
  valueKey: keyof Pick<TrendBucket, "resolved" | "inbound" | "outbound" | "newCustomers">;
  tone: "emerald" | "indigo" | "gold" | "violet";
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Chart geometry — viewBox renders at a fixed 16:9-ish aspect
  // that scales cleanly with the container. preserveAspectRatio
  // defaults to "xMidYMid meet" so the SVG never stretches; this
  // keeps line slopes accurate at any width.
  const W = 640;
  const H = 260;
  const PAD = { top: 16, right: 16, bottom: 32, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...buckets.map((b) => b[valueKey] as number));
  // "Nice" axis max + tick step so the y-axis reads as 0/3/6/9
  // instead of 0/3.33/6.66/10.
  const niceMax = niceCeil(max);
  const tickStep = niceMax / 4;
  const ticks = Array.from({ length: 5 }, (_, i) => i * tickStep);

  function xFor(i: number): number {
    if (buckets.length <= 1) return PAD.left + innerW / 2;
    return PAD.left + (i / (buckets.length - 1)) * innerW;
  }
  function yFor(v: number): number {
    return PAD.top + (1 - v / niceMax) * innerH;
  }

  const c = TONE_COLORS[tone];
  const points = buckets.map((b, i) => ({
    x: xFor(i),
    y: yFor(b[valueKey] as number),
    v: b[valueKey] as number,
    label: b.label,
  }));
  const linePath =
    points.length > 0
      ? "M " + points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ")
      : "";
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${PAD.top + innerH} L ${points[0].x.toFixed(
          2
        )} ${PAD.top + innerH} Z`
      : "";

  // Limit x-axis tick labels to ~6 so they don't overlap.
  const xLabelStride = Math.max(1, Math.ceil(buckets.length / 6));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let dist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - px);
      if (d < dist) {
        dist = d;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  }

  const hover = hoverIdx != null ? points[hoverIdx] : null;
  // Unique-per-chart gradient id so a multi-chart page doesn't
  // share a single <defs> entry across tones.
  const gradId = `tg-${tone}-${valueKey}`;

  return (
    <div className="rounded-md border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-ink-500 flex items-center gap-1.5 font-medium">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: c.fill }}
          />
          {title}
        </div>
        <div className="text-[11px] text-ink-400 tabular-nums">
          Peak <span className="text-ink-700 font-medium">{max}</span>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto cursor-crosshair"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={onMove}
          role="img"
          aria-label={title}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.fill} stopOpacity={0.28} />
              <stop offset="100%" stopColor={c.fill} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines + y-axis labels */}
          {ticks.map((t, i) => {
            const y = yFor(t);
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  stroke="#e9e8e3"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? "" : "3 4"}
                />
                <text
                  x={PAD.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#a8a394"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {Math.round(t)}
                </text>
              </g>
            );
          })}

          {/* x-axis baseline */}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + innerH}
            y2={PAD.top + innerH}
            stroke="#cfccc1"
            strokeWidth={1}
          />

          {/* Area + line */}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={c.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover crosshair */}
          {hover && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke={c.stroke}
              strokeWidth={1}
              strokeDasharray="3 4"
              opacity={0.45}
            />
          )}

          {/* Data points — only show on hover OR when there are <= 16 buckets
              so a 1y monthly view still gets visible markers, but a 30d
              daily view doesn't get cluttered. */}
          {points.length <= 16 &&
            points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={hoverIdx === i ? 5 : 3}
                fill={hoverIdx === i ? c.stroke : "white"}
                stroke={c.stroke}
                strokeWidth={1.75}
              />
            ))}
          {/* For denser series, just show the hovered point. */}
          {points.length > 16 && hover && (
            <circle
              cx={hover.x}
              cy={hover.y}
              r={5}
              fill={c.stroke}
              stroke="white"
              strokeWidth={2}
            />
          )}

          {/* X-axis labels — every Nth bucket so they don't collide */}
          {points.map((p, i) =>
            i % xLabelStride === 0 || i === points.length - 1 ? (
              <text
                key={i}
                x={p.x}
                y={H - 10}
                textAnchor="middle"
                fontSize={11}
                fill="#a8a394"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {p.label}
              </text>
            ) : null
          )}
        </svg>

        {/* Tooltip */}
        {hover && (
          <div
            className="absolute pointer-events-none z-10"
            style={{
              left: `${(hover.x / W) * 100}%`,
              top: `${(hover.y / H) * 100}%`,
              transform: `translate(${hover.x > W * 0.7 ? "calc(-100% - 12px)" : "12px"}, -100%)`,
            }}
          >
            <div className="rounded-md bg-ink-900 text-white text-[11px] px-3 py-2 shadow-luxe whitespace-nowrap">
              <div className="text-ink-200">{hover.label}</div>
              <div className="font-semibold tabular-nums text-sm leading-tight">
                {hover.v}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Round `n` up to a chart-friendly axis max so the y-ticks read
// as 0 / 3 / 6 / 9 / 12 rather than 0 / 2.5 / 5 / 7.5 / 10. Picks
// a power of 10 base and snaps to a 1/2/2.5/5/10 multiplier.
function niceCeil(n: number): number {
  if (n <= 0) return 4;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  let nice: number;
  if (f <= 1) nice = 1;
  else if (f <= 2) nice = 2;
  else if (f <= 2.5) nice = 2.5;
  else if (f <= 5) nice = 5;
  else nice = 10;
  return Math.max(4, nice * base);
}

function buildTrendSeries(agencyId: string, tf: Timeframe) {
  const now = Date.now();
  const periodDays = tf === "7d" ? 7 : tf === "30d" ? 30 : tf === "90d" ? 90 : 365;
  // Pick a bucket size that keeps the chart readable. Day-level
  // for short windows, week-level for 90d, month-level for the year.
  const bucketDays = tf === "7d" ? 1 : tf === "30d" ? 1 : tf === "90d" ? 7 : 30;
  const bucketCount = Math.ceil(periodDays / bucketDays);
  const startMs = now - periodDays * 24 * 60 * 60 * 1000;

  const buckets: TrendBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const startsAt = new Date(startMs + i * bucketDays * 24 * 60 * 60 * 1000);
    return {
      label:
        bucketDays === 1
          ? fmt.date(startsAt.toISOString())
          : bucketDays === 7
          ? `Wk ${Math.floor(i + 1)}`
          : startsAt.toLocaleString("en-US", { month: "short" }),
      startsAt: startsAt.toISOString(),
      resolved: 0,
      inbound: 0,
      outbound: 0,
      newCustomers: 0,
      premiumWritten: 0,
    };
  });

  function bucketOf(iso?: string): number {
    if (!iso) return -1;
    const t = new Date(iso).getTime();
    if (t < startMs) return -1;
    return Math.min(bucketCount - 1, Math.floor((t - startMs) / (bucketDays * 24 * 60 * 60 * 1000)));
  }

  // Tasks resolved per bucket
  api.tasks.listByTenant(agencyId).forEach((t) => {
    if (!t.completedAt) return;
    const b = bucketOf(t.completedAt);
    if (b >= 0) buckets[b].resolved += 1;
  });
  // Inbound customer comms
  api.customers.list(agencyId).forEach((c) => {
    api.communications.listByCustomer(c.id).forEach((cm) => {
      if (cm.direction !== "inbound") return;
      const b = bucketOf(cm.createdAt);
      if (b >= 0) buckets[b].inbound += 1;
    });
  });
  // Outbound marketing messages
  api.marketing.listMessages(agencyId).forEach((m) => {
    if (m.deliveryStatus !== "sent") return;
    const b = bucketOf(m.sentAt ?? m.createdAt);
    if (b >= 0) buckets[b].outbound += 1;
  });
  // New customers + premium written
  api.customers.list(agencyId).forEach((c) => {
    const b = bucketOf(c.createdAt);
    if (b >= 0) buckets[b].newCustomers += 1;
  });
  api.policies.listByTenant(agencyId).forEach((p) => {
    if (p.status !== "bound") return;
    const b = bucketOf(p.createdAt);
    if (b >= 0) buckets[b].premiumWritten += p.finalPremium ?? p.premiumEstimate ?? 0;
  });

  const totals = buckets.reduce(
    (acc, b) => ({
      resolved: acc.resolved + b.resolved,
      inbound: acc.inbound + b.inbound,
      outbound: acc.outbound + b.outbound,
      newCustomers: acc.newCustomers + b.newCustomers,
      premiumWritten: acc.premiumWritten + b.premiumWritten,
    }),
    { resolved: 0, inbound: 0, outbound: 0, newCustomers: 0, premiumWritten: 0 }
  );

  return { buckets, totals };
}

// ---------------------------------------------------------------------
// Agency-wide overview tiles
// ---------------------------------------------------------------------

function AgencyOverview({ agencyId }: { agencyId: string }) {
  const m = useAgencyMetrics(agencyId);
  // Same per-metric quick-view as the per-agent drill-down, just
  // without an agentId scope so the modal lists tenant-wide
  // records.
  const [viewing, setViewing] = useState<MetricKey | null>(null);
  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active clients"
          value={m.activeClients}
          icon={<Users className="h-5 w-5" />}
          hint={`${m.personalClients} personal · ${m.commercialClients} commercial`}
          onClick={() => setViewing("assignedClients")}
        />
        <StatCard
          label="Personal lines clients"
          value={m.personalClients}
          icon={<Users className="h-5 w-5" />}
          hint="≥ 1 personal-lines policy"
          onClick={() => setViewing("personalClients")}
        />
        <StatCard
          label="Commercial lines clients"
          value={m.commercialClients}
          icon={<Users className="h-5 w-5" />}
          hint="≥ 1 commercial-lines policy"
          onClick={() => setViewing("commercialClients")}
        />
        <StatCard
          label="Bound policies"
          value={m.boundPolicies}
          icon={<ShieldCheck className="h-5 w-5" />}
          onClick={() => setViewing("boundPolicies")}
        />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        <StatCard
          label="Premium under mgmt"
          value={fmt.money(m.premiumUnderMgmt)}
          icon={<TrendingUp className="h-5 w-5" />}
          onClick={() => setViewing("premiumUnderMgmt")}
        />
        <StatCard
          label="Activities open"
          value={m.openActivities}
          icon={<BarChart3 className="h-5 w-5" />}
          onClick={() => setViewing("openActivities")}
        />
        <StatCard
          label="Resolved (30d)"
          value={m.resolvedLast30}
          icon={<CheckCircle2 className="h-5 w-5" />}
          hint={m.avgHandleMs ? `Avg handle ${formatDurationMs(m.avgHandleMs)}` : undefined}
          onClick={() => setViewing("resolvedLast30")}
        />
      </div>

      <MetricDetailModal
        metric={viewing}
        agencyId={agencyId}
        onClose={() => setViewing(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------
// Per-agent card on the overview grid
// ---------------------------------------------------------------------

function AgentCard({
  agencyId,
  agent,
  onOpen,
}: {
  agencyId: string;
  agent: { id: string; name: string; role: string };
  onOpen: () => void;
}) {
  const m = useAgentMetrics(agencyId, agent.id);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border border-ink-100 bg-white shadow-luxe p-4 hover:border-gold-300 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900 truncate">{agent.name}</div>
          <div className="text-[11px] text-ink-500 uppercase tracking-wider mt-0.5">
            {agent.role}
          </div>
        </div>
        <Badge tone={m.openActivities > 0 ? "warn" : "success"}>
          {m.openActivities > 0 ? `${m.openActivities} open` : "Caught up"}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <MetricLine label="Clients" value={m.assignedClients} />
        <MetricLine label="Bound policies" value={m.boundPolicies} />
        <MetricLine label="Resolved (30d)" value={m.resolvedLast30} />
        <MetricLine label="Premium" value={fmt.money(m.premiumUnderMgmt)} />
        <MetricLine
          label="Avg handle"
          value={m.avgHandleMs ? formatDurationMs(m.avgHandleMs) : "—"}
        />
        <MetricLine
          label="Avg response"
          value={m.avgAckMs ? formatDurationMs(m.avgAckMs) : "—"}
        />
      </dl>
    </button>
  );
}

function MetricLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------
// Drill-down view
// ---------------------------------------------------------------------

type MetricKey =
  | "assignedClients"
  | "personalClients"
  | "commercialClients"
  | "boundPolicies"
  | "premiumUnderMgmt"
  | "renewalsUpcoming"
  | "openActivities"
  | "inProgress"
  | "resolvedLast30"
  | "avgHandleMs"
  | "avgAckMs"
  | "resolvedLifetime"
  | "inboundRequests"
  | "responseRate"
  | "outboundMessages"
  | "docsUploaded"
  | "openClaims"
  | "closedClaims"
  | "avgClaimCloseMs";

function AgentDrilldown({
  agent,
  agencyId,
  onBack,
}: {
  agent: { id: string; name: string; role: string; email: string };
  agencyId: string;
  onBack: () => void;
}) {
  const m = useAgentMetrics(agencyId, agent.id);
  const [viewing, setViewing] = useState<MetricKey | null>(null);
  const tasks = api.tasks
    .listByTenant(agencyId)
    .filter((t) => t.assignedToId === agent.id);
  const resolvedTasks = tasks
    .filter((t) => t.completedAt)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1))
    .slice(0, 8);
  const openTasksTop = tasks
    .filter((t) => !t.completedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Back to team
      </button>
      <div>
        <h1 className="font-display text-3xl">{agent.name}</h1>
        <p className="text-ink-500 text-sm mt-1">
          {fmt.titleCase(agent.role)} · {agent.email}
        </p>
      </div>

      {/* Book / clients block */}
      <Section title="Book & clients">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Assigned clients" value={m.assignedClients} icon={<Users className="h-5 w-5" />} onClick={() => setViewing("assignedClients")} />
          <StatCard label="Bound policies" value={m.boundPolicies} icon={<ShieldCheck className="h-5 w-5" />} onClick={() => setViewing("boundPolicies")} />
          <StatCard
            label="Premium under mgmt"
            value={fmt.money(m.premiumUnderMgmt)}
            icon={<TrendingUp className="h-5 w-5" />}
            onClick={() => setViewing("premiumUnderMgmt")}
          />
          <StatCard
            label="Renewals upcoming"
            value={m.renewalsUpcoming}
            icon={<UserCheck className="h-5 w-5" />}
            onClick={() => setViewing("renewalsUpcoming")}
          />
        </div>
      </Section>

      {/* Activity Center performance */}
      <Section title="Activity Center performance">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Open activities" value={m.openActivities} icon={<BarChart3 className="h-5 w-5" />} onClick={() => setViewing("openActivities")} />
          <StatCard label="In progress" value={m.inProgress} icon={<Sparkles className="h-5 w-5" />} onClick={() => setViewing("inProgress")} />
          <StatCard label="Resolved (30d)" value={m.resolvedLast30} icon={<CheckCircle2 className="h-5 w-5" />} onClick={() => setViewing("resolvedLast30")} />
          <StatCard
            label="Avg handle time"
            value={m.avgHandleMs ? formatDurationMs(m.avgHandleMs) : "—"}
            icon={<Timer className="h-5 w-5" />}
            hint="From Started → Resolved"
            onClick={() => setViewing("avgHandleMs")}
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <StatCard
            label="Avg time-to-acknowledge"
            value={m.avgAckMs ? formatDurationMs(m.avgAckMs) : "—"}
            icon={<Clock className="h-5 w-5" />}
            hint="From notification arrived → Acknowledged"
            onClick={() => setViewing("avgAckMs")}
          />
          <StatCard
            label="Resolved (lifetime)"
            value={m.resolvedLifetime}
            icon={<CheckCircle2 className="h-5 w-5" />}
            onClick={() => setViewing("resolvedLifetime")}
          />
        </div>
      </Section>

      {/* Customer engagement */}
      <Section title="Customer engagement & outreach">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Inbound requests" value={m.inboundRequests} hint="Customer-initiated" onClick={() => setViewing("inboundRequests")} />
          <StatCard
            label="Response rate"
            value={m.responseRate != null ? `${Math.round(m.responseRate * 100)}%` : "—"}
            hint="Resolved / total inbound"
            onClick={() => setViewing("responseRate")}
          />
          <StatCard label="Outbound messages" value={m.outboundMessages} hint="AI + custom" onClick={() => setViewing("outboundMessages")} />
          <StatCard label="Documents uploaded" value={m.docsUploaded} onClick={() => setViewing("docsUploaded")} />
        </div>
      </Section>

      {/* Claims */}
      <Section title="Claims">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Open claims" value={m.openClaims} onClick={() => setViewing("openClaims")} />
          <StatCard label="Closed claims" value={m.closedClaims} onClick={() => setViewing("closedClaims")} />
          <StatCard
            label="Avg time-to-close"
            value={m.avgClaimCloseMs ? formatDurationMs(m.avgClaimCloseMs) : "—"}
            onClick={() => setViewing("avgClaimCloseMs")}
          />
        </div>
      </Section>

      <MetricDetailModal
        metric={viewing}
        agentId={agent.id}
        agentName={agent.name}
        agencyId={agencyId}
        onClose={() => setViewing(null)}
      />

      {/* Agent activities (open queue) */}
      <Section title={`Agent activities (${openTasksTop.length})`}>
        {openTasksTop.length === 0 ? (
          <div className="text-sm text-ink-400">No open activities.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {openTasksTop.map((t) => {
              const status = api.tasks.statusOf(t);
              const pill =
                status === "in_progress"
                  ? { label: "In progress", cls: "bg-blue-50 text-blue-700 border-blue-200" }
                  : status === "snoozed"
                  ? { label: "Snoozed", cls: "bg-amber-50 text-amber-700 border-amber-200" }
                  : { label: "To do", cls: "bg-rose-50 text-rose-700 border-rose-200" };
              return (
                <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink-700 truncate">{t.title}</div>
                    <div className="text-[11px] text-ink-400">
                      Opened {fmt.dateTime(t.createdAt)} · {fmt.relative(t.createdAt)} ago
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 border text-[10px] uppercase tracking-wider font-semibold ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                    <Link
                      to={`/employee/tasks?focus=${encodeURIComponent(t.id)}`}
                      className="btn-outline text-[11px] inline-flex"
                    >
                      View
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Recently resolved — pinned to the bottom */}
      <Section
        title={`Recently resolved (${resolvedTasks.length})`}
        collapsible
        defaultOpen={false}
      >
        {resolvedTasks.length === 0 ? (
          <div className="text-sm text-ink-400">No resolved activities yet.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {resolvedTasks.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink-700 truncate">{t.title}</div>
                  <div className="text-[11px] text-ink-400">
                    Resolved {fmt.dateTime(t.completedAt!)}
                    {t.startedAt && (
                      <> · Handle time {formatDurationMs(
                        new Date(t.completedAt!).getTime() - new Date(t.startedAt).getTime()
                      )}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-block rounded px-1.5 py-0.5 border text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
                    Resolved
                  </span>
                  <Link
                    to={`/employee/tasks?focus=${encodeURIComponent(t.id)}`}
                    className="btn-outline text-[11px] inline-flex"
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <Card>
        <CardHeader title={title} />
        {children}
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          <button
            type="button"
            className="btn-outline text-xs inline-flex"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <>
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Show <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        }
      />
      {open && children}
    </Card>
  );
}

// ---------------------------------------------------------------------
// Metric detail modal — lists the underlying records for a stat
// card so a manager can click any number and see exactly which
// clients / policies / activities / claims drive it.
// ---------------------------------------------------------------------

const METRIC_TITLE: Record<MetricKey, string> = {
  assignedClients: "Assigned clients",
  personalClients: "Personal lines clients",
  commercialClients: "Commercial lines clients",
  boundPolicies: "Bound policies",
  premiumUnderMgmt: "Premium under management",
  renewalsUpcoming: "Renewals upcoming",
  openActivities: "Open activities",
  inProgress: "In progress",
  resolvedLast30: "Resolved in the last 30 days",
  avgHandleMs: "Average handle time — per activity",
  avgAckMs: "Average time-to-acknowledge — per notification",
  resolvedLifetime: "Resolved (lifetime)",
  inboundRequests: "Inbound customer requests",
  responseRate: "Response rate",
  outboundMessages: "Outbound messages",
  docsUploaded: "Documents uploaded",
  openClaims: "Open claims",
  closedClaims: "Closed claims",
  avgClaimCloseMs: "Average time-to-close — per claim",
};

function MetricDetailModal({
  metric,
  agentId,
  agentName,
  agencyId,
  onClose,
}: {
  metric: MetricKey | null;
  // When omitted, the modal scopes to the entire agency (used by
  // the AgencyOverview quick-view cards).
  agentId?: string;
  agentName?: string;
  agencyId: string;
  onClose: () => void;
}) {
  if (!metric) return null;
  const title = agentName
    ? `${agentName} — ${METRIC_TITLE[metric]}`
    : `Agency — ${METRIC_TITLE[metric]}`;
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <MetricDetailBody metric={metric} agentId={agentId} agencyId={agencyId} />
    </Modal>
  );
}

function MetricDetailBody({
  metric,
  agentId,
  agencyId,
}: {
  metric: MetricKey;
  agentId?: string;
  agencyId: string;
}) {
  // Re-build the same scoped datasets the metrics card used so
  // the modal shows the exact records driving the headline number.
  // When agentId is undefined we're in agency-wide mode (e.g.,
  // the AgencyOverview cards) — drop the per-agent filter.
  const customers = api.customers
    .list(agencyId)
    .filter((c) => (agentId ? c.assignedAgentId === agentId : !c.archived));
  const customerIds = new Set(customers.map((c) => c.id));
  const policies = api.policies
    .listByTenant(agencyId)
    .filter((p) => customerIds.has(p.customerId));
  const tasks = api.tasks
    .listByTenant(agencyId)
    .filter((t) => (agentId ? t.assignedToId === agentId : true));
  const notifications = api.aiNotifications
    .listByTenant(agencyId)
    .filter((n) => (agentId ? n.assignedToId === agentId : true));
  const renewals = api.renewals
    .listByTenant(agencyId)
    .filter((r) => {
      const p = api.policies.get(r.policyId);
      return p && customerIds.has(p.customerId);
    });
  const allInboundForBook = customers.flatMap((c) =>
    api.communications.listByCustomer(c.id).filter((cm) => cm.direction === "inbound")
  );
  const outbound = api.marketing
    .listMessages(agencyId)
    .filter(
      (m) => m.customerId && customerIds.has(m.customerId) && m.deliveryStatus === "sent"
    );
  const docs = api.documents
    .listByTenant(agencyId)
    .filter((d) => d.uploadedById === agentId);
  const claims = api.claims
    .listByTenant(agencyId)
    .filter((cl) => customerIds.has(cl.customerId));
  const since30 = Date.now() - 30 * 24 * 60 * 60 * 1000;

  switch (metric) {
    case "assignedClients":
      return <ClientList customers={customers} />;
    case "personalClients": {
      const ids = new Set(
        policies
          .filter(
            (p) => (p.department ?? "personal") === "personal" && p.status === "bound"
          )
          .map((p) => p.customerId)
      );
      return (
        <ClientList customers={customers.filter((c) => ids.has(c.id))} />
      );
    }
    case "commercialClients": {
      const ids = new Set(
        policies
          .filter((p) => p.department === "commercial" && p.status === "bound")
          .map((p) => p.customerId)
      );
      return (
        <ClientList customers={customers.filter((c) => ids.has(c.id))} />
      );
    }
    case "boundPolicies":
      return <PolicyList policies={policies.filter((p) => p.status === "bound")} />;
    case "premiumUnderMgmt": {
      const bound = policies.filter((p) => p.status === "bound");
      const total = bound.reduce(
        (s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0),
        0
      );
      return (
        <>
          <div className="text-xs text-ink-500 mb-3">
            Total bound premium: <strong>{fmt.money(total)}</strong>
          </div>
          <PolicyList policies={bound} showPremium />
        </>
      );
    }
    case "renewalsUpcoming":
      return <RenewalList renewals={renewals.filter((r) => r.status === "upcoming")} />;
    case "openActivities":
      return <TaskList tasks={tasks.filter((t) => !t.completedAt && api.tasks.statusOf(t) !== "snoozed")} />;
    case "inProgress":
      return <TaskList tasks={tasks.filter((t) => api.tasks.statusOf(t) === "in_progress")} />;
    case "resolvedLast30":
      return (
        <TaskList
          tasks={tasks.filter(
            (t) => t.completedAt && new Date(t.completedAt).getTime() >= since30
          )}
          showResolutionTime
        />
      );
    case "resolvedLifetime":
      return (
        <TaskList tasks={tasks.filter((t) => t.completedAt)} showResolutionTime />
      );
    case "avgHandleMs":
      return (
        <TaskList
          tasks={tasks.filter((t) => t.startedAt && t.completedAt)}
          showHandleTime
        />
      );
    case "avgAckMs":
      return (
        <NotificationAckList
          notifications={notifications.filter((n) => n.acknowledgedAt)}
        />
      );
    case "inboundRequests":
      return <CommList comms={allInboundForBook} customers={customers} />;
    case "responseRate": {
      const resolved = allInboundForBook.filter((c) => c.resolvedAt).length;
      const pct = allInboundForBook.length
        ? Math.round((resolved / allInboundForBook.length) * 100)
        : 0;
      return (
        <>
          <div className="text-xs text-ink-500 mb-3">
            {resolved} of {allInboundForBook.length} inbound requests resolved ({pct}%).
          </div>
          <CommList comms={allInboundForBook} customers={customers} />
        </>
      );
    }
    case "outboundMessages":
      return <MessageList messages={outbound} />;
    case "docsUploaded":
      return <DocList docs={docs} />;
    case "openClaims":
      return <ClaimList claims={claims.filter((c) => c.status !== "closed")} />;
    case "closedClaims":
      return <ClaimList claims={claims.filter((c) => c.status === "closed")} showCloseTime />;
    case "avgClaimCloseMs":
      return (
        <ClaimList
          claims={claims.filter((c) => c.status === "closed" && c.closedAt)}
          showCloseTime
        />
      );
  }
}

// Sub-lists — each one renders the rows a manager would want to
// see when drilling into a particular metric. Empty states are
// included so a click on a zero-value tile still feels intentional.
//
// Every row uses ExpandableRow so the manager can click "View"
// to see the row's full detail inline — no page navigation, no
// modal stacking. Keeps the manager in the analytics flow.

function TaskList({
  tasks,
  showHandleTime,
  showResolutionTime,
}: {
  tasks: import("@/types").Task[];
  showHandleTime?: boolean;
  showResolutionTime?: boolean;
}) {
  if (tasks.length === 0) return <EmptyList label="Nothing to show in this slice." />;
  return (
    <ul className="divide-y divide-ink-100">
      {tasks.map((t) => {
        const handleMs =
          t.startedAt && t.completedAt
            ? new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()
            : null;
        const customer = t.customerId ? api.customers.get(t.customerId) : null;
        return (
          <ExpandableRow
            key={t.id}
            details={
              <div className="space-y-3">
                <DetailGrid
                  rows={[
                    { label: "Client", value: customer?.name ?? "—" },
                    {
                      label: "Severity",
                      value: t.severity ? fmt.titleCase(t.severity) : "—",
                    },
                    { label: "Status", value: fmt.titleCase(api.tasks.statusOf(t)) },
                    { label: "Opened", value: fmt.dateTime(t.createdAt) },
                    {
                      label: "Started",
                      value: t.startedAt ? fmt.dateTime(t.startedAt) : "—",
                    },
                    {
                      label: "Resolved",
                      value: t.completedAt ? fmt.dateTime(t.completedAt) : "—",
                    },
                    {
                      label: "Handle time",
                      value: handleMs != null ? formatDurationMs(handleMs) : "—",
                    },
                  ]}
                />
                {t.aiSummary && (
                  <div className="rounded border border-violet-100 bg-violet-50 px-3 py-2 text-violet-900">
                    <div className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold mb-1">
                      AI summary
                    </div>
                    <p className="leading-snug">{t.aiSummary}</p>
                  </div>
                )}
              </div>
            }
            link={{ to: `/employee/tasks?focus=${encodeURIComponent(t.id)}`, label: "Activity" }}
          >
            <div className="text-sm text-ink-900 truncate">{t.title}</div>
            <div className="text-[11px] text-ink-400 flex items-center gap-2 flex-wrap">
              <span>Opened {fmt.dateTime(t.createdAt)}</span>
              {showHandleTime && handleMs != null && (
                <span className="font-medium text-ink-900">
                  · Handle {formatDurationMs(handleMs)}
                </span>
              )}
              {showResolutionTime && t.completedAt && (
                <span>· Resolved {fmt.relative(t.completedAt)} ago</span>
              )}
              {!showHandleTime && !showResolutionTime && (
                <Badge tone={t.severity === "urgent" ? "error" : "warn"}>
                  {api.tasks.statusOf(t) === "in_progress" ? "In progress" : "Open"}
                </Badge>
              )}
            </div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

function NotificationAckList({ notifications }: { notifications: import("@/types").AiNotification[] }) {
  if (notifications.length === 0) return <EmptyList label="No acknowledged notifications yet." />;
  return (
    <ul className="divide-y divide-ink-100">
      {notifications.map((n) => {
        const ackMs = n.acknowledgedAt
          ? new Date(n.acknowledgedAt).getTime() - new Date(n.createdAt).getTime()
          : null;
        const customer = n.customerId ? api.customers.get(n.customerId) : null;
        return (
          <ExpandableRow
            key={n.id}
            details={
              <div className="space-y-3">
                <DetailGrid
                  rows={[
                    { label: "Client", value: customer?.name ?? "—" },
                    { label: "Topic", value: n.topic ? fmt.titleCase(n.topic) : "—" },
                    {
                      label: "Severity",
                      value: n.severity ? fmt.titleCase(n.severity) : "—",
                    },
                    { label: "Arrived", value: fmt.dateTime(n.createdAt) },
                    {
                      label: "Acknowledged",
                      value: n.acknowledgedAt ? fmt.dateTime(n.acknowledgedAt) : "—",
                    },
                    {
                      label: "Time-to-acknowledge",
                      value: ackMs != null ? formatDurationMs(ackMs) : "—",
                    },
                  ]}
                />
                {n.aiSummary && (
                  <div className="rounded border border-violet-100 bg-violet-50 px-3 py-2 text-violet-900">
                    {n.aiSummary}
                  </div>
                )}
              </div>
            }
          >
            <div className="text-sm text-ink-900 truncate">{n.title}</div>
            <div className="text-[11px] text-ink-400">
              Arrived {fmt.dateTime(n.createdAt)}
              {ackMs != null && (
                <span className="text-ink-900 font-medium"> · Ack {formatDurationMs(ackMs)}</span>
              )}
            </div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

function CommList({
  comms,
  customers,
}: {
  comms: import("@/types").Communication[];
  customers: import("@/types").CustomerProfile[];
}) {
  if (comms.length === 0) return <EmptyList label="No inbound requests yet." />;
  const byId = new Map(customers.map((c) => [c.id, c]));
  return (
    <ul className="divide-y divide-ink-100">
      {comms
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((m) => {
          const c = m.customerId ? byId.get(m.customerId) : null;
          return (
            <ExpandableRow
              key={m.id}
              link={c ? { to: `/employee/clients/${c.id}`, label: "Profile" } : undefined}
              details={
                <div className="space-y-3">
                  <DetailGrid
                    rows={[
                      { label: "Client", value: c?.name ?? "—" },
                      { label: "Subject", value: m.subject ?? "—" },
                      { label: "Channel", value: m.channel.toUpperCase() },
                      { label: "Direction", value: fmt.titleCase(m.direction) },
                      { label: "Received", value: fmt.dateTime(m.createdAt) },
                      {
                        label: "Resolved",
                        value: m.resolvedAt ? fmt.dateTime(m.resolvedAt) : "Still pending",
                      },
                    ]}
                  />
                  <pre className="rounded border border-ink-100 bg-white p-3 text-ink-700 whitespace-pre-wrap font-sans text-xs">
                    {m.body}
                  </pre>
                </div>
              }
            >
              <div className="text-sm text-ink-900 truncate">
                <span className="font-medium">{c?.name ?? "—"}</span>{" "}
                <span className="text-ink-500">{m.subject ?? "—"}</span>
              </div>
              <div className="text-[11px] text-ink-400 flex items-center gap-2 flex-wrap">
                <span>{m.channel.toUpperCase()} · {fmt.dateTime(m.createdAt)}</span>
                <Badge tone={m.resolvedAt ? "success" : "warn"}>
                  {m.resolvedAt ? "Resolved" : "Pending"}
                </Badge>
              </div>
            </ExpandableRow>
          );
        })}
    </ul>
  );
}

function MessageList({ messages }: { messages: import("@/types").MarketingMessage[] }) {
  if (messages.length === 0) return <EmptyList label="No outbound messages yet." />;
  return (
    <ul className="divide-y divide-ink-100">
      {messages
        .slice()
        .sort((a, b) =>
          (a.sentAt ?? a.createdAt) < (b.sentAt ?? b.createdAt) ? 1 : -1
        )
        .map((m) => {
          const c = m.customerId ? api.customers.get(m.customerId) : null;
          return (
            <ExpandableRow
              key={m.id}
              details={
                <div className="space-y-3">
                  <DetailGrid
                    rows={[
                      { label: "Recipient", value: c?.name ?? "—" },
                      { label: "Channel", value: m.channel.toUpperCase() },
                      { label: "Subject", value: m.subject ?? "—" },
                      { label: "Status", value: fmt.titleCase(m.deliveryStatus) },
                      {
                        label: "Sent",
                        value: fmt.dateTime(m.sentAt ?? m.createdAt),
                      },
                    ]}
                  />
                  <pre className="rounded border border-ink-100 bg-white p-3 text-ink-700 whitespace-pre-wrap font-sans text-xs">
                    {m.content}
                  </pre>
                </div>
              }
            >
              <div className="text-sm text-ink-900 truncate">
                {m.subject ?? `${m.channel.toUpperCase()} message`}
              </div>
              <div className="text-[11px] text-ink-400 flex items-center gap-2 flex-wrap">
                <span>
                  {c?.name ?? "—"} · {m.channel.toUpperCase()} ·{" "}
                  {fmt.dateTime(m.sentAt ?? m.createdAt)}
                </span>
                <Badge tone={m.deliveryStatus === "opened" ? "success" : "info"}>
                  {fmt.titleCase(m.deliveryStatus)}
                </Badge>
              </div>
            </ExpandableRow>
          );
        })}
    </ul>
  );
}

function DocList({ docs }: { docs: import("@/types").Document[] }) {
  // Uses the same shared DocumentViewerModal as the customer +
  // agent Documents pages, so the manager's quick-view here is
  // visually identical to what every other doc surface ships.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId ? docs.find((d) => d.id === viewingId) ?? null : null;
  if (docs.length === 0) return <EmptyList label="No documents uploaded yet." />;
  const sorted = docs
    .slice()
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  return (
    <>
      <ul className="divide-y divide-ink-100">
        {sorted.map((d) => {
          const c = d.customerId ? api.customers.get(d.customerId) : null;
          return (
            <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-900 truncate">{d.fileName}</div>
                <div className="text-[11px] text-ink-400">
                  {api.helpers.documentTypeLabel(d.type as string)}
                  {c ? ` · ${c.name}` : ""} · {fmt.relative(d.uploadedAt)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setViewingId(d.id)}
                  title="Quick view — opens the in-app document viewer"
                >
                  View
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => downloadDocumentStub(d)}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <DocumentViewerModal
        document={viewing}
        open={viewing != null}
        onClose={() => setViewingId(null)}
      />
    </>
  );
}

function ClaimList({
  claims,
  showCloseTime,
}: {
  claims: import("@/types").Claim[];
  showCloseTime?: boolean;
}) {
  if (claims.length === 0) return <EmptyList label="No claims in this slice." />;
  return (
    <ul className="divide-y divide-ink-100">
      {claims.map((c) => {
        const customer = api.customers.get(c.customerId);
        const carrier = api.carriers.get(c.carrierId);
        const policy = api.policies.get(c.policyId);
        return (
          <ExpandableRow
            key={c.id}
            link={{ to: `/employee/clients/${c.customerId}`, label: "Profile" }}
            details={
              <DetailGrid
                rows={[
                  { label: "Client", value: customer?.name ?? "—" },
                  { label: "Carrier", value: carrier?.name ?? "—" },
                  { label: "Policy", value: policy ? fmt.policyRef(policy) : "—" },
                  { label: "Status", value: fmt.titleCase(c.status) },
                  {
                    label: "Closed",
                    value: c.closedAt ? fmt.dateTime(c.closedAt) : "Still open",
                  },
                ]}
              />
            }
          >
            <div className="text-sm font-medium text-ink-900">{customer?.name ?? "—"}</div>
            <div className="text-[11px] text-ink-400 flex items-center gap-2 flex-wrap">
              <span>{fmt.titleCase(c.status)}</span>
              {showCloseTime && c.closedAt && (
                <span>· Closed {fmt.dateTime(c.closedAt)}</span>
              )}
              <Badge tone={c.status === "closed" ? "success" : "warn"}>
                {fmt.titleCase(c.status)}
              </Badge>
            </div>
          </ExpandableRow>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------

function useAgencyMetrics(agencyId: string) {
  return useMemo(() => {
    const customers = api.customers.list(agencyId);
    const policies = api.policies.listByTenant(agencyId);
    const tasks = api.tasks.listByTenant(agencyId);
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const resolved30 = tasks.filter(
      (t) => t.completedAt && new Date(t.completedAt).getTime() >= since
    );
    const handleSamples = resolved30
      .filter((t) => t.startedAt && t.completedAt)
      .map(
        (t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()
      )
      .filter((n) => n > 0);
    // Personal vs commercial split — a client counts toward a
    // line if they have ≥ 1 policy in that line. A client with
    // both kinds is counted on both tiles (these are not
    // mutually exclusive).
    const customersByDept = (dept: "personal" | "commercial") => {
      const ids = new Set(
        policies
          .filter((p) => (p.department ?? "personal") === dept && p.status === "bound")
          .map((p) => p.customerId)
      );
      return customers.filter((c) => !c.archived && ids.has(c.id)).length;
    };
    return {
      activeClients: customers.filter((c) => !c.archived).length,
      personalClients: customersByDept("personal"),
      commercialClients: customersByDept("commercial"),
      boundPolicies: policies.filter((p) => p.status === "bound").length,
      premiumUnderMgmt: policies
        .filter((p) => p.status === "bound")
        .reduce((s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0), 0),
      openActivities: tasks.filter((t) => !t.completedAt).length,
      resolvedLast30: resolved30.length,
      avgHandleMs: handleSamples.length ? avg(handleSamples) : null,
    };
  }, [agencyId]);
}

function useAgentMetrics(agencyId: string, agentId: string) {
  return useMemo(() => {
    const customers = api.customers
      .list(agencyId)
      .filter((c) => c.assignedAgentId === agentId);
    const customerIds = new Set(customers.map((c) => c.id));
    const policies = api.policies
      .listByTenant(agencyId)
      .filter((p) => customerIds.has(p.customerId));
    const tasks = api.tasks
      .listByTenant(agencyId)
      .filter((t) => t.assignedToId === agentId);
    const notifications = api.aiNotifications
      .listByTenant(agencyId)
      .filter((n) => n.assignedToId === agentId);
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const resolved30 = tasks.filter(
      (t) => t.completedAt && new Date(t.completedAt).getTime() >= since
    );
    const handleSamples = tasks
      .filter((t) => t.startedAt && t.completedAt)
      .map(
        (t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()
      )
      .filter((n) => n > 0);
    const ackSamples = notifications
      .filter((n) => n.acknowledgedAt)
      .map(
        (n) =>
          new Date(n.acknowledgedAt!).getTime() - new Date(n.createdAt).getTime()
      )
      .filter((n) => n > 0);
    const inboundComms = api.communications
      .listPendingForTenant(agencyId)
      .filter((c) => c.customerId && customerIds.has(c.customerId));
    const allInboundForBook = customers.flatMap((c) =>
      api.communications.listByCustomer(c.id).filter((cm) => cm.direction === "inbound")
    );
    const resolvedInbound = allInboundForBook.filter((c) => c.resolvedAt);
    const outboundMessages = api.marketing
      .listMessages(agencyId)
      .filter(
        (m) => m.customerId && customerIds.has(m.customerId) && m.deliveryStatus === "sent"
      );
    const docsUploaded = api.documents
      .listByTenant(agencyId)
      .filter((d) => d.uploadedById === agentId).length;
    const claims = api.claims
      .listByTenant(agencyId)
      .filter((cl) => customerIds.has(cl.customerId));
    const closed = claims.filter((c) => c.status === "closed");
    const claimSamples = closed
      .filter((c) => c.closedAt)
      .map(
        (c) =>
          new Date(c.closedAt!).getTime() -
          new Date((c as { createdAt?: string }).createdAt ?? c.closedAt!).getTime()
      )
      .filter((n) => n > 0);
    const renewals = api.renewals
      .listByTenant(agencyId)
      .filter((r) => {
        const policy = policies.find((p) => p.id === r.policyId);
        return policy && r.status === "upcoming";
      });
    return {
      assignedClients: customers.length,
      boundPolicies: policies.filter((p) => p.status === "bound").length,
      premiumUnderMgmt: policies
        .filter((p) => p.status === "bound")
        .reduce((s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0), 0),
      renewalsUpcoming: renewals.length,
      openActivities: tasks.filter((t) => !t.completedAt).length,
      inProgress: tasks.filter((t) => api.tasks.statusOf(t) === "in_progress").length,
      resolvedLast30: resolved30.length,
      resolvedLifetime: tasks.filter((t) => t.completedAt).length,
      avgHandleMs: handleSamples.length ? avg(handleSamples) : null,
      avgAckMs: ackSamples.length ? avg(ackSamples) : null,
      inboundRequests: allInboundForBook.length,
      responseRate:
        allInboundForBook.length === 0
          ? null
          : resolvedInbound.length / allInboundForBook.length,
      outboundMessages: outboundMessages.length,
      docsUploaded,
      openClaims: claims.filter((c) => c.status !== "closed").length,
      closedClaims: closed.length,
      avgClaimCloseMs: claimSamples.length ? avg(claimSamples) : null,
      pendingInbound: inboundComms.length,
    };
  }, [agencyId, agentId]);
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function formatDurationMs(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (hours < 24) return m ? `${hours}h ${m}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days}d ${h}h` : `${days}d`;
}
