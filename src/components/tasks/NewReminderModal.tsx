import { useEffect, useState } from "react";
import { Bell, Calendar as CalendarIcon, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ImportancePicker } from "@/components/tasks/ImportancePicker";
import { RecurrencePicker, buildRecurrence } from "@/components/tasks/RecurrencePicker";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { ReminderRecurrencePattern, TaskSeverity } from "@/types";

// =====================================================================
// Standalone reminder composer (not anchored to an Activity Center
// task). Mirrors the SetReminderModal layout: title + preset / custom
// when + optional note, footer with Cancel + primary Save CTA.
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

export function NewReminderModal({
  open,
  onClose,
  tenantId,
  userId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [presetIdx, setPresetIdx] = useState<number | "custom">(1);
  const [customAt, setCustomAt] = useState<string>(() => nowPlusMs(24 * 60 * 60 * 1000));
  const [note, setNote] = useState("");
  const [importance, setImportance] = useState<TaskSeverity>("info");
  const [recurrencePattern, setRecurrencePattern] = useState<
    "none" | ReminderRecurrencePattern
  >("none");
  const [customInterval, setCustomInterval] = useState<number>(14);
  const [endsAt, setEndsAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setPresetIdx(1);
    setCustomAt(nowPlusMs(24 * 60 * 60 * 1000));
    setNote("");
    setImportance("info");
    setRecurrencePattern("none");
    setCustomInterval(14);
    setEndsAt("");
    setError(null);
    setBusy(false);
  }, [open]);

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
      setError("Give the reminder a short title so you'll know what it's about.");
      return;
    }
    const at = targetIso();
    if (!at) {
      setError("Pick a future date + time.");
      return;
    }
    setBusy(true);
    try {
      api.reminders.create({
        tenantId,
        userId,
        title: title.trim(),
        remindAt: at,
        note: note.trim() || undefined,
        importance,
        recurrence: buildRecurrence(recurrencePattern, customInterval, endsAt),
      });
      onCreated?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New reminder" size="md">
      <div className="space-y-5">
        <p className="text-sm text-ink-600 flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-gold-600 mt-0.5 shrink-0" />
          <span>
            A general reminder for yourself. Not tied to any Activity Center card —
            useful for follow-ups like "call back the underwriter" or "ping Sarah
            about the policy update".
          </span>
        </p>

        <div>
          <label className="label">Title</label>
          <input
            className="input text-sm"
            placeholder="e.g., Call carrier rep about endorsement"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={busy}
          />
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
            placeholder="Anything else you want surfaced when this fires?"
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
            Will surface on your dashboard{" "}
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
              {busy ? "Saving…" : "Save reminder"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}