import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { ProspectStatusBadge } from "@/components/ui/StatusBadge";
import { NewContactModal } from "@/components/contacts/NewContactModal";
import { ManagedByCell } from "@/components/contacts/ManagedByCell";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Prospect, ProspectStatus } from "@/types";

// Statuses that drive the red sidebar badge. Rows in these states
// are pinned to the top of the list and visually flagged so the
// agent can see exactly which prospect produced the alert.
const ALERT_STATUSES: ProspectStatus[] = ["new", "abandoned"];
const isAlert = (p: Prospect) => ALERT_STATUSES.includes(p.status);

const STATUSES: ("all" | ProspectStatus)[] = [
  "all",
  "new",
  "contacted",
  "quote_in_progress",
  "abandoned",
  "nurturing",
  "converted",
  "lost",
];

export function ProspectsPage() {
  const { agency } = useTenant();
  const nav = useNavigate();
  const [filter, setFilter] = useState<typeof STATUSES[number]>("all");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [, setRev] = useState(0);
  if (!agency) return null;
  // Converted prospects are excluded by default — once they cross
  // over they live in the Clients category, not here. The
  // "Converted" filter chip opts back in for managers reviewing
  // who's graduated.
  let prospects = api.prospects.listByTenant(agency.id, {
    includeConverted: filter === "converted",
  });
  if (filter !== "all") prospects = prospects.filter((p) => p.status === filter);
  if (q.trim()) {
    const t = q.toLowerCase();
    prospects = prospects.filter(
      (p) => p.name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t)
    );
  }
  // Sort alert rows (new + abandoned) to the top so the row driving
  // the red sidebar badge is the first thing the agent sees.
  prospects = [...prospects].sort((a, b) => {
    const ra = isAlert(a) ? 0 : 1;
    const rb = isAlert(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
  function refresh() {
    setRev((r) => r + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Prospects</h1>
          <p className="text-ink-500 text-sm mt-1">
            People who started a quote, abandoned, or are being nurtured by AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder="Search by name or email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-gold" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New prospect
          </button>
        </div>
      </div>

      <NewContactModal
        kind="prospect"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setRev((r) => r + 1);
          nav(`/employee/prospects/${id}`);
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === s ? "bg-ink-900 text-white border-ink-900" : "bg-white text-ink-700 border-ink-200 hover:bg-ink-50"
            }`}
          >
            {s === "all" ? "All" : fmt.titleCase(s)}
          </button>
        ))}
      </div>

      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Asset</th>
              <th className="px-6 py-3">Value</th>
              <th className="px-6 py-3">Last action</th>
              <th className="px-6 py-3">Marketing</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Managed by</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {prospects.map((p) => {
              const alert = isAlert(p);
              return (
                <tr key={p.id} className={alert ? "bg-alert-soft/60 hover:bg-alert-soft" : "hover:bg-ink-50/60"}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {alert && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-alert"
                          title="Needs attention"
                        />
                      )}
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <div className="text-xs text-ink-500 ml-3.5">{p.email}</div>
                  </td>
                  <td className="px-6 py-4">{api.helpers.assetTypeLabel(p.assetType)}</td>
                  <td className="px-6 py-4">{p.estimatedValue ? fmt.money(p.estimatedValue) : "—"}</td>
                  <td className="px-6 py-4">
                    <div className="text-ink-700">{p.lastAction}</div>
                    <div className="text-xs text-ink-400">{fmt.relative(p.lastActivityAt)}</div>
                  </td>
                  <td className="px-6 py-4 capitalize">{p.marketingStatus}</td>
                  <td className="px-6 py-4"><ProspectStatusBadge status={p.status} /></td>
                  <td className="px-6 py-4">
                    <ManagedByCell
                      assignedAgentId={p.assignedAgentId}
                      additionalAgentIds={p.additionalAgentIds}
                    />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        to={`/employee/prospects/${p.id}`}
                        className="btn-outline text-xs inline-flex"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        title="Archive this prospect"
                        onClick={() => {
                          if (!confirm(`Archive ${p.name}? You can unarchive from /employee/archive.`)) return;
                          api.prospects.archive(p.id);
                          refresh();
                        }}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {prospects.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-ink-400 text-sm">
                  No prospects match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}