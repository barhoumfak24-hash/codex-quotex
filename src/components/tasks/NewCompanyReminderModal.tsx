import { useEffect, useMemo, useState } from "react";
import { Bell, Building2, Calendar as CalendarIcon, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ImportancePicker } from "@/components/tasks/ImportancePicker";
import { RecurrencePicker, buildRecurrence } from "@/components/tasks/RecurrencePicker";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type {
  ReminderRecurrencePattern,
  TaskSeverity,
} from "@/types";

// =====================================================================
// "Company reminder" composer. Available to anyone on staff — agents
// and managers both. Same field set as the personal NewReminderModal
// plus a recipient picker — the author ticks which teammates should
// receive the reminder, and one independent reminder row is created
// per selection (recipients dismiss / snooze their own copy without
// affecting the rest).
// =====================================================================

const PRESETS = [
  { label: "In 1 hour", ms: 60 * 60 * 1000 },
  { label: "Tomorrow morning", ms: 24 * 60 * 60 * 1000 },
  { label: "In 3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "Next week", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

function nowPlusMs(ms: number): string {
  const d = new Date(Date.now() + ms);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

export function NewCompanyReminderModal({
  open,
  onClose,
  tenantId,
  createdById,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  createdById: string;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [presetIdx, setPresetIdx] = useState<number | "custom">(1);
  const [customAt, setCustomAt] = useState<string>(() => nowPlusMs(24 * 60 * 60 * 1000));
  const [note, setNote] = useState("");
  const [importance, setImportance] = useState<TaskSeverity>("info");
  const [recipientIds, setRecipientIds] = useState<Set<string>>(new Set());
  // Recurrence config. "none" → one-off, anything else schedules
  // the next occurrence automatically when each recipient dismisses
  // their copy. Custom = manager-specified day interval.
  const [recurrencePattern, setRecurrencePattern] = useState<
    "none" | ReminderRecurrencePattern
  >("none");
  const [customInterval, setCustomInterval] = useState<number>(14);
  const [endsAt, setEndsAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = useMemo(
    () =>
      api.users
        .list(tenantId)
        .filter((u) => u.role === "agent" || u.role === "manager")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tenantId, open]
  );

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setPresetIdx(1);
    setCustomAt(nowPlusMs(24 * 60 * 60 * 1000));
    setNote("");
    setImportance("info");
    // Seed with all staff selected so the author just unticks the
    // ones who shouldn't get it. Faster than building the
    // list from scratch each time.
    setRecipientIds(new Set(staff.map((u) => u.id)));
    setRecurrencePattern("none");
    setCustomInterval(14);
    setEndsAt("");
    setError(null);
    setBusy(false);
  }, [open, staff]);

  function toggle(id: string) {
    setRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function targetIso(): string | null {
    if (presetIdx === "custom") {
      if (!customAt) return null;
      const ts = new Date(customAt).getTime();
      if (Number.isNaN(ts)) return null;
      if (ts <= Date.now()) return null;
      return new Date(ts).toISOString();
    }
    return new Date(Date.now() + PRESETS[presetIdx].ms).toISOString();
  }

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Give the company reminder a short title so recipients know what it's about.");
      return;
    }
    if (recipientIds.size === 0) {
      setError("Pick at least one recipient.");
      return;
    }
    const at = targetIso();
    if (!at) {
      setError("Pick a future date + time.");
      return;
    }
    let recurrence = buildRecurrence(recurrencePattern, customInterval, endsAt);
    setBusy(true);
    try {
      api.reminders.createBatch({
        tenantId,
        userIds: Array.from(recipientIds),
        title: title.trim(),
        remindAt: at,
        note: note.trim() || undefined,
        importance,
        recurrence,
      });
      onCreated?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const allSelected = recipientIds.size === staff.length && staff.length > 0;

  return (
    <Modal open={open} onClose={onClose} title="New company reminder" size="lg">
      <div className="space-y-5">
        <p className="text-sm text-ink-600 flex items-start gap-2">
          <Building2 className="h-4 w-4 text-gold-600 mt-0.5 shrink-0" />
          <span>
            Send a reminder to everyone you pick below. Each recipient gets their own
            independent copy on their dashboard — they snooze or dismiss only theirs,
            not anyone else's.
          </span>
        </p>

        <div>
          <label className="label">Title</label>
          <input
            className="input text-sm"
            placeholder="e.g., Quarterly carrier appetite review @ 3pm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={busy}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="label !mb-0">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Recipients ({recipientIds.size}/{staff.length})
              </span>
            </label>
            <button
              type="button"
              className="text-xs text-ink-600 hover:text-ink-900 underline"
              disabled={busy || staff.length === 0}
              onClick={() => {
                if (allSelected) setRecipientIds(new Set());
                else setRecipientIds(new Set(staff.map((u) => u.id)));
              }}
            >
              {allSelected ? "Unselect all" : "Select all"}
            </button>
          </div>
          {staff.length === 0 ? (
            <div className="text-sm text-ink-400">
              No agents or managers in this agency yet.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto rounded-md border border-ink-100 p-2 bg-ink-50/30">
              {staff.map((u) => {
                const checked = recipientIds.has(u.id);
                return (
                  <label
                    key={u.id}
                    className={`flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer text-sm ${
                      checked ? "bg-gold-50 border border-gold-200" : "border border-transparent hover:bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggle(u.id)}
                      disabled={busy}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-800 truncate">
                        {u.name}
                        {u.id === createdById ? " (you)" : ""}
                      </span>
                      <span className="block text-[11px] text-ink-500">
                        {u.role === "manager" ? "Manager" : "Agent"} · {u.email}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">When?</label>
          <div className="grid sm:grid-cols-2 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPresetIdx(i)}
                disabled={busy}
                className={`text-left rounded-md border px-3 py-2 text-sm ${
                  presetIdx === i
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <div className="font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {fmt.dateTime(new Date(Date.now() + p.ms).toISOString())}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetIdx("custom")}
              disabled={busy}
              className={`text-left rounded-md border px-3 py-2 text-sm sm:col-span-2 ${
                presetIdx === "custom"
                  ? "border-gold-400 bg-gold-50"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              <div className="font-medium flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" /> Pick a custom date + time
              </div>
              {presetIdx === "custom" && (
                <input
                  type="datetime-local"
                  className="input mt-2 text-sm"
                  value={customAt}
                  onChange={(e) => setCustomAt(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Importance</label>
          <ImportancePicker value={importance} onChange={setImportance} disabled={busy} />
        </div>

        <RecurrencePicker
          pattern={recurrencePattern}
          onPatternChange={setRecurrencePattern}
          customInterval={customInterval}
          onCustomIntervalChange={setCustomInterval}
          endsAt={endsAt}
          onEndsAtChange={setEndsAt}
          disabled={busy}
        />

        <div>
          <label className="label">Note (optional)</label>
          <textarea
            className="input text-sm min-h-[80px]"
            placeholder="Background, links, prep steps — anything the recipients should see when it fires."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500 flex items-center gap-1.5 flex-wrap">
            <Bell className="h-3 w-3 text-blue-500" />
            Surfaces on each recipient's dashboard{" "}
            <Badge tone="info">{targetIso() ? fmt.relative(targetIso()!) : "—"}</Badge>
            {recurrencePattern !== "none" && (
              <Badge tone="warn">
                Recurs{" "}
                {recurrencePattern === "custom"
                  ? `every ${customInterval}d`
                  : recurrencePattern}
              </Badge>
            )}
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
              <Bell className="h-3.5 w-3.5" />
              {busy
                ? "Saving…"
                : `Send to ${recipientIds.size} recipient${recipientIds.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}