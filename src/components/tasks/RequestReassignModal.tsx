import { useEffect, useMemo, useState } from "react";
import { Search, UserCog } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import { staffRoleLabel } from "@/lib/roles";
import type { Task, User } from "@/types";

// =====================================================================
// Agent-facing "Request reassignment" modal. Agents can't reassign an
// activity themselves, but they can ask a manager to move it to a
// specific teammate (with a reason). This drops a notification on the
// managers' Activity Center; a manager actions it from there.
// =====================================================================

export function RequestReassignModal({
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId(task.reassignRequestToId ?? null);
    setReason(task.reassignReason ?? "");
    setBusy(false);
    setError(null);
  }, [open, task.id]);

  // Can't request reassignment to whoever already owns it.
  const candidates = useMemo(
    () =>
      agents.filter(
        (a) =>
          a.id !== (actorId ?? "") &&
          a.id !== task.assignedToId &&
          !(task.additionalAssignedToIds ?? []).includes(a.id)
      ),
    [agents, actorId, task.assignedToId, task.additionalAssignedToIds]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  function submit() {
    if (!selectedId) {
      setError("Pick the teammate you'd like this moved to.");
      return;
    }
    setBusy(true);
    try {
      api.tasks.requestReassign(task.id, actorId ?? "", selectedId, reason.trim() || undefined);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request reassignment" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Ask a manager to move <span className="font-medium text-ink-900">"{task.title}"</span>{" "}
          to another agent. They'll see your request in their Activity Center and action it.
        </p>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Filter teammates by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="rounded-md border border-ink-100 max-h-[240px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-400">No teammates match "{query}".</div>
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
                        {staffRoleLabel(a.role)}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="label">Reason (optional)</label>
          <textarea
            className="input text-sm min-h-[60px]"
            placeholder="Why should this move? (e.g., out of office, conflict, better fit)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submit} disabled={busy}>
            <UserCog className="h-3.5 w-3.5" />
            {busy ? "Sending…" : "Request reassignment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
