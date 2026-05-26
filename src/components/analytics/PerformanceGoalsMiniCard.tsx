import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronRight, Target, XCircle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { GOAL_METRICS, coerceGoals, goalActual, goalScopeLabel, periodLabel } from "@/lib/performanceGoals";
import type { ArchivedPerformanceGoal, PerformanceGoal, PerformanceGoalScope } from "@/types";

// =====================================================================
// Compact dashboard widget: management's performance targets and where
// the agency stands right now. Company and Personal goals each get a
// pronounced group; clicking a group opens a modal listing all of
// that scope's CURRENT goals plus PREVIOUS achieved / not-achieved
// targets (timestamped). Shown to managers + agents.
// =====================================================================

export function PerformanceGoalsMiniCard({
  agencyId,
  isManager,
}: {
  agencyId: string;
  isManager: boolean;
}) {
  const agency = api.agencies.get(agencyId);
  const goals = coerceGoals(agency?.performanceGoals);
  const history = agency?.performanceGoalHistory ?? [];
  const company = goals.filter((g) => g.scope === "company");
  const personal = goals.filter((g) => g.scope === "personal");
  const [detail, setDetail] = useState<PerformanceGoalScope | null>(null);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <Target className="h-4 w-4 text-gold-600" /> Performance Targets
          </span>
        }
        subtitle="Where the agency stands against management's targets. Tap a group for full history."
        action={
          isManager ? (
            <Link
              to="/employee/analytics#performance-goals"
              className="btn-outline text-xs inline-flex"
            >
              Manage
            </Link>
          ) : undefined
        }
      />
      {goals.length === 0 && history.length === 0 ? (
        <div className="text-sm text-ink-400">
          No targets set yet.
          {isManager ? " Set them on the Analytics page." : ""}
        </div>
      ) : (
        <div className="space-y-4">
          <GoalGroup
            title="Company goals"
            accent="border-gold-300 bg-gold-50/40"
            dot="bg-gold-500"
            agencyId={agencyId}
            goals={company}
            onOpen={() => setDetail("company")}
          />
          <GoalGroup
            title="Personal goals"
            accent="border-indigo-200 bg-indigo-50/40"
            dot="bg-indigo-500"
            agencyId={agencyId}
            goals={personal}
            onOpen={() => setDetail("personal")}
          />
        </div>
      )}

      <GoalScopeDetailModal
        scope={detail}
        agencyId={agencyId}
        current={detail === "company" ? company : personal}
        history={history.filter((h) => h.scope === detail)}
        onClose={() => setDetail(null)}
      />
    </Card>
  );
}

function GoalGroup({
  title,
  accent,
  dot,
  agencyId,
  goals,
  onOpen,
}: {
  title: string;
  accent: string;
  dot: string;
  agencyId: string;
  goals: PerformanceGoal[];
  onOpen: () => void;
}) {
  return (
    <div className={`rounded-md border ${accent} p-3`}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between gap-2 mb-2.5"
        title="View current + previous targets"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-[11px] uppercase tracking-wider text-ink-700 font-bold">
            {title}
          </span>
          <span className="text-[10px] text-ink-400">· {goals.length}</span>
        </span>
        <span className="text-[10px] text-ink-500 inline-flex items-center gap-0.5">
          View all <ChevronRight className="h-3 w-3" />
        </span>
      </button>
      {goals.length === 0 ? (
        <div className="text-xs text-ink-400">No active goals — tap to see history.</div>
      ) : (
        <ul className="space-y-3">
          {goals.map((g) => (
            <GoalProgressRow key={g.id} agencyId={agencyId} goal={g} showScope={false} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalProgressRow({
  agencyId,
  goal,
  showScope,
}: {
  agencyId: string;
  goal: PerformanceGoal;
  showScope: boolean;
}) {
  const def = GOAL_METRICS.find((m) => m.key === goal.metric);
  const actual = goalActual(agencyId, goal);
  const pct = goal.target > 0 ? Math.min(150, Math.round((actual / goal.target) * 100)) : 0;
  const tone =
    pct >= 100 ? "bg-emerald-500" : pct >= 75 ? "bg-gold-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
  const fmtVal = (n: number) => (def?.format === "money" ? fmt.money(n) : n.toLocaleString());
  return (
    <li>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink-800 truncate">
          {def?.label ?? goal.metric}
          {(showScope || goal.scope === "personal") && (
            <span className="text-[10px] text-ink-400"> · {goalScopeLabel(agencyId, goal)}</span>
          )}
        </span>
        <span className="tabular-nums text-ink-600 shrink-0">
          {fmtVal(actual)} <span className="text-ink-400">/ {fmtVal(goal.target)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="text-[10px] text-ink-400 mt-0.5 flex items-center justify-between">
        <span className="font-medium text-ink-500">{pct}% complete</span>
        <span>per {periodLabel(goal.period)}</span>
      </div>
    </li>
  );
}

// Modal listing one scope's current goals + previous achieved / not
// achieved, all timestamped.
function GoalScopeDetailModal({
  scope,
  agencyId,
  current,
  history,
  onClose,
}: {
  scope: PerformanceGoalScope | null;
  agencyId: string;
  current: PerformanceGoal[];
  history: ArchivedPerformanceGoal[];
  onClose: () => void;
}) {
  if (!scope) return null;
  const achieved = history.filter((h) => h.met).sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
  const notAchieved = history.filter((h) => !h.met).sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));
  const title = scope === "company" ? "Company goals" : "Personal goals";

  return (
    <Modal open={!!scope} onClose={onClose} title={title} size="md">
      <div className="space-y-5">
        <section>
          <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
            Current · {current.length}
          </div>
          {current.length === 0 ? (
            <div className="text-sm text-ink-400">No active {scope} goals.</div>
          ) : (
            <ul className="space-y-3">
              {current.map((g) => (
                <GoalProgressRow key={g.id} agencyId={agencyId} goal={g} showScope />
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold mb-2 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Previously achieved · {achieved.length}
          </div>
          <ArchivedRows agencyId={agencyId} rows={achieved} emptyHint="None achieved yet." />
        </section>

        <section>
          <div className="text-[11px] uppercase tracking-wider text-rose-700 font-semibold mb-2 inline-flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" /> Previously not achieved · {notAchieved.length}
          </div>
          <ArchivedRows agencyId={agencyId} rows={notAchieved} emptyHint="None missed." />
        </section>
      </div>
    </Modal>
  );
}

function ArchivedRows({
  agencyId,
  rows,
  emptyHint,
}: {
  agencyId: string;
  rows: ArchivedPerformanceGoal[];
  emptyHint: string;
}) {
  if (rows.length === 0) return <div className="text-xs text-ink-400">{emptyHint}</div>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const def = GOAL_METRICS.find((m) => m.key === r.metric);
        const fmtVal = (n: number) => (def?.format === "money" ? fmt.money(n) : n.toLocaleString());
        return (
          <li key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-ink-700 truncate">
              {def?.label ?? r.metric}
              {r.scope === "personal" && (
                <span className="text-[10px] text-ink-400"> · {goalScopeLabel(agencyId, r)}</span>
              )}{" "}
              <span className="text-ink-400">
                ({fmtVal(r.actual)}/{fmtVal(r.target)})
              </span>
            </span>
            <span className="text-[10px] text-ink-400 shrink-0">{fmt.dateTime(r.archivedAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}