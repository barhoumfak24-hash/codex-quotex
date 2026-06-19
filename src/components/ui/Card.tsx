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
  hideSubtitle = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  hideSubtitle?: boolean;
}) {
  return (
    <div className="card-header mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
        {!hideSubtitle && subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="card-header-action flex min-w-0 max-w-[14rem] flex-wrap justify-end gap-1.5">{action}</div>}
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
    <>
      <div className="min-w-0 pr-10">
        <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
        <div className="mt-1.5 text-2xl font-semibold text-ink-900">{value}</div>
        {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
      </div>
      {icon && (
        <div className="pointer-events-none absolute right-5 top-5 flex h-7 w-7 items-start justify-end text-gold-500">
          {icon}
        </div>
      )}
    </>
  );
  if (!onClick) {
    return <Card className="relative !p-5">{inner}</Card>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full rounded-lg border border-ink-100 bg-white p-5 text-left shadow-luxe transition-all duration-150 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 active:translate-y-0"
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
