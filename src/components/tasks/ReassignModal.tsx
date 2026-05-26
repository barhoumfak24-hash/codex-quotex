import { useEffect, useMemo, useState } from "react";
import { Search, UserCog, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import type { Task, User } from "@/types";

// =====================================================================
// Manager-only Reassign modal. Same shape as SetReminderModal — list
// of agents (incl. unassigned + managers), a quick filter, footer
// with Cancel + primary Reassign CTA. Used when the activity-card
// inline dropdown gets clipped by the card overflow.
// =====================================================================

export function ReassignModal({
  open,
  onClose,
  task,
  agents,
  actorId,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
  agents: User[];
  actorId?: string;
}) {
  const [query, setQuery] = useState("");
  // Default to the agent an agent requested (if any), else the current
  // owner.
  const [selectedId, setSelectedId] = useState<string | null>(
    task.reassignRequestToId ?? task.assignedToId ?? null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(task.reassignRequestToId ?? task.assignedToId ?? null);
    setBusy(false);
  }, [open, task.assignedToId, task.reassignRequestToId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    );
  }, [agents, query]);

  function submit() {
    setBusy(true);
    try {
      api.tasks.assign(task.id, selectedId ?? undefined, actorId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reassign activity" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Move <span className="font-medium text-ink-900">"{task.title}"</span> to a
          different agent. The activity (and any reminders set on it) follow the
          assignment.
        </p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Filter by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="rounded-md border border-ink-100 max-h-[280px] overflow-y-auto">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm border-b border-ink-100 ${
              selectedId === null ? "bg-gold-50 font-medium" : "hover:bg-ink-50 text-ink-500"
            }`}
          >
            <X className="h-3.5 w-3.5 text-ink-400" />— Unassigned —
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-400">
              No staff match "{query}".
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {filtered.map((a) => {
                const active = selectedId === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`flex items-center justify-between gap-2 w-full text-left px-3 py-2 text-sm ${
                        active ? "bg-gold-50 font-medium" : "hover:bg-ink-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate">{a.name}</div>
                        <div className="text-[11px] text-ink-500 truncate">{a.email}</div>
                      </div>
                      <Badge tone={a.role === "manager" ? "gold" : "neutral"}>
                        {a.role}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500">
            {selectedId === null
              ? "Will be unassigned."
              : `Will assign to ${agents.find((a) => a.id === selectedId)?.name ?? "—"}.`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submit}
              disabled={busy}
            >
              <UserCog className="h-3.5 w-3.5" />
              {busy ? "Saving…" : "Reassign"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}