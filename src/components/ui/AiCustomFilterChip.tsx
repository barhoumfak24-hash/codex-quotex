import { FormEvent, useState } from "react";
import { Sparkles, X } from "lucide-react";

export function AiCustomFilterChip({
  value,
  onChange,
  placeholder = "ex: open claims, unassigned, Olivia, over 1m",
  label = "Custom",
  size = "sm",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const active = value.trim().length > 0;
  const buttonSize = size === "md" ? "min-h-[42px] px-3 py-2 text-sm" : "min-h-8 px-3 py-1.5 text-xs";
  const inputSize = size === "md" ? "h-[42px] pl-9 pr-2 text-sm" : "h-8 pl-8 pr-2 text-xs";
  const iconSize = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  function submit(e: FormEvent) {
    e.preventDefault();
    onChange(draft.trim());
    setOpen(false);
  }

  if (open) {
    return (
      <form className="flex min-w-0 w-full max-w-xl items-center gap-1.5 sm:w-auto sm:min-w-[280px]" onSubmit={submit}>
        <div className="relative min-w-0 flex-1">
          <Sparkles className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-gold-600 ${iconSize}`} />
          <input
            className={`input ${inputSize}`}
            autoFocus
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <button type="submit" className={`btn-primary ${size === "md" ? "text-sm" : "text-xs"}`}>
          Apply
        </button>
        <button
          type="button"
          className="btn-outline text-xs !px-2"
          title="Cancel custom filter"
          onClick={() => {
            setDraft(value);
            setOpen(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${buttonSize} ${
          active
            ? "border-gold-600 bg-gold-600 text-white shadow-sm hover:border-gold-700 hover:bg-gold-700"
            : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 hover:shadow-md"
        }`}
        title={active ? `AI custom filter: ${value}` : "Create an AI custom filter"}
      >
        <Sparkles className={`${iconSize} shrink-0`} />
        <span className="truncate">{active ? `${label}: ${value}` : label}</span>
      </button>
      {active && (
        <button
          type="button"
          className="btn-outline text-xs !px-2"
          title="Clear custom filter"
          onClick={() => {
            onChange("");
            setDraft("");
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
