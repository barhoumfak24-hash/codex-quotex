// =====================================================================
// Unified alert badge — one component for the red attention marker
// that appears on cards, list rows, and nav items across the
// platform.
//
//   • `count` mode  → "3", "12", "99+". Auto-shapes: circle for
//                     single-digit, rounded pill for 2+ digits.
//   • Default       → bold "!" glyph when no count is provided.
//
// Designed to be understated: solid red (#E63946 via the `alert`
// Tailwind token), white text, no drop shadow, single hairline
// white ring so the badge stays legible on tinted card backgrounds.
//
// Drop inside any element with `position: relative` (e.g. a Card)
// or pass `variant="inline"` to use it in the normal flow next to
// a label.
// =====================================================================

interface Props {
  // Numeric count. When set, renders the count instead of "!".
  // Values > 99 render as "99+".
  count?: number;
  // Accessible label / tooltip. Defaults to a reasonable summary.
  title?: string;
  // "absolute" (default) anchors top-left of the nearest positioned
  // ancestor. "inline" lets it sit in normal flow next to other text.
  variant?: "absolute" | "inline";
  // Extra utility classes for one-off overrides.
  className?: string;
}

export function AlertPin({ count, title, variant = "absolute", className }: Props) {
  const showCount = typeof count === "number" && count > 0;
  // Two-digit and bigger counts use a rounded pill so the number
  // doesn't get squeezed inside a circle.
  const shape = !showCount
    ? "h-5 w-5 rounded-full"
    : count! >= 10
    ? "min-w-[22px] h-[18px] px-[6px] rounded-full"
    : "h-5 w-5 rounded-full";
  const labelText =
    title ?? (showCount ? `${count} ${count === 1 ? "alert" : "alerts"}` : "Needs attention");
  const content = showCount ? (count! > 99 ? "99+" : String(count)) : "!";
  const base =
    `inline-flex ${shape} items-center justify-center bg-alert text-white text-[11px] font-semibold leading-none tabular-nums ring-2 ring-white`;
  if (variant === "inline") {
    return (
      <span className={`${base} ${className ?? ""}`.trim()} title={labelText} aria-label={labelText}>
        {content}
      </span>
    );
  }
  return (
    <span
      className={`absolute -top-2 -left-2 ${base} ${className ?? ""}`.trim()}
      title={labelText}
      aria-label={labelText}
    >
      {content}
    </span>
  );
}