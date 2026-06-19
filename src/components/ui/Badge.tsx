import type { ReactNode } from "react";

type Tone = "neutral" | "info" | "success" | "warn" | "error" | "gold";

const tones: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  info: "bg-blue-50 text-blue-700",
  success: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  error: "bg-alert-soft text-alert",
  gold: "border border-gold-200 bg-gold-50 text-gold-700",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge shrink-0 whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}
