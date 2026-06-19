import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Search, User, UserSearch, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImportancePicker } from "@/components/tasks/ImportancePicker";
import { api } from "@/lib/api";
import { isRoutingManagerRole, routableStaff, staffRoleLabel } from "@/lib/roles";
import type { Role, TaskSeverity } from "@/types";

// =====================================================================
// Create-new-activity composer. Drops a manual Task onto the Activity
// Center. Two launch modes:
//   1. Unscoped (from the Activity Center) — shows a client / prospect
//      search so the author picks who the activity is for.
//   2. Scoped (from a client or prospect profile) — the contact is
//      fixed; the search is replaced by a read-only chip.
//
// Captures title, optional description, importance, and (managers
// only) an assignee. Defaults the assignee to the contact's owning
// agent so the activity lands on the right queue.
// =====================================================================

type ContactPick =
  | { kind: "customer"; id: string; name: string }
  | { kind: "prospect"; id: string; name: string };

export function CreateActivityModal({
  open,
  onClose,
  tenantId,
  viewer,
  // When launched from a profile, lock the activity to this contact.
  fixedContact,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  viewer: { id: string; role: Role };
  fixedContact?: ContactPick;
  onCreated?: (taskId: string) => void;
}) {
  const isManager = isRoutingManagerRole(viewer.role);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<TaskSeverity>("info");
  const [contact, setContact] = useState<ContactPick | null>(fixedContact ?? null);
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(viewer.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const agents = useMemo(
    () =>
      isManager
        ? routableStaff(api.users.list(tenantId), tenantId)
        : [],
    [tenantId, isManager, open]
  );

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setSeverity("info");
    setContact(fixedContact ?? null);
    setQuery("");
    setAssigneeId(viewer.id);
    setError(null);
    setBusy(false);
    window.setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, fixedContact, viewer.id]);

  // Default the assignee to the contact's owning agent once one is
  // picked (managers can still override). Agents always self-assign.
  useEffect(() => {
    if (!isManager || !contact) return;
    if (contact.kind === "customer") {
      const c = api.customers.get(contact.id);
      if (c?.assignedAgentId) setAssigneeId(c.assignedAgentId);
    } else {
      const p = api.prospects.get(contact.id);
      if (p?.assignedAgentId) setAssigneeId(p.assignedAgentId);
    }
  }, [contact, isManager]);

  // Search results — only when unscoped + a query is typed. Agents
  // only see their own book; managers see everyone.
  const results = useMemo(() => {
    if (fixedContact || !open) return [] as ContactPick[];
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    const customers = api.customers
      .listVisible(tenantId, viewer)
      .filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      .slice(0, 6)
      .map<ContactPick>((c) => ({ kind: "customer", id: c.id, name: c.name }));
    // Prospects aren't agent-scoped the same way; managers + assigned
    // agents can target them. Keep it simple: managers see all, agents
    // see prospects assigned to them.
    const prospects = api.prospects
      .listByTenant(tenantId)
      .filter((p) => {
        if (!(p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
          return false;
        if (isManager) return true;
        if (viewer.role === "csr") {
          return p.assignedCsrId === viewer.id || (p.additionalCsrIds ?? []).includes(viewer.id);
        }
        return (
          p.assignedAgentId === viewer.id ||
          (p.additionalAgentIds ?? []).includes(viewer.id)
        );
      })
      .slice(0, 6)
      .map<ContactPick>((p) => ({ kind: "prospect", id: p.id, name: p.name }));
    return [...customers, ...prospects];
  }, [query, fixedContact, open, tenantId, viewer, isManager]);

  // Agents can only create for their own book. Compute against the
  // currently-selected contact so the UI can block before submit.
  const contactAllowed = contact
    ? api.tasks.canCreateActivityFor(viewer, {
        customerId: contact.kind === "customer" ? contact.id : undefined,
        prospectId: contact.kind === "prospect" ? contact.id : undefined,
      })
    : true;

  // Pick a manager to route an agent-sent activity to (so it lands in
  // a manager's queue for assignment). Falls back to leaving it
  // unassigned if the tenant somehow has no manager.
  function firstManagerId(): string | undefined {
    return api.users
      .list(tenantId)
      .find((u) => u.role === "manager" && u.active !== false)?.id;
  }

  // sendToManager (agents only): hand the assignment decision to a
  // manager rather than self-assigning.
  function submit(sendToManager = false) {
    setError(null);
    if (!title.trim()) {
      setError("Give the activity a short title.");
      return;
    }
    if (!contactAllowed) {
      setError(
        "You can only create activities for clients or prospects assigned to you."
      );
      return;
    }
    const managerId = sendToManager ? firstManagerId() : undefined;
    setBusy(true);
    try {
      const task = api.tasks.create({
        tenantId,
        title: title.trim(),
        description: description.trim() || undefined,
        customerId: contact?.kind === "customer" ? contact.id : undefined,
        prospectId: contact?.kind === "prospect" ? contact.id : undefined,
        assignedToId: sendToManager
          ? managerId
          : isManager
          ? assigneeId
          : viewer.id,
        severity,
        severityReason: sendToManager
          ? "Sent to a manager to assign."
          : "Created manually from the portal.",
        awaitingManagerAssignment: sendToManager || undefined,
        createdById: viewer.id,
      });
      onCreated?.(task.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create new activity" size="md">
      <div className="space-y-5">
        <p className="text-sm text-ink-600 flex items-start gap-2">
          <ClipboardList className="h-4 w-4 text-gold-600 mt-0.5 shrink-0" />
          <span>
            Drops a card onto the Activity Center. Use it for follow-ups, internal
            to-dos, or anything you want tracked through the resolve workflow.
          </span>
        </p>

        {/* Contact picker / chip */}
        <div>
          <label className="label">Who is this activity for?</label>
          {contact ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50/40 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm text-ink-800 min-w-0">
                {contact.kind === "customer" ? (
                  <User className="h-4 w-4 text-ink-500 shrink-0" />
                ) : (
                  <UserSearch className="h-4 w-4 text-ink-500 shrink-0" />
                )}
                <span className="truncate font-medium">{contact.name}</span>
                <span className="text-[11px] uppercase tracking-wider text-ink-400">
                  {contact.kind === "customer" ? "Client" : "Prospect"}
                </span>
              </span>
              {!fixedContact && (
                <button
                  type="button"
                  className="text-ink-400 hover:text-ink-700 p-1"
                  onClick={() => setContact(null)}
                  title="Change contact"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <input
                  className="input text-sm !pl-8"
                  placeholder="Search clients or prospects by name or email…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {results.length > 0 && (
                <ul className="mt-1 rounded-md border border-ink-100 bg-white shadow-luxe max-h-56 overflow-y-auto divide-y divide-ink-100">
                  {results.map((r) => (
                    <li key={`${r.kind}-${r.id}`}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-ink-50 flex items-center gap-2"
                        onClick={() => {
                          setContact(r);
                          setQuery("");
                        }}
                      >
                        {r.kind === "customer" ? (
                          <User className="h-4 w-4 text-ink-500 shrink-0" />
                        ) : (
                          <UserSearch className="h-4 w-4 text-ink-500 shrink-0" />
                        )}
                        <span className="text-sm text-ink-800 truncate">{r.name}</span>
                        <span className="ml-auto text-[11px] uppercase tracking-wider text-ink-400">
                          {r.kind === "customer" ? "Client" : "Prospect"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim().length >= 1 && results.length === 0 && (
                <div className="mt-1 text-xs text-ink-400 px-1">
                  No matches. You can still create an unassigned activity below.
                </div>
              )}
              <div className="text-[11px] text-ink-500 mt-1">
                Optional — leave blank for a general activity not tied to a contact.
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="label">Title</label>
          <input
            ref={titleRef}
            className="input text-sm"
            placeholder="e.g., Call client to confirm wind-mitigation form"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label className="label">Details (optional)</label>
          <textarea
            className="input text-sm min-h-[80px]"
            placeholder="Anything the assignee should know to action this."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </div>

        <div>
          <label className="label">Importance</label>
          <ImportancePicker value={severity} onChange={setSeverity} disabled={busy} />
        </div>

        {isManager && (
          <div>
            <label className="label">Assign to</label>
            <select
              className="input text-sm"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={busy}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.id === viewer.id ? " (you)" : ""} · {staffRoleLabel(a.role)}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        {!contactAllowed && contact && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {contact.name} isn't assigned to you. Agents can only create
            activities for their own clients and prospects — ask a manager to
            reassign or have them create it.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* Agents can hand the assignment decision to a manager
              instead of self-assigning. */}
          {!isManager && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => submit(true)}
              disabled={busy || !contactAllowed}
              title="Create this activity and let a manager assign who handles it."
            >
              <UserSearch className="h-3.5 w-3.5" />
              {busy ? "Sending…" : "Send to manager"}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => submit(false)}
            disabled={busy || !contactAllowed}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            {busy ? "Creating…" : isManager ? "Create activity" : "Create & assign to me"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
