import { useEffect, useMemo, useState } from "react";
import { Search, UserCog, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import { staffRoleLabel } from "@/lib/roles";
import type { Task, User } from "@/types";

// =====================================================================
// Manager-only Reassign modal. Supports the same co-owner model as the
// initial routing assignment dialog: the first checked teammate becomes
// primary, and every checked teammate sees the activity in their queue.
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const current = task.reassignRequestToId
      ? [task.reassignRequestToId]
      : [task.assignedToId, ...(task.additionalAssignedToIds ?? [])].filter(
          (id): id is string => !!id
        );
    setSelectedIds(new Set(current));
    setBusy(false);
  }, [open, task.assignedToId, task.additionalAssignedToIds, task.reassignRequestToId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    );
  }, [agents, query]);

  const orderedIds = Array.from(selectedIds);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setBusy(true);
    try {
      api.tasks.assign(task.id, orderedIds.length > 0 ? orderedIds : undefined, actorId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reassign activity" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Move <span className="font-medium text-ink-900">"{task.title}"</span> to one or
          more teammates. The first checked user becomes the primary owner, and every checked
          user sees the activity in their queue.
        </p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Filter by name or email..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="rounded-md border border-ink-100 max-h-[280px] overflow-y-auto">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className={`flex items-center gap-2 w-full text-left px-3 py-2 text-sm border-b border-ink-100 ${
              selectedIds.size === 0
                ? "bg-gold-50 font-medium"
                : "hover:bg-ink-50 text-ink-500"
            }`}
          >
            <X className="h-3.5 w-3.5 text-ink-400" /> Unassigned
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-400">
              No staff match "{query}".
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {filtered.map((a) => {
                const active = selectedIds.has(a.id);
                return (
                  <li key={a.id}>
                    <label
                      className={`flex items-center justify-between gap-2 w-full text-left px-3 py-2 text-sm cursor-pointer ${
                        active ? "bg-gold-50 font-medium" : "hover:bg-ink-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(a.id)}
                        className="shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{a.name}</div>
                        <div className="text-[11px] text-ink-500 truncate">{a.email}</div>
                      </div>
                      {orderedIds[0] === a.id && (
                        <span className="text-[10px] uppercase tracking-wider text-gold-700">
                          Primary
                        </span>
                      )}
                      <Badge tone={a.role === "manager" ? "gold" : "neutral"}>
                        {staffRoleLabel(a.role)}
                      </Badge>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500">
            {selectedIds.size === 0
              ? "Will be unassigned."
              : selectedIds.size === 1
              ? `Will assign to ${agents.find((a) => a.id === orderedIds[0])?.name ?? "-"}.`
              : `${selectedIds.size} users selected. Primary owner: ${
                  agents.find((a) => a.id === orderedIds[0])?.name ?? "-"
                }.`}
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
              {busy ? "Saving..." : "Reassign"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
