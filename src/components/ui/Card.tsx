import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padded = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  // Optional DOM id so cards can be deep-link anchors (e.g.
  // `#messages-thread` on the client / prospect detail pages).
  id?: string;
}) {
  return (
    <div id={id} className={`card ${padded ? "p-6" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  // When set, the entire card becomes a clickable button — used
  // by the manager Analytics drill-down to open a modal listing
  // the underlying records (each click is a render-time choice
  // on the caller, no app-level routing).
  onClick?: () => void;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
        <div className="mt-1.5 text-2xl font-semibold text-ink-900">{value}</div>
        {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      </div>
      {icon && <div className="text-gold-500">{icon}</div>}
    </div>
  );
  if (!onClick) {
    return <Card className="!p-5">{inner}</Card>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-ink-100 bg-white shadow-luxe p-5 w-full hover:border-gold-300 hover:shadow-md transition-shadow"
    >
      {inner}
    </button>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-6 rounded-lg border border-dashed border-ink-200 bg-white">
      {icon && <div className="mx-auto mb-3 text-ink-300">{icon}</div>}
      <h4 className="text-base font-semibold text-ink-800">{title}</h4>
      {description && <p className="mt-1 text-sm text-ink-500 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}