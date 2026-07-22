import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { CardHeader } from "./Card";

// =====================================================================
// Card with a built-in "expand to full screen" toggle. Used by every
// message surface (the inline detail-page threads, the Messages inbox
// columns, the dashboard internal-messages card) so a long thread can
// be blown up to a focused full-screen view and collapsed back.
//
// The body element is kept mounted across the expand/collapse toggle
// (it's the same React node, just re-positioned), so an in-progress
// reply draft survives expanding. `children` may be a render function
// that receives the current `expanded` flag — message threads use it
// to switch to a fill-height layout when expanded.
// =====================================================================

export function ExpandableCard({
  title,
  subtitle,
  action,
  id,
  className = "",
  expanded: controlledExpanded,
  onExpandedChange,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode | ((expanded: boolean) => ReactNode);
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;

  function setExpanded(next: boolean) {
    if (controlledExpanded === undefined) setInternalExpanded(next);
    onExpandedChange?.(next);
  }

  // Lock background scroll + allow Esc to collapse while expanded.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const body = typeof children === "function" ? children(expanded) : children;

  const header = (
    <CardHeader
      title={title}
      subtitle={subtitle}
      action={
        <div className="flex items-center gap-2">
          {action}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="btn-outline text-xs !px-2"
            title={expanded ? "Collapse" : "Expand to full screen"}
            aria-label={expanded ? "Collapse" : "Expand to full screen"}
          >
            {expanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      }
    />
  );

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setExpanded(false)}
        />
      )}
      <div
        id={id}
        className={
          expanded
            ? "fixed inset-3 sm:inset-6 z-50 flex flex-col bg-white rounded-xl shadow-2xl p-6 overflow-hidden"
            : `card p-6 ${className}`
        }
      >
        {header}
        <div className={expanded ? "flex-1 min-h-0 overflow-auto" : ""}>{body}</div>
      </div>
    </>
  );
}
