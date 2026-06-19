import { AlertTriangle } from "lucide-react";
import { DEMO_BANNER_COPY } from "@/lib/demo";

export function DemoBanner({
  compact = false,
  tone = "light",
}: {
  compact?: boolean;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      className={
        dark
          ? "border-b border-white/10 bg-[#0b0a08] text-gold-100"
          : "border-b border-amber-200 bg-amber-50 text-amber-900"
      }
    >
      <div className={`mx-auto flex max-w-7xl items-center gap-2 px-4 ${compact ? "py-1.5" : "py-2"} text-[12px] leading-snug`}>
        <AlertTriangle className={dark ? "h-3.5 w-3.5 shrink-0 text-gold-300" : "h-3.5 w-3.5 shrink-0"} />
        <span className="font-semibold uppercase tracking-wider">Demo mode</span>
        <span className={dark ? "hidden text-gold-100/60 sm:inline" : "hidden text-amber-900/80 sm:inline"}>/</span>
        <span className={dark ? "truncate text-gold-50/80" : "truncate text-amber-900/90"}>{DEMO_BANNER_COPY}</span>
      </div>
    </div>
  );
}

export function DemoModeBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
      <AlertTriangle className="h-3 w-3" />
      Demo
    </span>
  );
}
