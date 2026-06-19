type CountBadgeTone = "neutral" | "gold" | "info" | "alert";
type CountBadgeSize = "sm" | "md";

const toneClasses: Record<CountBadgeTone, string> = {
  neutral: "border-ink-900 bg-ink-900 text-white",
  gold: "border-gold-700 bg-gold-700 text-white",
  info: "border-blue-700 bg-blue-700 text-white",
  alert: "border-alert bg-alert text-white",
};

export function CountBadge({
  value,
  tone = "neutral",
  size = "md",
  title,
  className = "",
}: {
  value: number;
  tone?: CountBadgeTone;
  size?: CountBadgeSize;
  title?: string;
  className?: string;
}) {
  const label = value > 99 ? "99+" : String(value);
  const compact = label.length === 1;
  const shape =
    size === "sm"
      ? compact
        ? "h-6 w-6 px-0 text-[13px]"
        : "h-6 min-w-8 px-1.5 text-[12px]"
      : compact
      ? "h-7 w-7 px-0 text-[16px]"
      : "h-7 min-w-9 px-2 text-[13px]";
  const accessibleTitle =
    title ?? `${label} ${value === 1 ? "item" : "items"}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-sans font-bold leading-none tracking-normal tabular-nums shadow-sm ring-2 ring-white ${shape} ${toneClasses[tone]} ${className}`.trim()}
      title={accessibleTitle}
      aria-label={accessibleTitle}
    >
      {label}
    </span>
  );
}
