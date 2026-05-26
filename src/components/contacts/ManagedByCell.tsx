import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";

// =====================================================================
// "Managed by" cell for the Clients / Prospects tables. Shows the
// primary (assigned) agent; if the account is co-managed by additional
// agents, a little dropdown arrow expands the full list. Unassigned →
// "Awaiting agent assignment".
// =====================================================================

export function ManagedByCell({
  assignedAgentId,
  additionalAgentIds = [],
}: {
  assignedAgentId?: string;
  additionalAgentIds?: string[];
}) {
  const [open, setOpen] = useState(false);

  if (!assignedAgentId) {
    return <span className="text-amber-700 text-xs">Awaiting agent assignment</span>;
  }

  const primary = api.users.get(assignedAgentId);
  const extras = additionalAgentIds
    .filter((id) => id !== assignedAgentId)
    .map((id) => api.users.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  if (extras.length === 0) {
    return <span className="text-ink-700">{primary?.name ?? "—"}</span>;
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-ink-700 hover:text-ink-900"
        title={`Co-managed by ${extras.length + 1} agents`}
      >
        <span>{primary?.name ?? "—"}</span>
        <span className="text-[10px] text-ink-400">+{extras.length}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-ink-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
        )}
      </button>
      {open && (
        <div className="absolute z-10 mt-1 min-w-[180px] rounded-md border border-ink-100 bg-white shadow-luxe p-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold px-1 pb-1">
            All agents managing
          </div>
          <ul className="space-y-0.5">
            <li className="px-1 py-1 text-sm text-ink-800 flex items-center justify-between gap-2">
              <span>{primary?.name ?? "—"}</span>
              <span className="text-[10px] text-gold-700 uppercase tracking-wider">Primary</span>
            </li>
            {extras.map((u) => (
              <li key={u.id} className="px-1 py-1 text-sm text-ink-700">
                {u.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}