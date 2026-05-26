import { AlertTriangle } from "lucide-react";
import { DEMO_BANNER_COPY } from "@/lib/demo";

export function DemoBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900">
      <div className={`max-w-7xl mx-auto px-4 ${compact ? "py-1.5" : "py-2"} flex items-center gap-2 text-[12px] leading-snug`}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold uppercase tracking-wider">Demo mode</span>
        <span className="hidden sm:inline text-amber-900/80">·</span>
        <span className="text-amber-900/90 truncate">{DEMO_BANNER_COPY}</span>
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