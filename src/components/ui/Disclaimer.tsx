import { Info } from "lucide-react";

export function Disclaimer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}