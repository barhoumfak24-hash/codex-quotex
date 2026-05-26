import { Link } from "react-router-dom";

export function Logo({ to = "/", subtitle }: { to?: string; subtitle?: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 group">
      <div className="h-9 w-9 rounded bg-ink-900 text-gold-300 flex items-center justify-center font-display text-xl">
        Q
      </div>
      <div className="leading-tight">
        <div className="font-display text-lg text-ink-900 group-hover:text-ink-700">
          Quotex<span className="text-gold-500"> Insurance</span>
        </div>
        {subtitle && <div className="text-xs text-ink-400 -mt-0.5">{subtitle}</div>}
      </div>
    </Link>
  );
}