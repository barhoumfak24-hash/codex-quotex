import { RotateCw } from "lucide-react";
import type { ReminderRecurrence, ReminderRecurrencePattern } from "@/types";

// =====================================================================
// Reusable recurrence picker. Drops into any reminder composer
// (personal / company / task-anchored) so all reminder surfaces
// expose the same pattern + custom-interval + stop-date options.
//
// Render the buttons + the conditional sub-rows; the parent owns the
// state so it can compose the final `recurrence` payload at submit.
// =====================================================================

export const RECURRENCE_OPTIONS: {
  v: "none" | ReminderRecurrencePattern;
  label: string;
}[] = [
  { v: "none", label: "One-off" },
  { v: "daily", label: "Daily" },
  { v: "weekly", label: "Weekly" },
  { v: "biweekly", label: "Biweekly" },
  { v: "monthly", label: "Monthly" },
  { v: "custom", label: "Custom" },
];

export function buildRecurrence(
  pattern: "none" | ReminderRecurrencePattern,
  customInterval: number,
  endsAt: string
): ReminderRecurrence | undefined {
  if (pattern === "none") return undefined;
  return {
    pattern,
    intervalDays:
      pattern === "custom" ? Math.max(1, customInterval) : undefined,
    endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
  };
}

export function RecurrencePicker({
  pattern,
  onPatternChange,
  customInterval,
  onCustomIntervalChange,
  endsAt,
  onEndsAtChange,
  disabled,
}: {
  pattern: "none" | ReminderRecurrencePattern;
  onPatternChange: (p: "none" | ReminderRecurrencePattern) => void;
  customInterval: number;
  onCustomIntervalChange: (n: number) => void;
  endsAt: string;
  onEndsAtChange: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label">
        <span className="inline-flex items-center gap-1.5">
          <RotateCw className="h-3.5 w-3.5" /> Recurrence
        </span>
      </label>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {RECURRENCE_OPTIONS.map((p) => {
          const active = pattern === p.v;
          return (
            <button
              key={p.v}
              type="button"
              onClick={() => onPatternChange(p.v)}
              disabled={disabled}
              className={`rounded-md border px-2 py-1.5 text-xs ${
                active
                  ? "border-gold-400 bg-gold-50 text-ink-900"
                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-300"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {pattern === "custom" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-600">
          <span>Every</span>
          <input
            type="number"
            className="input text-sm w-20"
            min={1}
            value={customInterval}
            disabled={disabled}
            onChange={(e) =>
              onCustomIntervalChange(Math.max(1, Number(e.target.value) || 1))
            }
          />
          <span>day{customInterval === 1 ? "" : "s"}</span>
        </div>
      )}
      {pattern !== "none" && (
        <div className="mt-2">
          <label className="text-[11px] text-ink-500">Stop on (optional)</label>
          <input
            type="date"
            className="input text-sm"
            value={endsAt}
            disabled={disabled}
            onChange={(e) => onEndsAtChange(e.target.value)}
          />
          <div className="text-[11px] text-ink-500 mt-1">
            Leave blank to repeat indefinitely. Each occurrence is spawned only
            after the previous one is dismissed.
          </div>
        </div>
      )}
    </div>
  );
}