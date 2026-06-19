import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Button } from "@/components/ui/Button";
import { ProspectStatusBadge } from "@/components/ui/StatusBadge";
import { NewContactModal } from "@/components/contacts/NewContactModal";
import { ManagedByCell } from "@/components/contacts/ManagedByCell";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { aiAssetTypeAliases, matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt } from "@/lib/format";
import type { Prospect, ProspectStatus } from "@/types";

// Statuses that drive the red sidebar badge. Rows in these states
// are pinned to the top of the list and visually flagged so the
// agent can see exactly which prospect produced the alert.
const ALERT_STATUSES: ProspectStatus[] = ["new", "abandoned"];
const isAlert = (p: Prospect) => ALERT_STATUSES.includes(p.status);

type ProspectFilter = "all" | "my" | ProspectStatus;

const STATUSES: ProspectFilter[] = [
  "all",
  "my",
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
  const { user } = useAuth();
  const nav = useNavigate();
  const [filter, setFilter] = useState<ProspectFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [, setRev] = useState(0);
  if (!agency || !user) return null;

  // Converted prospects are excluded by default. Once they cross over
  // they live in Clients; the Converted filter opts back in.
  let prospects = api.prospects.listVisible(agency.id, { id: user.id, role: user.role }, {
    includeConverted: filter === "converted",
  });
  if (filter === "my") {
    prospects = prospects.filter(
      (p) =>
        p.assignedAgentId === user.id ||
        (p.additionalAgentIds ?? []).includes(user.id) ||
        p.assignedCsrId === user.id ||
        (p.additionalCsrIds ?? []).includes(user.id)
    );
  } else if (filter !== "all") {
    prospects = prospects.filter((p) => p.status === filter);
  }
  if (q.trim()) {
    const t = q.toLowerCase();
    prospects = prospects.filter(
      (p) => p.name.toLowerCase().includes(t) || p.email.toLowerCase().includes(t)
    );
  }
  if (customFilter.trim()) {
    prospects = prospects.filter((p) => {
      const assignedAgent = p.assignedAgentId ? api.users.get(p.assignedAgentId) : undefined;
      const additionalAgents = (p.additionalAgentIds ?? [])
        .map((id) => api.users.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      return matchesAiCustomFilter(customFilter, {
        text: [
          p.name,
          p.email,
          p.phone,
          p.assetType,
          api.helpers.assetTypeLabel(p.assetType),
          ...aiAssetTypeAliases(p.assetType),
          String(p.estimatedValue ?? ""),
          p.aiSummary,
          p.lastAction,
          p.recommendedFollowUp,
          p.marketingStatus,
          p.status,
          fmt.titleCase(p.status.replace(/_/g, " ")),
          assignedAgent?.name,
          p.assignedCsrId ? api.users.get(p.assignedCsrId)?.name : undefined,
          ...(p.additionalCsrIds ?? []).map((id) => api.users.get(id)?.name),
          ...additionalAgents.map((agent) => agent.name),
        ],
        flags: {
          active: p.marketingStatus === "active" || p.status !== "lost",
          assigned: Boolean(p.assignedAgentId || (p.additionalAgentIds ?? []).length || p.assignedCsrId || (p.additionalCsrIds ?? []).length),
          unassigned: !p.assignedAgentId && !(p.additionalAgentIds ?? []).length && !p.assignedCsrId && !(p.additionalCsrIds ?? []).length,
          alert: isAlert(p),
          optedOut: p.marketingStatus === "opted_out",
          quote: p.status === "quote_in_progress",
          new: p.status === "new",
          contacted: p.status === "contacted",
          abandoned: p.status === "abandoned",
          nurturing: p.status === "nurturing",
          converted: p.status === "converted",
          lost: p.status === "lost",
          paused: p.marketingStatus === "paused",
        },
        numbers: [p.estimatedValue],
      });
    });
  }

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
      <EmployeeBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Prospects</h1>
          <p className="mt-1 text-sm text-ink-500">
            People who started a quote, abandoned, or are being nurtured by AI.
          </p>
        </div>
        <button type="button" className="btn-gold" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New prospect
        </button>
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setFilter(s)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              filter === s
                ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 hover:shadow-md"
            }`}
          >
            {s === "all" ? "All" : s === "my" ? "My prospects" : fmt.titleCase(s)}
          </button>
        ))}
        <AiCustomFilterChip
          value={customFilter}
          onChange={setCustomFilter}
          placeholder="ex: abandoned, unassigned, jewelry over 400k, Olivia"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[17%]" />
              <col className="w-[11%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="px-4 py-4">Name</th>
                <th className="px-4 py-4">Email</th>
                <th className="px-4 py-4">Phone</th>
                <th className="px-4 py-4">Asset</th>
                <th className="px-4 py-4">Value</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Managed by</th>
                <th className="px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {prospects.map((p) => {
                return (
                  <tr key={p.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-5 align-middle">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="break-words text-sm font-semibold leading-snug text-ink-900">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-5 align-middle">
                      <div className="truncate text-sm text-ink-700">{p.email}</div>
                    </td>
                    <td className="px-4 py-5 align-middle">
                      <div className="truncate text-sm text-ink-700">{p.phone ?? "-"}</div>
                    </td>
                    <td className="px-4 py-5 align-middle">
                      <div className="line-clamp-2 text-sm text-ink-700">{api.helpers.assetTypeLabel(p.assetType)}</div>
                    </td>
                    <td className="px-4 py-5 align-middle text-sm tabular-nums">
                      {p.estimatedValue ? fmt.money(p.estimatedValue) : "-"}
                    </td>
                    <td className="px-4 py-5 align-middle">
                      <ProspectStatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-5 align-middle text-sm">
                      <ManagedByCell
                        assignedAgentId={p.assignedAgentId}
                        additionalAgentIds={p.additionalAgentIds}
                        assignedCsrId={p.assignedCsrId}
                      />
                    </td>
                    <td className="px-4 py-5 align-middle text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          to={`/employee/prospects/${p.id}`}
                          size="xs"
                        >
                          Open
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {prospects.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-sm text-ink-400">
                    No prospects match the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
