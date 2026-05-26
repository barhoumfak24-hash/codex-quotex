import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { TaskSeverity } from "@/types";

// =====================================================================
// Three-button segmented control for picking importance / severity.
// Reused by the Set Reminder + New Reminder modals so the icons +
// colors match what the user sees on Activity Center cards (the
// top-left severity indicator: Info / AlertTriangle / AlertCircle).
// =====================================================================

const LEVELS = [
  {
    value: "info" as const,
    label: "Low",
    Icon: Info,
    color: "text-yellow-600",
    activeBg: "bg-yellow-50 border-yellow-300",
  },
  {
    value: "warning" as const,
    label: "Medium",
    Icon: AlertTriangle,
    color: "text-amber-600",
    activeBg: "bg-amber-50 border-amber-300",
  },
  {
    value: "urgent" as const,
    label: "High",
    Icon: AlertCircle,
    color: "text-alert",
    activeBg: "bg-alert-soft border-alert-ring",
  },
];

export function ImportancePicker({
  value,
  onChange,
  disabled,
}: {
  value: TaskSeverity;
  onChange: (next: TaskSeverity) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex items-stretch rounded-md border border-ink-200 overflow-hidden text-sm"
      role="group"
      aria-label="Importance"
    >
      {LEVELS.map((l) => {
        const active = value === l.value;
        return (
          <button
            key={l.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(l.value)}
            aria-pressed={active}
            className={`px-3 py-1.5 inline-flex items-center gap-1.5 border-r border-ink-200 last:border-r-0 ${
              active ? `${l.activeBg} font-medium` : "bg-white hover:bg-ink-50"
            }`}
          >
            <l.Icon className={`h-4 w-4 ${l.color}`} />
            <span className={active ? l.color : "text-ink-700"}>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Tiny variant used by reminder rows on the dashboard — icon only,
// no buttons. Severity-colored, matches the Activity Center icons.
export function ImportanceIcon({
  importance,
  className,
}: {
  importance?: TaskSeverity;
  className?: string;
}) {
  const level = LEVELS.find((l) => l.value === importance) ?? LEVELS[0];
  const Icon = level.Icon;
  return <Icon className={`${level.color} ${className ?? "h-4 w-4"}`} />;
}